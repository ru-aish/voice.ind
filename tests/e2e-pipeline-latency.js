/**
 * Full pipeline E2E latency (production VoicePipeline).
 * TTS text → REST PCM → streamed STT → live dispatch → Groq → Deepgram TTS.
 * Metric: speech end (or stream stop) → first response audio (target ≤ 800ms).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const { loadConfig } = require('../src/config');
const { VoicePipeline } = require('../src/core/pipeline/voice-pipeline');
const { VAD_SIGNALS } = require('../src/config/constants');

const INPUT_TEXT =
  process.env.E2E_INPUT_TEXT || 'I need to book a dental checkup tomorrow morning.';
const CHUNK_BYTES = 1280;
const CHUNK_INTERVAL_MS = 40;
const TRAILING_SILENCE_MS = 900;
const TARGET_MS = Number(process.env.E2E_TARGET_MS || 800);
const VERBOSE = process.argv.includes('--verbose');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pcmWithSilence(pcm) {
  const pad = Math.floor(16000 * 2 * (TRAILING_SILENCE_MS / 1000));
  return Buffer.concat([pcm, Buffer.alloc(pad)]);
}

async function synthesizeInputPcmRest(text, apiKey, config) {
  const params = new URLSearchParams({
    model: config.tts.deepgramModel,
    encoding: config.tts.deepgramEncoding,
    container: 'wav',
    sample_rate: String(config.tts.deepgramSampleRate),
  });
  const url = `https://api.deepgram.com/v1/speak?${params.toString()}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`input TTS failed: ${response.status} ${await response.text()}`);
  }
  const wav = Buffer.from(await response.arrayBuffer());
  if (wav.length <= 44) {
    throw new Error('input TTS returned empty wav');
  }
  return pcmWithSilence(wav.slice(44));
}

async function runPipelineTurn(config, pcm) {
  const pipeline = new VoicePipeline({
    sessionId: 'e2e-latency',
    config: {
      ...config,
      groq: {
        ...config.groq,
        systemPrompt:
          process.env.E2E_SYSTEM_PROMPT ||
          'You are a voice assistant. Reply in under 10 words. No markdown.',
        maxCompletionTokens: Math.min(config.groq.maxCompletionTokens, 60),
      },
    },
  });

  const state = {
    streamStopAtMs: null,
    speechEndAtMs: null,
    liveDispatchAtMs: null,
    firstAudioAtMs: null,
    providerResult: null,
    lastTranscript: '',
    dispatchReason: null,
  };

  pipeline.on('metrics', (m) => {
    if (VERBOSE && (m.type === 'stt_message' || m.type === 'provider_dispatch')) {
      console.log(`  [metric] ${m.type} ${m.reason || m.summary || ''}`);
    }
    if (m.type === 'provider_dispatch') {
      state.dispatchReason = m.reason;
      if (m.reason === 'live_transcript') {
        state.liveDispatchAtMs = m.providerSendAtMs;
      }
    }
    if (m.type === 'provider_result') {
      state.providerResult = m;
    }
  });

  pipeline.on('transcript', (t) => {
    if (t.text) state.lastTranscript = t.text;
    if (VERBOSE) {
      console.log(`  [stt] ${t.isFinal ? 'final' : 'interim'} "${t.text}" active=${t.speechActive}`);
    }
  });

  pipeline.on('vad', (v) => {
    if (v.signal === VAD_SIGNALS.END) {
      state.speechEndAtMs = v.endedAtMs || Date.now();
      if (VERBOSE) console.log(`  [vad] END_SPEECH segment=${v.segmentIndex}`);
    }
    if (VERBOSE && v.signal === VAD_SIGNALS.START) {
      console.log(`  [vad] START_SPEECH segment=${v.segmentIndex}`);
    }
  });

  pipeline.on('audio', (payload) => {
    if (!state.firstAudioAtMs) {
      state.firstAudioAtMs = payload.atMs || Date.now();
      if (VERBOSE) console.log(`  [tts] first audio chunk at ${state.firstAudioAtMs}`);
    }
  });

  pipeline.on('error', (e) => {
    console.error(`  [pipeline-error] ${e.error || e.message || e}`);
  });

  await pipeline.start();
  await sleep(400);

  let offset = 0;
  while (offset < pcm.length) {
    pipeline.handleAudioChunk(pcm.subarray(offset, offset + CHUNK_BYTES));
    offset += CHUNK_BYTES;
    await sleep(CHUNK_INTERVAL_MS);
  }

  state.streamStopAtMs = Date.now();
  if (VERBOSE) console.log(`  [e2e] stream finished at ${state.streamStopAtMs}`);

  const deadline = Date.now() + 60000;
  while (!state.firstAudioAtMs && Date.now() < deadline) {
    await sleep(50);
  }

  await pipeline.stop();

  const stopRef = state.streamStopAtMs;
  const stopToFirstAudioMs =
    stopRef && state.firstAudioAtMs ? Math.max(0, state.firstAudioAtMs - stopRef) : null;
  const speechEndToFirstAudioMs =
    state.speechEndAtMs && state.firstAudioAtMs
      ? Math.max(0, state.firstAudioAtMs - state.speechEndAtMs)
      : null;

  return {
    ...state,
    stopToFirstAudioMs,
    speechEndToFirstAudioMs,
    liveDispatchLeadMs:
      state.liveDispatchAtMs && stopRef ? stopRef - state.liveDispatchAtMs : null,
    providerTtftMs: state.providerResult?.providerTtftMs ?? null,
    firstTtsSendToChunkMs: state.providerResult?.firstTtsSendToFirstChunkMs ?? null,
    promptToFirstChunkMs: state.providerResult?.promptToFirstChunkMs ?? null,
    liveDispatchUsed: state.liveDispatchAtMs != null,
    dispatchReason: state.dispatchReason,
  };
}

function printReport(result, config) {
  console.log('\n================================================================');
  console.log('  PIPELINE E2E LATENCY (stop → first audio)');
  console.log('================================================================');
  console.log(`Input          : "${INPUT_TEXT}"`);
  console.log(`LLM            : ${config.llm.provider} (${config.groq.model})`);
  console.log(`STT / TTS      : ${config.stt.provider} / ${config.tts.provider}`);
  console.log(`Live dispatch  : min ${config.pipeline.sendOnTranscriptMinChars} chars, debounce ${config.pipeline.sendOnTranscriptDebounceMs}ms`);
  console.log('');
  console.log(`STT heard      : "${result.lastTranscript || '(none)'}"`);
  console.log(`Dispatch path  : ${result.dispatchReason || 'none'}`);
  console.log(`Live dispatch  : ${result.liveDispatchUsed ? 'yes' : 'NO'}`);
  if (result.liveDispatchLeadMs != null) {
    console.log(`Live lead time : ${result.liveDispatchLeadMs} ms before stop`);
  }
  console.log(`Groq TTFT      : ${result.providerTtftMs ?? 'n/a'} ms`);
  console.log(`TTS after send : ${result.firstTtsSendToChunkMs ?? 'n/a'} ms`);
  console.log('');
  const feltMs =
    result.stopToFirstAudioMs != null
      ? result.stopToFirstAudioMs
      : result.speechEndToFirstAudioMs;
  console.log(`★ FELT LATENCY (stop → first audio) : ${feltMs ?? 'TIMEOUT'} ms`);
  if (result.liveDispatchLeadMs != null && result.liveDispatchLeadMs > 500) {
    console.log(`  (response started ${result.liveDispatchLeadMs} ms BEFORE you stopped — preemptive path)`);
  }
  if (result.speechEndToFirstAudioMs != null && result.speechEndToFirstAudioMs !== feltMs) {
    console.log(`  (VAD end → first audio           : ${result.speechEndToFirstAudioMs} ms)`);
  }
  const ok = feltMs != null && feltMs <= TARGET_MS;
  console.log(`Target ≤ ${TARGET_MS} ms     : ${ok ? 'PASS ✓' : 'FAIL ✗'}`);
  if (result.providerResult?.generatedText) {
    console.log(`Reply: "${result.providerResult.generatedText}"`);
  }
  console.log('================================================================\n');
  return ok;
}

async function main() {
  const config = loadConfig();
  if (!config.keys.deepgramApiKey || !config.keys.groqApiKey) {
    console.error('Need DEEPGRAM_API_KEY and GROQ_API_KEY');
    process.exit(1);
  }

  console.log('[e2e] Building input speech (REST TTS)...');
  const pcm = await synthesizeInputPcmRest(INPUT_TEXT, config.keys.deepgramApiKey, config);
  console.log(`[e2e] Input audio: ${Math.round(pcm.length / 32)} ms of PCM`);

  console.log('[e2e] Running VoicePipeline with preemptive live dispatch...');
  const result = await runPipelineTurn(config, pcm);
  const pass = printReport(result, config);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});