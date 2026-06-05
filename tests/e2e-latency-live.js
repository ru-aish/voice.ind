require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

/**
 * End-to-end latency harness: live mic OR simulated streaming → Deepgram STT → Codex → Deepgram TTS.
 *
 * Measures what a user actually feels: time from end-of-speech to first audible response.
 * Mirrors production optimizations: preemptive LLM dispatch on interim transcript (sendOnTranscript).
 *
 * Usage:
 *   node tests/e2e-latency-live.js              # live microphone (arecord)
 *   node tests/e2e-latency-live.js --simulate   # stream TTS-generated audio like a real mic
 *   node tests/e2e-latency-live.js --turns=3    # multiple turns on one Codex thread (caching)
 *
 * Prerequisite: `codex login` (ChatGPT Plus session). Check with: codex whoami
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const { getGlobalCodexClient } = require('../src/core/llm/codex-provider');
const globalCodexClient = getGlobalCodexClient();
const { DeepgramTtsClient } = require('../src/core/tts/deepgram-tts-client');

const ARGS = process.argv.slice(2);
const SIMULATE = ARGS.includes('--simulate');
const TURNS = Math.max(1, Number((ARGS.find((a) => a.startsWith('--turns=')) || '').split('=')[1]) || 2);
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TURN_TIMEOUT_MS || 90000);

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const MIC_DEVICE = process.env.MIC_DEVICE || 'default';
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-5.5';
const CODEX_EFFORT = process.env.CODEX_REASONING_EFFORT || 'low';
const ENDPOINTING_MS = Number(process.env.DEEPGRAM_ENDPOINTING_MS || 300);

const SYSTEM_PROMPT =
  process.env.CODEX_SYSTEM_PROMPT ||
  'You are a helpful voice assistant. Reply in under 12 words. No markdown.';

const SEND_ON_TRANSCRIPT = process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT !== 'false';
const SEND_ON_TRANSCRIPT_MIN_CHARS = Number(
  process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT_MIN_CHARS || 12
);
const SEND_ON_TRANSCRIPT_DEBOUNCE_MS = Number(
  process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT_DEBOUNCE_MS || 300
);

const SIM_PROMPTS = [
  'Hello, I need to book a dental checkup for tomorrow.',
  'Is there any slot available in the morning?',
  'Yes, book the earliest one please.',
];

let codexThreadId = null;
let sttSocket = null;
let recorder = null;
let speaker = null;
let deepgramTts = null;

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

function msSince(t0) {
  return t0 == null ? null : Date.now() - t0;
}

async function ensureDeepgramTts() {
  if (!deepgramTts) {
    deepgramTts = new DeepgramTtsClient({ apiKey: DEEPGRAM_API_KEY });
    await deepgramTts.connect();
    await deepgramTts.warmup();
    log('Deepgram TTS connected + warmed up');
  }
  return deepgramTts;
}

async function deepgramTtsWav(text) {
  const client = await ensureDeepgramTts();
  const chunks = [];
  await client.speak(text, {
    onChunk: (chunk) => chunks.push(chunk),
  });
  return Buffer.concat(chunks);
}

async function streamDeepgramTtsPcm(text, onChunk) {
  const client = await ensureDeepgramTts();
  let totalBytes = 0;
  let firstChunkLatencyMs = null;
  const result = await client.speak(text, {
    onChunk: (chunk, ttftMs) => {
      if (firstChunkLatencyMs === null && ttftMs != null) {
        firstChunkLatencyMs = ttftMs;
      }
      totalBytes += chunk.length;
      onChunk(chunk, ttftMs);
    },
  });
  return {
    firstChunkLatencyMs: result.firstChunkLatencyMs ?? firstChunkLatencyMs,
    totalLatencyMs: result.totalMs,
    totalBytes,
  };
}

function startSpeaker() {
  if (speaker) {
    try {
      speaker.stdin.destroy();
    } catch {}
    try {
      speaker.kill('SIGKILL');
    } catch {}
  }
  speaker = spawn(
    'aplay',
    ['-q', '-D', process.env.SPEAKER_DEVICE || 'default', '-t', 'raw', '-f', 'S16_LE', '-c', '1', '-r', '16000'],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
}

function abortSpeaker() {
  if (!speaker) return;
  try {
    speaker.stdin.destroy();
    speaker.kill('SIGKILL');
  } catch {}
  speaker = null;
}

function belongsToTurn(params, threadId, turnId) {
  if (params.turnId === turnId || params.threadId === threadId) return true;
  const nested = params.turn || {};
  return nested.id === turnId;
}

function codexTurn(threadId, promptText) {
  return new Promise((resolve, reject) => {
    const finalPrompt = `${SYSTEM_PROMPT}\n\nUser: ${promptText}`;
    const tPromptSent = Date.now();
    let firstTokenAt = null;
    let replyText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Codex turn timed out after ${CODEX_TIMEOUT_MS}ms`));
    }, CODEX_TIMEOUT_MS);

    globalCodexClient
      .request('turn/start', {
        threadId,
        input: [{ type: 'text', text: finalPrompt }],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
        model: CODEX_MODEL,
        effort: CODEX_EFFORT,
      })
      .then((turnResp) => {
        const turnId = turnResp.turn.id;

        const handleNotification = (msg) => {
          const method = msg.method;
          const params = msg.params || {};
          if (!belongsToTurn(params, threadId, turnId)) return;

          if (method === 'item/agentMessage/delta') {
            const delta = params.delta || '';
            if (delta) {
              if (firstTokenAt == null) firstTokenAt = Date.now();
              replyText += delta;
            }
          } else if (method === 'turn/completed') {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve({
              promptSentAt: tPromptSent,
              firstTokenAt,
              completedAt: Date.now(),
              text: replyText.trim(),
            });
          }
        };

        const cleanup = () => globalCodexClient.off('notification', handleNotification);
        globalCodexClient.on('notification', handleNotification);
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

function pcmWithTrailingSilence(pcm, silenceMs = 900) {
  const silenceBytes = Math.floor(16000 * 2 * (silenceMs / 1000));
  return Buffer.concat([pcm, Buffer.alloc(silenceBytes)]);
}

function runSttTurn({ pcmBuffer, turnLabel, streamMic = false }) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=${ENDPOINTING_MS}&vad_signals=true`;
    const socket = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    let accumulated = '';
    let lastInterim = '';
    let speechEndAt = null;
    let speechFinalAt = null;
    let liveDispatchAt = null;
    let liveDispatchText = '';
    let llmPromise = null;
    let llmSource = null;
    let lastLiveSentAt = 0;
    let lastLiveSentText = '';
    let offset = 0;
    let chunkTimer = null;
    let turnDone = false;
    let lastAudioSentAt = null;
    const chunkSize = 1280;
    const streamPcm = pcmBuffer ? pcmWithTrailingSilence(pcmBuffer) : null;

    const maybeLiveDispatch = (interimText) => {
      if (!SEND_ON_TRANSCRIPT || llmPromise) return;
      const text = String(interimText || '').trim();
      if (text.length < SEND_ON_TRANSCRIPT_MIN_CHARS) return;
      if (text === lastLiveSentText) return;
      const now = Date.now();
      if (now - lastLiveSentAt < SEND_ON_TRANSCRIPT_DEBOUNCE_MS) return;

      lastLiveSentAt = now;
      lastLiveSentText = text;
      liveDispatchAt = now;
      liveDispatchText = text;
      llmSource = 'live_transcript';
      log(`${turnLabel}: preemptive Codex dispatch at ${text.length} chars ("${text.slice(0, 40)}...")`);
      llmPromise = codexTurn(codexThreadId, text);
    };

    const finalizeTurn = async (finalText) => {
      if (turnDone) return;
      turnDone = true;
      clearInterval(chunkTimer);
      clearTimeout(fallbackTimer);

      if (!llmPromise) {
        llmSource = 'speech_final';
        llmPromise = codexTurn(codexThreadId, finalText);
      }

      try {
        const llm = await llmPromise;
        startSpeaker();
        let firstAudioAt = null;
        let ttsMetrics = null;

        try {
          console.log(`\n  [Codex Response]: "${llm.text}" (${llm.text.length} chars)`);
          ttsMetrics = await streamDeepgramTtsPcm(llm.text, (chunk, latencyMs) => {
            if (firstAudioAt === null) {
              firstAudioAt = Date.now();
            }
            if (speaker?.stdin && !speaker.stdin.destroyed) {
              speaker.stdin.write(chunk);
            }
          });
        } finally {
          if (speaker?.stdin) {
            speaker.stdin.end();
          }
        }

        if (firstAudioAt === null) {
          firstAudioAt = Date.now();
        }

        const metrics = {
          turnLabel,
          transcript: finalText,
          llmSource,
          endpointingMs: ENDPOINTING_MS,
          sttEndpointingMs: speechFinalAt && speechEndAt ? speechFinalAt - speechEndAt : null,
          liveDispatchLeadMs:
            liveDispatchAt && speechEndAt ? speechEndAt - liveDispatchAt : null,
          stopToFinalTranscriptMs: speechFinalAt && speechEndAt ? speechFinalAt - speechEndAt : null,
          stopToLlmFirstTokenMs: llm.firstTokenAt && speechEndAt ? llm.firstTokenAt - speechEndAt : null,
          stopToFirstAudioMs: speechEndAt ? firstAudioAt - speechEndAt : null,
          llmTtftFromPromptMs:
            llm.firstTokenAt && llm.promptSentAt ? llm.firstTokenAt - llm.promptSentAt : null,
          ttsGenerationMs: ttsMetrics ? ttsMetrics.firstChunkLatencyMs : null,
          totalStopToAudioMs: speechEndAt ? firstAudioAt - speechEndAt : null,
          llmText: llm.text,
        };
        resolve(metrics);
      } catch (err) {
        reject(err);
      }
    };

    const tryFinalizeFromAccumulated = async (reason) => {
      const text = accumulated.trim() || lastInterim.trim();
      if (!text || turnDone) return;
      if (!speechEndAt && lastAudioSentAt) {
        speechEndAt = lastAudioSentAt;
      }
      if (!speechFinalAt) {
        speechFinalAt = Date.now();
      }
      log(`${turnLabel}: finalize via ${reason}`);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      await finalizeTurn(text);
    };

    const fallbackTimer = setTimeout(() => {
      tryFinalizeFromAccumulated('timeout').catch(reject);
    }, 45000);

    socket.on('open', () => {
      if (streamMic) {
        startMicStreaming();
        return;
      }
      if (SIMULATE && streamPcm) {
        chunkTimer = setInterval(() => {
          if (offset >= streamPcm.length) {
            clearInterval(chunkTimer);
            lastAudioSentAt = Date.now();
            socket.send(JSON.stringify({ type: 'CloseStream' }));
            return;
          }
          socket.send(streamPcm.subarray(offset, offset + chunkSize));
          offset += chunkSize;
        }, 40);
      }
    });

    socket.on('message', async (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === 'SpeechStarted' || data.signal === 'START_SPEECH') {
        abortSpeaker();
        accumulated = '';
        lastInterim = '';
        speechEndAt = null;
        speechFinalAt = null;
        liveDispatchAt = null;
        liveDispatchText = '';
        llmPromise = null;
        llmSource = null;
        lastLiveSentAt = 0;
        lastLiveSentText = '';
      }

      if (data.type === 'SpeechEnded' || data.signal === 'END_SPEECH') {
        speechEndAt = Date.now();
      }

      const transcript = data.channel?.alternatives?.[0]?.transcript || '';
      if (transcript && !data.speech_final) {
        lastInterim = transcript;
        process.stdout.write(`\r  hearing: "${accumulated} ${transcript}"`.padEnd(80));
        maybeLiveDispatch(`${accumulated} ${transcript}`.trim());
      }

      if (data.is_final && transcript) {
        accumulated = accumulated ? `${accumulated} ${transcript}` : transcript;
      }

      if (data.speech_final && accumulated.trim()) {
        speechFinalAt = Date.now();
        if (!speechEndAt) {
          speechEndAt = speechFinalAt - ENDPOINTING_MS;
        }
        console.log(`\n  final: "${accumulated.trim()}"`);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
        await finalizeTurn(accumulated.trim());
      }
    });

    socket.on('error', (err) => {
      clearInterval(chunkTimer);
      clearTimeout(fallbackTimer);
      reject(err);
    });

    socket.on('close', () => {
      clearInterval(chunkTimer);
      clearTimeout(fallbackTimer);
      tryFinalizeFromAccumulated('socket_close').catch(reject);
    });

    sttSocket = socket;
  });
}

function startMicStreaming() {
  recorder = spawn(
    'arecord',
    ['-q', '-D', MIC_DEVICE, '-f', 'S16_LE', '-c', '1', '-r', '16000', '-t', 'raw'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  recorder.stdout.on('data', (chunk) => {
    if (sttSocket?.readyState === WebSocket.OPEN) {
      sttSocket.send(chunk);
    }
  });
}

function printReport(allMetrics) {
  console.log('\n================================================================');
  console.log('           END-TO-END LATENCY (stop speaking → first audio)');
  console.log('================================================================');
  console.log(
    '| Turn | LLM start      | STT after stop | LLM after stop | TTS gen | TOTAL (felt) |'
  );
  console.log(
    '|------|----------------|---------------|----------------|---------|----------------|'
  );
  for (const m of allMetrics) {
    console.log(
      `| ${String(m.turnLabel).padEnd(4)} | ${String(m.llmSource).padEnd(14)} | ${fmt(m.sttEndpointingMs)} | ${fmt(m.stopToLlmFirstTokenMs)} | ${fmt(m.ttsGenerationMs)} | ${fmt(m.totalStopToAudioMs)} |`
    );
  }
  console.log('================================================================\n');
  if (allMetrics.some((m) => m.liveDispatchLeadMs > 0)) {
    console.log(
      'Note: live_transcript dispatch starts the LLM before you finish speaking.',
    );
    console.log(
      'TOTAL (felt) can be much lower than uncached Codex TTFT (~2.5s on turn 1).',
    );
  }
}

function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a'.padStart(13);
  return `${Math.round(ms)} ms`.padStart(14);
}

async function warmupDeepgramTts() {
  await ensureDeepgramTts();
}

async function main() {
  if (!DEEPGRAM_API_KEY) {
    console.error('Set DEEPGRAM_API_KEY in the environment.');
    process.exit(1);
  }

  console.log('================================================================');
  console.log('  Codex + Deepgram E2E Latency (streaming, production-like)');
  console.log('================================================================');
  console.log(`Mode           : ${SIMULATE ? 'simulated mic stream' : 'live microphone'}`);
  console.log(`Codex          : ${CODEX_MODEL} (effort=${CODEX_EFFORT})`);
  console.log(`Preemptive LLM : ${SEND_ON_TRANSCRIPT ? `yes (>=${SEND_ON_TRANSCRIPT_MIN_CHARS} chars)` : 'no'}`);
  console.log(`STT            : nova-3 endpointing=${ENDPOINTING_MS}ms\n`);

  log('Starting Codex app-server...');
  const warmupPromise = warmupDeepgramTts().catch(() => {});
  await globalCodexClient.start();
  const threadResp = await globalCodexClient.request('thread/start', {
    cwd: process.env.CODEX_CWD || '/home/coder/Code/playground',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    model: CODEX_MODEL,
  });
  codexThreadId = threadResp.thread.id;
  log(`Codex thread: ${codexThreadId}`);

  const allMetrics = [];

  if (SIMULATE) {
    for (let i = 0; i < TURNS; i += 1) {
      const prompt = SIM_PROMPTS[i % SIM_PROMPTS.length];
      log(`Turn ${i + 1}: generating speech for "${prompt.slice(0, 50)}..."`);
      const pcm = await deepgramTtsWav(prompt);
      const metrics = await runSttTurn({ pcmBuffer: pcm, turnLabel: `T${i + 1}` });
      allMetrics.push(metrics);
      await new Promise((r) => setTimeout(r, 800));
    }
  } else {
    log('Mic + STT ready. Speak a sentence, then pause. Ctrl+C to exit.');
    const metrics = await runSttTurn({ pcmBuffer: null, turnLabel: 'live', streamMic: true });
    allMetrics.push(metrics);
    printReport(allMetrics);
    log('Turn complete. Speak again for another measurement, or Ctrl+C.');
    await new Promise(() => {});
  }

  if (SIMULATE) {
    printReport(allMetrics);
  }
  globalCodexClient.close();
}

function cleanup() {
  if (recorder) try { recorder.kill('SIGINT'); } catch {}
  abortSpeaker();
  if (sttSocket) try { sttSocket.close(); } catch {}
  globalCodexClient.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

main().catch((err) => {
  console.error('\n[e2e] failed:', err.message);
  if (String(err.message).includes('401') || String(err.message).includes('timeout')) {
    console.error('\nCodex auth may be expired. Run:  codex login');
    console.error('Then verify with:              codex whoami\n');
  }
  globalCodexClient.close();
  process.exit(1);
});