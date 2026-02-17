require('dotenv').config({ quiet: true });

const WebSocket = require('ws');
const { spawn } = require('child_process');

const ARGS = process.argv.slice(2);
const SUPPORTED_PROVIDERS = new Set(['groq', 'cerebras', 'sarvam']);

function hasFlag(flag) {
  return ARGS.includes(flag);
}

function getArgValue(prefix) {
  const arg = ARGS.find((a) => a.startsWith(`${prefix}=`));
  if (!arg) return null;
  const value = arg.slice(prefix.length + 1).trim();
  return value || null;
}

function canonicalLanguageCode(languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu' || normalized === 'gu-in') return 'gu-IN';
  if (normalized === 'hi' || normalized === 'hi-in') return 'hi-IN';
  if (normalized === 'en' || normalized === 'en-in') return 'en-IN';
  return String(languageCode || '').trim();
}

function resolveClientTtsLanguage(sttLanguage) {
  const explicit = getArgValue('--tts-language') || process.env.VOICE_CLIENT_TTS_LANGUAGE;
  if (explicit && String(explicit).trim()) {
    return canonicalLanguageCode(explicit);
  }
  const normalizedStt = canonicalLanguageCode(sttLanguage);
  return normalizedStt || 'gu-IN';
}

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (!SUPPORTED_PROVIDERS.has(normalized)) return '';
  return normalized;
}

function resolveProvider(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeProvider(candidate);
    if (normalized) return normalized;
  }
  return 'groq';
}

const SERVER_PORT = Number(process.env.PORT || 8081);
const SERVER_PATH = process.env.VOICE_SERVER_WS_PATH || '/';
const WS_URL =
  process.env.VOICE_SERVER_URL ||
  `ws://127.0.0.1:${Number.isFinite(SERVER_PORT) ? SERVER_PORT : 8081}${SERVER_PATH}`;
const MIC_DEVICE = process.env.MIC_DEVICE || 'pulse';
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'pulse';
const SAMPLE_RATE = Number(process.env.SARVAM_STT_SAMPLE_RATE || 16000);
const TTS_SAMPLE_RATE = Number(process.env.TTS_SAMPLE_RATE || process.env.VOICE_TTS_SAMPLE_RATE || 24000);
const PROVIDER = resolveProvider(
  getArgValue('--provider'),
  process.env.VOICE_PIPELINE_PROVIDER,
  process.env.DEFAULT_PROVIDER
);
const LANGUAGE = getArgValue('--language') || process.env.SARVAM_STT_LANGUAGE_CODE || 'gu-IN';
const TTS_LANGUAGE = resolveClientTtsLanguage(LANGUAGE);
const VERBOSE = hasFlag('--verbose') || String(process.env.VOICE_CLIENT_VERBOSE || 'false') === 'true';
const ENABLE_SPEAKER = !hasFlag('--no-speaker');
const SPEAKER_RESTART_DELAY_MS = Number(process.env.VOICE_SPEAKER_RESTART_DELAY_MS || 50);
const RECONNECT_ENABLED = !hasFlag('--no-reconnect');
const RECONNECT_INITIAL_DELAY_MS = Number(process.env.VOICE_CLIENT_RECONNECT_DELAY || 1000);
const RECONNECT_MAX_DELAY_MS = Number(process.env.VOICE_CLIENT_RECONNECT_MAX_DELAY || 10000);

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`Usage:
  npm run voice:client
  npm run voice:client -- --provider=groq --language=gu-IN
  npm run voice:client -- --provider=cerebras --language=hi-IN --verbose

Options:
  --provider=groq|cerebras|sarvam
  --language=hi-IN|gu-IN|en-IN
  --tts-language=hi-IN|en-IN|gu-IN
  --no-speaker
  --no-reconnect
  --verbose`);
  process.exit(0);
}

let ws = null;
let recorder = null;
let speaker = null;
let stopping = false;
let streamStarted = false;
let activeRequestId = null;
let speakerRestartPending = false;
let speakerReady = false;
let pendingAudioBuffers = [];
let speakerReadyTimer = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
const droppedRequestIds = new Set();
const WAV_HEADER_SIZE = 44;
const SPEAKER_STARTUP_MS = 80;

function nowIso() {
  return new Date().toISOString();
}

function log(line) {
  console.log(`[voice-client] ${line}`);
}

function vlog(line) {
  if (VERBOSE) {
    console.log(`[voice-client][debug] ${line}`);
  }
}

function flushPendingAudio() {
  if (!speaker || !speaker.stdin || speaker.stdin.destroyed) return;
  for (const buf of pendingAudioBuffers) {
    try {
      speaker.stdin.write(buf);
    } catch {}
  }
  pendingAudioBuffers = [];
}

function startSpeaker() {
  if (!ENABLE_SPEAKER) return;
  if (speaker) return;
  if (speakerRestartPending) return;
  speakerReady = false;
  pendingAudioBuffers = [];
  speaker = spawn('aplay', ['-q', '-D', SPEAKER_DEVICE, '-t', 'raw', '-f', 'S16_LE', '-c', '1', '-r', String(TTS_SAMPLE_RATE)], { stdio: ['pipe', 'ignore', 'pipe'] });
  // Give aplay time to initialize its ALSA buffers before writing audio
  speakerReadyTimer = setTimeout(() => {
    speakerReady = true;
    flushPendingAudio();
  }, SPEAKER_STARTUP_MS);
  speaker.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (!line) return;
    const normalized = line.toLowerCase();
    if (
      normalized.includes('read_header:2973: read error') ||
      normalized.includes('write error: interrupted system call')
    ) {
      vlog(`aplay_expected_interrupt message="${line}"`);
      return;
    }
    console.error(`[voice-client][aplay] ${line}`);
  });
  speaker.on('error', (err) => {
    console.error(`[voice-client][speaker-error] ${err?.message || err}`);
  });
  speaker.stdin.on('error', (err) => {
    const code = String(err?.code || '');
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return;
    console.error(`[voice-client][speaker-stdin-error] ${err?.message || err}`);
  });

  speaker.on('close', () => {
    speaker = null;
    speakerRestartPending = false;
  });
}

function stopSpeaker(immediate = false) {
  if (speakerReadyTimer) {
    clearTimeout(speakerReadyTimer);
    speakerReadyTimer = null;
  }
  speakerReady = false;
  pendingAudioBuffers = [];
  if (!speaker) return;
  try {
    if (speaker.stdin && !speaker.stdin.destroyed) {
      if (immediate) {
        speaker.stdin.destroy();
      } else {
        speaker.stdin.end();
      }
    }
  } catch {}
  try {
    speaker.kill(immediate ? 'SIGKILL' : 'SIGINT');
  } catch {}
  if (immediate) {
    speaker = null;
  }
}

function stripWavHeader(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }
  if (buffer.length > WAV_HEADER_SIZE) {
    const header = buffer.slice(0, 4).toString('ascii');
    if (header === 'RIFF') {
      return buffer.slice(WAV_HEADER_SIZE);
    }
  }
  return buffer;
}

function interruptSpeakerPlayback(reason) {
  if (!ENABLE_SPEAKER) return;
  vlog(`interrupt_speaker reason=${reason}`);
  stopSpeaker(true);
  speakerRestartPending = true;
  setTimeout(() => {
    speakerRestartPending = false;
  }, SPEAKER_RESTART_DELAY_MS);
}

function startRecorder() {
  if (recorder) return;
  recorder = spawn(
    'arecord',
    ['-q', '-D', MIC_DEVICE, '-f', 'S16_LE', '-c', '1', '-r', String(SAMPLE_RATE), '-t', 'wav'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  recorder.stdout.on('data', (chunk) => {
    if (!ws || ws.readyState !== ws.OPEN) return;
    if (!chunk || !chunk.length) return;
    ws.send(
      JSON.stringify({
        type: 'audio',
        data: {
          audio: chunk.toString('base64'),
        },
      })
    );
  });

  recorder.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[voice-client][arecord] ${line}`);
  });

  recorder.on('error', (err) => {
    console.error(`[voice-client][recorder-error] ${err?.message || err}`);
  });
}

function stopRecorder() {
  if (!recorder) return;
  try {
    recorder.kill('SIGINT');
  } catch {}
  recorder = null;
}

function handleServerMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const type = msg?.type;
  const data = msg?.data || {};

  if (type === 'ready') {
    log(
      `ready provider=${data.provider} stt_language=${data.sttLanguage} tts_language=${data.ttsLanguage ?? 'n/a'} started_at=${data.startedAtIso} runtime_tag=${data.runtimeTag || 'n/a'}`
    );
    if (!streamStarted) {
      startSpeaker();
      startRecorder();
      streamStarted = true;
      log('recording... speak now. press Ctrl+C to stop.');
    }
    return;
  }

  if (type === 'vad') {
    log(`vad=${data.vadSignal} segment=${data.segmentIndex ?? 'n/a'} duration_ms=${data.durationMs ?? 'n/a'}`);
    if (data.vadSignal === 'START_SPEECH') {
      // Immediately block old request audio so mid-stream bytes cannot hit a fresh player.
      if (activeRequestId) {
        droppedRequestIds.add(activeRequestId);
        vlog(`drop_active_request_on_vad_start req=${activeRequestId}`);
      }
      activeRequestId = null;
      interruptSpeakerPlayback('vad_start_speech');
    }
    return;
  }

  if (type === 'transcript') {
    console.log(`[transcript] ${data.transcript}`);
    return;
  }

  if (type === 'audio') {
    if (!ENABLE_SPEAKER) return;
    if (!data.audio) return;
    if (data.requestId && droppedRequestIds.has(data.requestId)) {
      return;
    }
    if (activeRequestId && data.requestId && data.requestId !== activeRequestId) {
      return;
    }
    if (!activeRequestId && data.requestId) {
      activeRequestId = data.requestId;
    }
    if (!speaker || !speaker.stdin || speaker.stdin.destroyed) {
      startSpeaker();
    }
    if (!speaker || !speaker.stdin || speaker.stdin.destroyed) return;
    try {
      const rawBuffer = Buffer.from(data.audio, 'base64');
      const pcmBuffer = stripWavHeader(rawBuffer);
      if (speakerReady) {
        speaker.stdin.write(pcmBuffer);
      } else {
        pendingAudioBuffers.push(pcmBuffer);
      }
    } catch (err) {
      const code = String(err?.code || '');
      if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED') {
        console.error(`[voice-client][speaker-write-error] ${err?.message || err}`);
      }
    }
    return;
  }

  if (type === 'metrics') {
    const metricType = data.type;
    if (metricType === 'provider_dispatch') {
      activeRequestId = data.requestId || null;
      if (activeRequestId) {
        droppedRequestIds.delete(activeRequestId);
      }
      return;
    }
    if (metricType === 'provider_discarded') {
      if (data.requestId) {
        droppedRequestIds.add(data.requestId);
      }
      if (activeRequestId && data.requestId === activeRequestId) {
        activeRequestId = null;
      }
      interruptSpeakerPlayback('provider_discarded');
      return;
    }
    if (metricType === 'provider_result') {
      activeRequestId = data.requestId || activeRequestId;
      if (activeRequestId) {
        droppedRequestIds.delete(activeRequestId);
      }
      log(
        `provider=${data.provider} req=${data.requestId} ttft_ms=${data.providerTtftMs ?? 'n/a'} tps=${data.tpsApprox ?? 'n/a'} finish_reason=${data.providerFinishReason ?? 'n/a'} prompt_to_first_chunk_ms=${data.promptToFirstChunkMs ?? 'n/a'} detection_end_to_first_audio_ms=${data.detectionEndToFirstAudioMs ?? 'n/a'}`
      );
      return;
    }
    if (metricType === 'provider_truncated') {
      console.warn(
        `[voice-client] provider_truncated req=${data.requestId} provider=${data.provider} finish_reason=${data.finishReason} max_tokens=${data.configuredMaxTokens ?? 'n/a'}`
      );
      return;
    }
    if (metricType === 'provider_stream_preview') {
      log(
        `stream_preview req=${data.requestId} idx=${data.previewIndex} reason=${data.reason} chars=${data.chars} text="${data.text}"`
      );
      return;
    }
    if (metricType === 'skip_tts_segment') {
      log(
        `skip_tts req=${data.requestId ?? 'n/a'} reason=${data.reason} lang=${data.ttsLanguage ?? 'n/a'} chars=${data.textChars ?? 'n/a'} preview="${data.textPreview || ''}"`
      );
      return;
    }
    if (metricType === 'tts_language_fallback') {
      log(
        `tts_language_fallback source=${data.source ?? 'n/a'} requested=${data.requested ?? 'n/a'} applied=${data.applied ?? 'n/a'} reason=${data.reason ?? 'n/a'}`
      );
      return;
    }
    if (metricType === 'llm_config_updated') {
      log(
        `llm_config_updated provider=${data.provider ?? 'n/a'} groq_model=${data.groqModel ?? 'n/a'} cerebras_model=${data.cerebrasModel ?? 'n/a'}`
      );
      return;
    }
    if (metricType === 'barge_in') {
      if (data.requestId) {
        droppedRequestIds.add(data.requestId);
      }
      if (activeRequestId && data.requestId === activeRequestId) {
        activeRequestId = null;
      }
      interruptSpeakerPlayback('barge_in');
      log(`barge_in req=${data.requestId} provider=${data.provider} reason=${data.reason}`);
      return;
    }
    if (metricType === 'provider_aborted') {
      if (data.requestId) {
        droppedRequestIds.add(data.requestId);
      }
      if (activeRequestId && data.requestId === activeRequestId) {
        activeRequestId = null;
      }
      interruptSpeakerPlayback('provider_aborted');
      vlog(`provider_aborted req=${data.requestId} provider=${data.provider}`);
      return;
    }
    if (metricType === 'stt_first_message_latency') {
      log(
        `stt_first_message request_to_first_ms=${data.requestToFirstMessageMs ?? 'n/a'} first_chunk_to_first_ms=${data.firstChunkToFirstMessageMs ?? 'n/a'}`
      );
      return;
    }
    vlog(`metric type=${metricType}`);
    return;
  }

  if (type === 'error') {
    console.error(`[voice-client][server-error] ${data.error}`);
    return;
  }

  vlog(`unhandled type=${type}`);
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log('stopping...');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopRecorder();
  stopSpeaker();
  if (ws && ws.readyState === ws.OPEN) {
    ws.close();
  }
  process.exit(0);
}

function getReconnectDelay() {
  const baseDelay = RECONNECT_INITIAL_DELAY_MS;
  const maxDelay = RECONNECT_MAX_DELAY_MS;
  const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

function scheduleReconnect() {
  if (stopping || !RECONNECT_ENABLED) {
    return;
  }
  reconnectAttempts += 1;
  const delay = getReconnectDelay();
  log(`reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopping) return;

  log(`connecting url=${WS_URL}`);
  log(`config provider=${PROVIDER} language=${LANGUAGE} tts_language=${TTS_LANGUAGE} mic_device=${MIC_DEVICE} speaker_enabled=${ENABLE_SPEAKER} reconnect=${RECONNECT_ENABLED}`);

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    reconnectAttempts = 0;
    log(`connected at=${nowIso()}`);

    ws.send(
      JSON.stringify({
        type: 'config',
        data: {
          config: {
            provider: PROVIDER,
            language: LANGUAGE,
            ttsLanguage: TTS_LANGUAGE,
          },
        },
      })
    );
  });

  ws.on('message', (raw) => {
    handleServerMessage(raw);
  });

  ws.on('error', (err) => {
    console.error(`[voice-client][ws-error] ${err?.message || err}`);
  });

  ws.on('close', (event) => {
    log(`socket_closed code=${event?.code ?? 'n/a'}`);
    stopRecorder();
    stopSpeaker();
    streamStarted = false;
    activeRequestId = null;
    droppedRequestIds.clear();

    if (!stopping) {
      if (RECONNECT_ENABLED) {
        scheduleReconnect();
      } else {
        process.exit(1);
      }
    }
  });
}

function main() {
  connect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
