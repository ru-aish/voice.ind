require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const ARGS = process.argv.slice(2);

function getArgValue(name, fallback = null) {
  const prefix = `${name}=`;
  const match = ARGS.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const value = match.slice(prefix.length).trim();
  return value === '' ? fallback : value;
}

function hasFlag(name) {
  return ARGS.includes(name);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMode(value) {
  const mode = String(value || 'bridge').trim().toLowerCase();
  return mode === 'twilio' ? 'twilio' : 'bridge';
}

function nowIso() {
  return new Date().toISOString();
}

function log(line) {
  console.log(`[twilio-sim] ${line}`);
}

function vlog(enabled, line) {
  if (enabled) {
    console.log(`[twilio-sim][debug] ${line}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function canonicalLanguageCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gu' || normalized === 'gu-in') return 'gu-IN';
  if (normalized === 'hi' || normalized === 'hi-in') return 'hi-IN';
  if (normalized === 'en' || normalized === 'en-in') return 'en-IN';
  return String(value || '').trim();
}

function parseWavPcm16Mono(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 44) {
    throw new Error(`WAV file too small: ${filePath}`);
  }
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Unsupported WAV container: ${filePath}`);
  }

  let offset = 12;
  let fmt = null;
  let pcmData = null;

  while (offset + 8 <= data.length) {
    const chunkId = data.toString('ascii', offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > data.length) break;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error(`Invalid fmt chunk in ${filePath}`);
      }
      fmt = {
        audioFormat: data.readUInt16LE(chunkStart),
        numChannels: data.readUInt16LE(chunkStart + 2),
        sampleRate: data.readUInt32LE(chunkStart + 4),
        bitsPerSample: data.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      pcmData = data.subarray(chunkStart, chunkEnd);
      break;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmt || !pcmData) {
    throw new Error(`Missing fmt/data chunks in ${filePath}`);
  }
  if (fmt.audioFormat !== 1) {
    throw new Error(`Only PCM WAV is supported (format=${fmt.audioFormat})`);
  }
  if (fmt.numChannels !== 1) {
    throw new Error(`Only mono WAV is supported (channels=${fmt.numChannels})`);
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`Only 16-bit WAV is supported (bits=${fmt.bitsPerSample})`);
  }

  const samples = new Int16Array(
    pcmData.buffer,
    pcmData.byteOffset,
    Math.floor(pcmData.byteLength / 2)
  );
  return {
    sampleRate: fmt.sampleRate,
    samples: Int16Array.from(samples),
  };
}

function writeWavPcm16Mono(filePath, sampleRate, pcmBuffer) {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = pcmBuffer.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  fs.writeFileSync(filePath, wav);
}

function resamplePcm16Linear(input, inputRate, outputRate) {
  if (inputRate === outputRate) return Int16Array.from(input);
  if (!input.length) return new Int16Array(0);
  const outputLength = Math.max(1, Math.floor((input.length * outputRate) / inputRate));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const src = (i * inputRate) / outputRate;
    const index = Math.floor(src);
    const frac = src - index;
    const a = input[Math.min(index, input.length - 1)];
    const b = input[Math.min(index + 1, input.length - 1)];
    output[i] = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac)));
  }
  return output;
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

function pcm16ToMulawBuffer(samples) {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = pcm16ToMulawSample(samples[i]);
  }
  return out;
}

function mulawBufferToPcm16(buffer) {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    out[i] = mulawToPcm16Sample(buffer[i]);
  }
  return out;
}

function int16ToBuffer(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    out.writeInt16LE(samples[i], i * 2);
  }
  return out;
}

function parsePcm16FromBuffer(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = buffer.readInt16LE(i * 2);
  }
  return out;
}

function parseWavChunk(buffer) {
  if (buffer.length < 44) {
    return null;
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let sampleRate = null;
  let bitsPerSample = null;
  let channels = null;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) break;

    if (chunkId === 'fmt ') {
      if (chunkSize >= 16) {
        channels = buffer.readUInt16LE(chunkStart + 2);
        sampleRate = buffer.readUInt32LE(chunkStart + 4);
        bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      }
    } else if (chunkId === 'data') {
      dataStart = chunkStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (dataStart < 0 || bitsPerSample !== 16 || channels !== 1) {
    return null;
  }
  const pcm = buffer.subarray(dataStart, Math.min(dataStart + dataSize, buffer.length));
  return {
    sampleRate: sampleRate || 24000,
    pcm,
  };
}

function randomStreamSid() {
  return `MZ${crypto.randomBytes(16).toString('hex')}`;
}

function usage() {
  console.log(`Usage:
  npm run client:twilio -- --input=./samples/me.wav
  npm run client:twilio -- --input=./samples/me.wav --mode=bridge --provider=gemini --language=hi-IN
  npm run client:twilio -- --input=./samples/me.wav --mode=twilio

Options:
  --input=<mono PCM16 wav file>
  --url=ws://127.0.0.1:8081/
  --mode=bridge|twilio                  (default: bridge)
  --chunk-ms=20
  --provider=groq|cerebras|gemini|sarvam
  --language=hi-IN|gu-IN|en-IN
  --tts-language=hi-IN|gu-IN|en-IN
  --server-audio-rate=24000             (fallback for raw output chunks)
  --stream-sid=<custom sid>
  --no-realtime                          (send as fast as possible)
  --save-twilio-ulaw=<path.ulaw>        (assistant audio in Twilio format)
  --save-twilio-jsonl=<path.jsonl>      (assistant Twilio media events)
  --save-assistant-wav=<path.wav>       (assistant decoded audio, 8k PCM16)
  --verbose`);
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    process.exit(0);
  }

  const inputPath = getArgValue('--input');
  if (!inputPath) {
    throw new Error('Missing --input=<wav>');
  }

  const defaultUrl = `ws://127.0.0.1:${parseNumber(process.env.PORT, 8081)}/`;
  const wsUrl = getArgValue('--url', process.env.VOICE_SERVER_URL || defaultUrl);
  const mode = parseMode(getArgValue('--mode', 'bridge'));
  const chunkMs = Math.max(10, Math.round(parseNumber(getArgValue('--chunk-ms', '20'), 20)));
  const realtime = !hasFlag('--no-realtime');
  const provider = String(getArgValue('--provider', process.env.DEFAULT_PROVIDER || 'gemini')).toLowerCase();
  const language = canonicalLanguageCode(
    getArgValue('--language', process.env.SARVAM_STT_LANGUAGE_CODE || 'gu-IN')
  );
  const ttsLanguage = canonicalLanguageCode(getArgValue('--tts-language', language));
  const streamSid = getArgValue('--stream-sid', randomStreamSid());
  const verbose = hasFlag('--verbose');
  const saveTwilioUlawPath = getArgValue('--save-twilio-ulaw');
  const saveTwilioJsonlPath = getArgValue('--save-twilio-jsonl');
  const saveAssistantWavPath = getArgValue('--save-assistant-wav');
  const fallbackServerAudioRate = Math.max(
    8000,
    Math.round(parseNumber(getArgValue('--server-audio-rate', '24000'), 24000))
  );

  const resolvedInputPath = path.resolve(inputPath);
  const inputWav = parseWavPcm16Mono(resolvedInputPath);
  const inputAt16k = resamplePcm16Linear(inputWav.samples, inputWav.sampleRate, 16000);
  const inputAt8k = resamplePcm16Linear(inputAt16k, 16000, 8000);
  const inputMulaw = pcm16ToMulawBuffer(inputAt8k);
  const chunkBytes = Math.max(80, Math.round((8000 * chunkMs) / 1000));

  log(
    `connect url=${wsUrl} mode=${mode} streamSid=${streamSid} input_samples_16k=${inputAt16k.length} chunk_ms=${chunkMs}`
  );

  const ws = new WebSocket(wsUrl);
  const state = {
    ready: mode === 'twilio',
    started: false,
    doneSending: false,
    outboundTwilioFrames: 0,
    inboundTwilioFrames: 0,
    inboundTwilioBytes: 0,
    currentServerAudioRate: fallbackServerAudioRate,
    twilioOutboundUlawChunks: [],
    twilioOutboundJsonLines: [],
    twilioOutboundPcm8Chunks: [],
  };

  async function streamInput() {
    if (state.started) return;
    state.started = true;

    const connectedEvent = {
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0',
      streamSid,
      atIso: nowIso(),
    };
    vlog(verbose, `twilio_connected ${JSON.stringify(connectedEvent)}`);

    const startEvent = {
      event: 'start',
      sequenceNumber: '1',
      streamSid,
      start: {
        streamSid,
        tracks: ['inbound'],
        mediaFormat: {
          encoding: 'audio/x-mulaw',
          sampleRate: 8000,
          channels: 1,
        },
      },
    };

    if (mode === 'twilio') {
      ws.send(JSON.stringify(startEvent));
    }

    for (let offset = 0, chunkIndex = 0; offset < inputMulaw.length; offset += chunkBytes, chunkIndex += 1) {
      const ulawChunk = inputMulaw.subarray(offset, Math.min(offset + chunkBytes, inputMulaw.length));
      const payload = ulawChunk.toString('base64');
      const mediaEvent = {
        event: 'media',
        streamSid,
        media: {
          payload,
          track: 'inbound',
          chunk: String(chunkIndex + 1),
          timestamp: String(chunkIndex * chunkMs),
        },
      };

      if (mode === 'twilio') {
        ws.send(JSON.stringify(mediaEvent));
      } else {
        // Force the same Twilio-quality path before forwarding to server.
        const decoded8k = mulawBufferToPcm16(ulawChunk);
        const upsampled16k = resamplePcm16Linear(decoded8k, 8000, 16000);
        ws.send(int16ToBuffer(upsampled16k));
      }

      state.outboundTwilioFrames += 1;
      if (verbose && (chunkIndex + 1) % 25 === 0) {
        vlog(verbose, `sent_twilio_frames=${state.outboundTwilioFrames}`);
      }
      if (realtime) {
        await sleep(chunkMs);
      }
    }

    const stopEvent = {
      event: 'stop',
      streamSid,
      stop: {
        callSid: 'SIMULATED_CALL',
        accountSid: 'SIMULATED_ACCOUNT',
      },
    };
    if (mode === 'twilio') {
      ws.send(JSON.stringify(stopEvent));
    }
    state.doneSending = true;
    log(`inbound stream complete frames=${state.outboundTwilioFrames}`);
  }

  function handleAssistantAudioChunk(audioBase64) {
    if (!audioBase64) return;
    const raw = Buffer.from(audioBase64, 'base64');
    let pcmSource = raw;
    let sourceRate = state.currentServerAudioRate;
    const wavChunk = parseWavChunk(raw);
    if (wavChunk) {
      pcmSource = wavChunk.pcm;
      sourceRate = wavChunk.sampleRate;
      state.currentServerAudioRate = sourceRate;
    }

    const pcmSamples = parsePcm16FromBuffer(pcmSource);
    const pcm8 = resamplePcm16Linear(pcmSamples, sourceRate, 8000);
    const ulawOut = pcm16ToMulawBuffer(pcm8);

    const twilioOut = {
      event: 'media',
      streamSid,
      media: { payload: ulawOut.toString('base64') },
    };
    state.inboundTwilioFrames += 1;
    state.inboundTwilioBytes += ulawOut.length;
    state.twilioOutboundUlawChunks.push(ulawOut);
    state.twilioOutboundPcm8Chunks.push(int16ToBuffer(pcm8));
    if (saveTwilioJsonlPath) {
      state.twilioOutboundJsonLines.push(JSON.stringify(twilioOut));
    }
  }

  ws.on('open', () => {
    log(`socket_open mode=${mode}`);
    if (mode === 'bridge') {
      ws.send(
        JSON.stringify({
          type: 'config',
          data: {
            config: {
              provider,
              language,
              ttsLanguage,
            },
          },
        })
      );
    }
    if (mode === 'twilio') {
      streamInput().catch((err) => {
        console.error(`[twilio-sim] stream_error ${err?.message || err}`);
      });
    }
  });

  ws.on('message', (raw) => {
    if (mode === 'twilio') {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.event === 'media' && msg?.media?.payload) {
        handleAssistantAudioChunk(msg.media.payload);
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg?.type === 'ready') {
      state.ready = true;
      log(
        `server_ready provider=${msg?.data?.provider || 'unknown'} stt=${msg?.data?.sttLanguage || 'n/a'} tts=${msg?.data?.ttsLanguage || 'n/a'}`
      );
      streamInput().catch((err) => {
        console.error(`[twilio-sim] stream_error ${err?.message || err}`);
      });
      return;
    }

    if (msg?.type === 'audio' && msg?.data?.audio) {
      handleAssistantAudioChunk(msg.data.audio);
      return;
    }

    if (msg?.type === 'transcript') {
      log(`transcript ${msg?.data?.transcript || ''}`);
      return;
    }

    if (msg?.type === 'metrics' && msg?.data?.type === 'provider_result') {
      vlog(verbose, `provider_result requestId=${msg?.data?.requestId || 'n/a'}`);
      return;
    }

    if (msg?.type === 'error') {
      log(`server_error ${msg?.data?.error || 'unknown_error'}`);
    }
  });

  ws.on('close', () => {
    log('socket_closed');
    finalizeOutputs();
  });

  ws.on('error', (err) => {
    console.error(`[twilio-sim] socket_error ${err?.message || err}`);
  });

  const autoCloseMs = Math.max(
    5000,
    Math.round((inputMulaw.length / 8000) * 1000) + (realtime ? 9000 : 2500)
  );

  setTimeout(() => {
    if (ws.readyState === ws.OPEN && state.doneSending) {
      ws.close();
    }
  }, autoCloseMs);

  function finalizeOutputs() {
    if (saveTwilioUlawPath) {
      const outPath = path.resolve(saveTwilioUlawPath);
      fs.writeFileSync(outPath, Buffer.concat(state.twilioOutboundUlawChunks));
      log(`saved_twilio_ulaw path=${outPath}`);
    }

    if (saveTwilioJsonlPath) {
      const outPath = path.resolve(saveTwilioJsonlPath);
      fs.writeFileSync(outPath, `${state.twilioOutboundJsonLines.join('\n')}\n`);
      log(`saved_twilio_jsonl path=${outPath}`);
    }

    if (saveAssistantWavPath) {
      const outPath = path.resolve(saveAssistantWavPath);
      const pcm = Buffer.concat(state.twilioOutboundPcm8Chunks);
      writeWavPcm16Mono(outPath, 8000, pcm);
      log(`saved_assistant_wav path=${outPath}`);
    }

    log(
      `summary sent_frames=${state.outboundTwilioFrames} recv_frames=${state.inboundTwilioFrames} recv_ulaw_bytes=${state.inboundTwilioBytes}`
    );
  }
}

main().catch((err) => {
  console.error(`[twilio-sim] fatal ${err?.message || err}`);
  process.exit(1);
});
