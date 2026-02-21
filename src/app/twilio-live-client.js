require('dotenv').config({ quiet: true });

const WebSocket = require('ws');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ARGS = process.argv.slice(2);

function hasFlag(name) {
  return ARGS.includes(name);
}

function getArgValue(name, fallback = null) {
  const prefix = `${name}=`;
  const match = ARGS.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const value = match.slice(prefix.length).trim();
  return value === '' ? fallback : value;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalLanguageCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gu' || normalized === 'gu-in') return 'gu-IN';
  if (normalized === 'hi' || normalized === 'hi-in') return 'hi-IN';
  if (normalized === 'en' || normalized === 'en-in') return 'en-IN';
  return String(value || '').trim();
}

function randomStreamSid() {
  return `MZ${crypto.randomBytes(16).toString('hex')}`;
}

function log(line) {
  console.log(`[twilio-live] ${line}`);
}

function vlog(enabled, line) {
  if (enabled) {
    console.log(`[twilio-live][debug] ${line}`);
  }
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function pcm16ToMulawSample(sample) {
  let pcm = sample | 0;
  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; exponent > 0 && (pcm & expMask) === 0; expMask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function mulawToPcm16Sample(muLawByte) {
  const value = (~muLawByte) & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  if (sign) sample = -sample;
  return Math.max(-32768, Math.min(32767, sample));
}

function pcm16ToMulawBuffer(pcm16Buffer) {
  const sampleCount = Math.floor(pcm16Buffer.length / 2);
  const out = Buffer.alloc(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = pcm16ToMulawSample(pcm16Buffer.readInt16LE(i * 2));
  }
  return out;
}

function mulawToPcm16Buffer(ulawBuffer) {
  const out = Buffer.alloc(ulawBuffer.length * 2);
  for (let i = 0; i < ulawBuffer.length; i += 1) {
    out.writeInt16LE(mulawToPcm16Sample(ulawBuffer[i]), i * 2);
  }
  return out;
}

function buildWsUrlWithTwilioHint(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return text;
  if (text.includes('twilio=1')) return text;
  return text.includes('?') ? `${text}&twilio=1` : `${text}?twilio=1`;
}

function usage() {
  console.log(`Usage:
  npm run client:twilio:live
  npm run client:twilio:live -- --url=ws://127.0.0.1:8081/?twilio=1 --provider=sarvam --language=gu-IN

Options:
  --url=<ws-url>                         (default local server with twilio=1)
  --provider=groq|cerebras|gemini|sarvam
  --language=hi-IN|gu-IN|en-IN
  --tts-language=hi-IN|gu-IN|en-IN
  --stt-sample-rate=<optional>
  --tts-sample-rate=<optional>
  --tts-output-codec=<optional>
  --stream-sid=<custom stream sid>
  --chunk-ms=20                          (Twilio media frame duration)
  --mic-device=pulse
  --speaker-device=pulse
  --no-speaker
  --verbose`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  usage();
  process.exit(0);
}

const SERVER_PORT = parseNumber(process.env.PORT, 8081);
const SERVER_PATH = process.env.VOICE_SERVER_WS_PATH || '/';
const defaultWsUrl = `ws://127.0.0.1:${SERVER_PORT}${SERVER_PATH}`;
const WS_URL = buildWsUrlWithTwilioHint(getArgValue('--url', process.env.VOICE_SERVER_URL || defaultWsUrl));
const MIC_DEVICE = getArgValue('--mic-device', process.env.MIC_DEVICE || 'pulse');
const SPEAKER_DEVICE = getArgValue('--speaker-device', process.env.SPEAKER_DEVICE || 'pulse');
const CHUNK_MS = Math.max(10, Math.round(parseNumber(getArgValue('--chunk-ms', '20'), 20)));
const CHUNK_BYTES_PCM16 = Math.max(160, Math.round((8000 * CHUNK_MS) / 1000) * 2);
const ENABLE_SPEAKER = !hasFlag('--no-speaker');
const VERBOSE = hasFlag('--verbose');
const PROVIDER = String(getArgValue('--provider', process.env.DEFAULT_PROVIDER || 'gemini')).toLowerCase();
const LANGUAGE = canonicalLanguageCode(getArgValue('--language', process.env.SARVAM_STT_LANGUAGE_CODE || 'gu-IN'));
const TTS_LANGUAGE = canonicalLanguageCode(getArgValue('--tts-language', LANGUAGE));
const STT_SAMPLE_RATE_ARG = getArgValue('--stt-sample-rate');
const TTS_SAMPLE_RATE_ARG = getArgValue('--tts-sample-rate');
const TTS_OUTPUT_CODEC_ARG = getArgValue('--tts-output-codec');
const STREAM_SID = getArgValue('--stream-sid', randomStreamSid());

let ws = null;
let recorder = null;
let speaker = null;
let micAccum = Buffer.alloc(0);
let sentChunks = 0;
let recvChunks = 0;
let stopped = false;

function startSpeaker() {
  if (!ENABLE_SPEAKER || speaker) return;
  speaker = spawn(
    'aplay',
    ['-q', '-D', SPEAKER_DEVICE, '-t', 'raw', '-f', 'S16_LE', '-c', '1', '-r', '8000'],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  speaker.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (!line) return;
    const normalized = line.toLowerCase();
    if (normalized.includes('interrupted system call')) return;
    console.error(`[twilio-live][aplay] ${line}`);
  });
  speaker.on('error', (err) => {
    console.error(`[twilio-live][speaker-error] ${err?.message || err}`);
  });
  speaker.on('close', () => {
    speaker = null;
  });
}

function stopSpeaker() {
  if (!speaker) return;
  try {
    if (speaker.stdin && !speaker.stdin.destroyed) speaker.stdin.end();
  } catch {}
  try {
    speaker.kill('SIGINT');
  } catch {}
  speaker = null;
}

function sendTwilioEvent(event) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(event));
}

function flushMicChunks() {
  while (micAccum.length >= CHUNK_BYTES_PCM16) {
    const pcmChunk = micAccum.subarray(0, CHUNK_BYTES_PCM16);
    micAccum = micAccum.subarray(CHUNK_BYTES_PCM16);
    const ulaw = pcm16ToMulawBuffer(pcmChunk);
    sentChunks += 1;
    sendTwilioEvent({
      event: 'media',
      streamSid: STREAM_SID,
      media: {
        payload: ulaw.toString('base64'),
        track: 'inbound',
        chunk: String(sentChunks),
        timestamp: String((sentChunks - 1) * CHUNK_MS),
      },
    });
  }
}

function startRecorder() {
  if (recorder) return;
  recorder = spawn(
    'arecord',
    ['-q', '-D', MIC_DEVICE, '-f', 'S16_LE', '-c', '1', '-r', '8000', '-t', 'raw'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  recorder.stdout.on('data', (chunk) => {
    if (!chunk?.length) return;
    micAccum = Buffer.concat([micAccum, chunk]);
    flushMicChunks();
  });
  recorder.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[twilio-live][arecord] ${line}`);
  });
  recorder.on('error', (err) => {
    console.error(`[twilio-live][recorder-error] ${err?.message || err}`);
  });
}

function stopRecorder() {
  if (!recorder) return;
  try {
    recorder.kill('SIGINT');
  } catch {}
  recorder = null;
  micAccum = Buffer.alloc(0);
}

function handleIncoming(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg?.event !== 'media' || !msg?.media?.payload) return;
  const ulaw = Buffer.from(String(msg.media.payload || ''), 'base64');
  if (!ulaw.length) return;
  recvChunks += 1;
  const pcm = mulawToPcm16Buffer(ulaw);
  if (ENABLE_SPEAKER) {
    if (!speaker || !speaker.stdin || speaker.stdin.destroyed) {
      startSpeaker();
    }
    try {
      speaker?.stdin?.write(pcm);
    } catch {}
  }
}

function startTwilioSession() {
  const customParameters = {
    provider: PROVIDER,
    language: LANGUAGE,
    ttsLanguage: TTS_LANGUAGE,
  };

  if (STT_SAMPLE_RATE_ARG) {
    const value = Math.max(8000, Math.round(parseNumber(STT_SAMPLE_RATE_ARG, 8000)));
    customParameters.sttSampleRate = String(value);
  }
  if (TTS_SAMPLE_RATE_ARG) {
    const value = Math.max(8000, Math.round(parseNumber(TTS_SAMPLE_RATE_ARG, 8000)));
    customParameters.ttsSampleRate = String(value);
  }
  if (TTS_OUTPUT_CODEC_ARG) {
    customParameters.ttsOutputCodec = String(TTS_OUTPUT_CODEC_ARG).trim();
  }

  sendTwilioEvent({
    event: 'connected',
    protocol: 'Call',
    version: '1.0.0',
  });
  sendTwilioEvent({
    event: 'start',
    sequenceNumber: '1',
    streamSid: STREAM_SID,
    start: {
      streamSid: STREAM_SID,
      tracks: ['inbound'],
      mediaFormat: {
        encoding: 'audio/x-mulaw',
        sampleRate: 8000,
        channels: 1,
      },
      customParameters,
    },
  });
}

function shutdown() {
  if (stopped) return;
  stopped = true;
  stopRecorder();
  stopSpeaker();
  try {
    sendTwilioEvent({
      event: 'stop',
      streamSid: STREAM_SID,
      stop: {
        callSid: 'LOCAL_SIM_CALL',
      },
    });
  } catch {}
  try {
    ws?.close();
  } catch {}
  log(`session_end sent_chunks=${sentChunks} recv_chunks=${recvChunks}`);
}

ws = new WebSocket(WS_URL);

ws.on('open', () => {
  log(`connected url=${WS_URL} streamSid=${STREAM_SID}`);
  startSpeaker();
  startTwilioSession();
  startRecorder();
  log('recording... speak now. Ctrl+C to stop.');
});

ws.on('message', (raw) => {
  handleIncoming(raw);
});

ws.on('close', () => {
  vlog(VERBOSE, 'socket_closed');
  shutdown();
});

ws.on('error', (err) => {
  console.error(`[twilio-live] socket_error ${err?.message || err}`);
});

process.on('SIGINT', () => {
  shutdown();
  setTimeout(() => process.exit(0), 100);
});
