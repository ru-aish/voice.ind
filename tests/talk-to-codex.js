const { spawn } = require('child_process');
const WebSocket = require('ws');
const readline = require('readline');
const { Readable } = require('stream');
const { globalCodexClient } = require('../src/core/llm/codex-provider');

// ========================================================================
// EDIT SYSTEM PROMPT HERE
// ========================================================================
const SYSTEM_PROMPT = "You are a helpful, extremely concise assistant. Reply in under 12 words.";
// ========================================================================

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '8ebcfd35c09d632b0947e2e4474632d5ea282091';
const MIC_DEVICE = process.env.MIC_DEVICE || 'default';
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'default';

let codexThreadId = null;
let currentSttSocket = null;
let currentAplay = null;
let recorder = null;

let userStoppedSpeakingTime = null;
let sttTranscriptTime = null;
let llmFirstTokenTime = null;
let ttsFirstChunkTime = null;

function log(msg) {
  console.log(`\x1b[36m[Assistant]\x1b[0m ${msg}`);
}

function logLatency(stt, llm, tts, total) {
  console.log(`\n\x1b[32m--- LATENCY METRICS ---\x1b[0m`);
  console.log(`  STT (Speech to Text)   : \x1b[33m${stt} ms\x1b[0m`);
  console.log(`  LLM (Codex TTFT)       : \x1b[33m${llm} ms\x1b[0m`);
  console.log(`  TTS (Voice Synthesizer): \x1b[33m${tts} ms\x1b[0m`);
  console.log(`  -----------------------`);
  console.log(`  TOTAL END-TO-END DELAY : \x1b[35m\x1b[1m${total} ms\x1b[0m`);
  console.log(`\x1b[32m-----------------------\x1b[0m\n`);
}

async function requestDeepgramTts(text, onChunk, onEnd) {
  const url = 'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=16000';
  const start = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS failed: ${response.status} - ${errText}`);
  }
  
  return new Promise((resolve, reject) => {
    const reader = Readable.fromWeb(response.body);
    let firstChunkAt = null;
    
    reader.on('data', (chunk) => {
      if (firstChunkAt === null) {
        firstChunkAt = Date.now();
      }
      onChunk(chunk, firstChunkAt - start);
    });
    
    reader.on('end', () => {
      onEnd(Date.now() - start, firstChunkAt ? firstChunkAt - start : null);
      resolve();
    });
    
    reader.on('error', (err) => {
      console.error('[TTS Stream Error]:', err.message);
      onEnd(Date.now() - start, null);
      reject(err);
    });
  });
}

function startSpeaker() {
  if (currentAplay) {
    try { currentAplay.stdin.destroy(); } catch {}
    try { currentAplay.kill('SIGKILL'); } catch {}
  }
  
  // Start aplay for 16kHz 16-bit mono raw PCM playback
  currentAplay = spawn('aplay', [
    '-q',
    '-D', SPEAKER_DEVICE,
    '-t', 'raw',
    '-f', 'S16_LE',
    '-c', '1',
    '-r', '16000'
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  currentAplay.on('error', (err) => {
    console.error('[aplay error]:', err.message);
  });
}

function handleSpeechDetected() {
  // If speaking, abort any active TTS playback instantly (barge-in)
  if (currentAplay) {
    try {
      currentAplay.stdin.destroy();
      currentAplay.kill('SIGKILL');
      currentAplay = null;
      console.log('\n\x1b[33m(Barge-in: Interrupting assistant response)\x1b[0m');
    } catch {}
  }
}

async function setupStreaming() {
  const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=300`;
  const socket = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Token ${DEEPGRAM_API_KEY}`
    }
  });

  currentSttSocket = socket;
  let sttText = '';
  let finalDelivered = false;

  socket.on('open', () => {
    // Socket open and ready
  });

  socket.on('message', async (messageVal) => {
    const data = JSON.parse(messageVal.toString());
    const transcript = data.channel?.alternatives?.[0]?.transcript || '';

    if (transcript) {
      handleSpeechDetected();
      process.stdout.write(`\r\x1b[90mUser Speaking: "${sttText} ${transcript}"\x1b[0m\x1b[K`);
    }

    if (data.is_final && transcript) {
      sttText += (sttText ? ' ' : '') + transcript;
      process.stdout.write(`\rUser: "\x1b[1m${sttText}\x1b[0m"\x1b[K`);
    }

    if (data.speech_final && !finalDelivered && sttText.trim()) {
      finalDelivered = true;
      console.log(); // new line
      
      // Calculate STT completion time
      sttTranscriptTime = Date.now();
      // Subtract the 300ms endpointing window to get when they actually stopped speaking
      userStoppedSpeakingTime = sttTranscriptTime - 300; 

      const sttLatency = sttTranscriptTime - userStoppedSpeakingTime;
      
      // Reset timestamps
      llmFirstTokenTime = null;
      ttsFirstChunkTime = null;

      // 1. Invoke preloaded Codex LLM
      try {
        const finalPrompt = `${SYSTEM_PROMPT}\n\nUser: ${sttText}`;
        const turnParams = {
          threadId: codexThreadId,
          input: [{ type: 'text', text: finalPrompt }],
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          model: 'gpt-5.5',
          effort: 'low'
        };

        const turnResp = await globalCodexClient.request('turn/start', turnParams);
        const turnId = turnResp.turn.id;

        let replyText = '';

        const handleNotification = async (msg) => {
          const method = msg.method;
          const params = msg.params || {};

          if (params.turnId !== turnId) return;

          if (method === 'item/agentMessage/delta') {
            const delta = params.delta || '';
            if (delta) {
              if (llmFirstTokenTime === null) {
                llmFirstTokenTime = Date.now();
              }
              replyText += delta;
              process.stdout.write(`\x1b[36m${delta}\x1b[0m`);
            }
          } else if (method === 'turn/completed') {
            globalCodexClient.off('notification', handleNotification);
            console.log(); // new line

            const llmLatency = llmFirstTokenTime - sttTranscriptTime;

            // 2. Synthesize audio via Deepgram TTS
            startSpeaker();
            await requestDeepgramTts(
              replyText,
              (chunk, latency) => {
                if (ttsFirstChunkTime === null) {
                  ttsFirstChunkTime = Date.now();
                }
                if (currentAplay && currentAplay.stdin && !currentAplay.stdin.destroyed) {
                  currentAplay.stdin.write(chunk);
                }
              },
              (totalDuration, firstChunkLatency) => {
                if (currentAplay && currentAplay.stdin) {
                  currentAplay.stdin.end();
                }
                if (ttsFirstChunkTime === null) {
                  ttsFirstChunkTime = Date.now();
                }
                const ttsLatency = ttsFirstChunkTime - llmFirstTokenTime;
                const totalLatency = ttsFirstChunkTime - userStoppedSpeakingTime;

                // Print Metrics
                logLatency(sttLatency, llmLatency, ttsLatency, totalLatency);

                // Restart STT block for next turn
                sttText = '';
                finalDelivered = false;
              }
            );
          }
        };

        globalCodexClient.on('notification', handleNotification);
      } catch (err) {
        console.error('\nLLM Turn Error:', err.message);
      }
    }
  });

  socket.on('close', () => {
    if (currentSttSocket === socket) {
      setupStreaming(); // auto-reconnect if socket drops
    }
  });

  socket.on('error', () => {
    // handled
  });
}

function startRecording() {
  // Capture 16kHz 16-bit mono wav audio from the microphone
  recorder = spawn('arecord', [
    '-q',
    '-D', MIC_DEVICE,
    '-f', 'S16_LE',
    '-c', '1',
    '-r', '16000',
    '-t', 'raw'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  recorder.stdout.on('data', (chunk) => {
    if (currentSttSocket && currentSttSocket.readyState === WebSocket.OPEN) {
      currentSttSocket.send(chunk);
    }
  });

  recorder.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.error('[arecord error]:', line);
  });
}

async function main() {
  console.log('========================================================');
  console.log('   TALK TO CODEX VOICE ASSISTANT (E2E LOW LATENCY)      ');
  console.log('========================================================');
  console.log(`System Prompt: "${SYSTEM_PROMPT}"`);
  console.log(`Mic Device   : ${MIC_DEVICE}`);
  console.log(`Speaker      : ${SPEAKER_DEVICE}`);
  console.log('========================================================\n');

  log('Initializing Codex preloaded daemon...');
  await globalCodexClient.start();
  log('Codex preloaded successfully.');

  log('Starting conversation thread...');
  const threadResp = await globalCodexClient.request('thread/start', {
    cwd: '/home/coder/Code/playground',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    model: 'gpt-5.5'
  });
  codexThreadId = threadResp.thread.id;
  log(`Conversation thread opened: ${codexThreadId}`);

  log('Connecting to Deepgram STT WebSocket...');
  await setupStreaming();

  log('Starting mic capture... SPEAK NOW (Press Ctrl+C to exit)');
  startRecording();
}

function cleanup() {
  console.log('\nStopping...');
  if (recorder) {
    try { recorder.kill('SIGINT'); } catch {}
  }
  if (currentAplay) {
    try { currentAplay.stdin.destroy(); currentAplay.kill('SIGKILL'); } catch {}
  }
  if (currentSttSocket) {
    try { currentSttSocket.close(); } catch {}
  }
  globalCodexClient.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

main().catch(err => {
  console.error('Fatal initialization error:', err);
  cleanup();
});
