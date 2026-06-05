const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { getGlobalCodexClient } = require('../src/core/llm/codex-provider');
const globalCodexClient = getGlobalCodexClient();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '8ebcfd35c09d632b0947e2e4474632d5ea282091';

// Benchmark Configurations
const SYSTEM_PROMPT = "You are a helpful dental assistant. Keep responses under 15 words.";
const PROMPT_1 = "Hello, I need to book a dental checkup for tomorrow.";
const PROMPT_2 = "Is there any slot available in the morning?";

async function generateWav(text) {
  const url = 'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&container=wav&sample_rate=16000';
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
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function requestDeepgramTts(text, onChunk) {
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
  
  const reader = Readable.fromWeb(response.body);
  let firstChunkAt = null;
  
  await new Promise((resolve, reject) => {
    reader.on('data', (chunk) => {
      if (firstChunkAt === null) {
        firstChunkAt = Date.now();
        onChunk(firstChunkAt - start);
      }
    });
    reader.on('end', resolve);
    reader.on('error', reject);
  });
  
  return {
    latency: firstChunkAt ? firstChunkAt - start : Date.now() - start
  };
}

function runTurn(threadId, pcmBuffer, turnNum) {
  return new Promise(async (resolve, reject) => {
    // 1. Set up Deepgram STT WebSocket
    const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=300`;
    console.log(`  Connecting to Deepgram ASR: ${wsUrl}`);
    
    const sttSocket = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`
      }
    });

    let sttText = '';
    let sttCompletedTime = null;
    let llmFirstTokenTime = null;
    let ttsFirstChunkTime = null;
    let lastChunkSentTime = null;
    let sttTriggered = false;
    
    let chunkInterval = null;
    let offset = 0;
    const chunkSize = 1280;

    sttSocket.on('open', () => {
      console.log('  ✓ ASR Connection opened. Streaming audio chunks...');
      
      // Stream chunks every 40ms to simulate a live mic
      chunkInterval = setInterval(() => {
        if (offset >= pcmBuffer.length) {
          clearInterval(chunkInterval);
          lastChunkSentTime = Date.now();
          console.log('  ASR Stream complete. Sending CloseStream message...');
          sttSocket.send(JSON.stringify({ type: 'CloseStream' }));
          return;
        }

        const chunk = pcmBuffer.subarray(offset, offset + chunkSize);
        offset += chunkSize;
        sttSocket.send(chunk);
      }, 40);
    });

    const triggerLlm = async () => {
      if (sttTriggered) return;
      sttTriggered = true;
      sttCompletedTime = Date.now();
      const sttLatency = sttCompletedTime - lastChunkSentTime;
      
      console.log(`  [STT Transcript]: "${sttText}" (Latency: ${sttLatency} ms)`);
      console.log('  Calling Codex LLM...');
      
      // 2. Call Codex LLM
      try {
        const finalPrompt = `${SYSTEM_PROMPT}\n\nUser: ${sttText}`;
        const turnParams = {
          threadId: threadId,
          input: [{ type: 'text', text: finalPrompt }],
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          model: 'gpt-5.5',
          effort: 'low'
        };

        const turnResp = await globalCodexClient.request('turn/start', turnParams);
        const turnId = turnResp.turn.id;

        let generatedText = '';

        const handleNotification = async (msg) => {
          const method = msg.method;
          const params = msg.params || {};

          const belongsTo = (params.turnId === turnId || params.threadId === threadId || (params.turn && params.turn.id === turnId));
          if (!belongsTo) return;

          if (method === 'item/agentMessage/delta') {
            const delta = params.delta || '';
            if (delta) {
              if (llmFirstTokenTime === null) {
                llmFirstTokenTime = Date.now();
                const llmLatency = llmFirstTokenTime - sttCompletedTime;
                console.log(`  [LLM First Token]: TTFT: ${llmLatency} ms`);
              }
              generatedText += delta;
            }
          } else if (method === 'turn/completed') {
            globalCodexClient.off('notification', handleNotification);
            const llmTotal = Date.now() - sttCompletedTime;
            console.log(`  [LLM Completed]: "${generatedText}" (Total: ${llmTotal} ms)`);
            
            // 3. Call Deepgram TTS
            console.log('  Calling Deepgram TTS...');
            const ttsStart = Date.now();
            let firstChunkLatency = null;
            const ttsResult = await requestDeepgramTts(generatedText, (latency) => {
              firstChunkLatency = latency;
            });
            ttsFirstChunkTime = ttsStart + (firstChunkLatency || ttsResult.latency);
            console.log(`  [TTS Audio Received]: TTFT: ${firstChunkLatency || ttsResult.latency} ms`);

            // Resolve metrics
            resolve({
              sttText,
              llmText: generatedText,
              stt: sttCompletedTime - lastChunkSentTime,
              llm: llmFirstTokenTime - sttCompletedTime,
              tts: firstChunkLatency || ttsResult.latency,
              total: ttsFirstChunkTime - lastChunkSentTime
            });
          }
        };

        globalCodexClient.on('notification', handleNotification);
      } catch (err) {
        reject(err);
      }
    };

    sttSocket.on('message', async (messageVal) => {
      const data = JSON.parse(messageVal.toString());
      const transcript = data.channel?.alternatives?.[0]?.transcript || '';
      
      if (data.is_final && transcript) {
        sttText += (sttText ? ' ' : '') + transcript;
      }

      if (data.speech_final) {
        console.log('  VAD Event: speech_final detected.');
        await triggerLlm();
      }
    });

    sttSocket.on('close', async (code) => {
      console.log(`  ASR Connection closed (Code: ${code}).`);
      clearInterval(chunkInterval);
      if (!sttTriggered) {
        console.log('  ASR Fallback: triggering LLM on socket close.');
        await triggerLlm();
      }
    });

    sttSocket.on('error', (err) => {
      console.error('  ASR Connection Error:', err.message);
      clearInterval(chunkInterval);
      reject(err);
    });
  });
}

async function runBenchmark() {
  console.log('========================================================');
  console.log('  OPENAI CODEX + DEEPGRAM END-TO-END LATENCY BENCHMARK  ');
  console.log('========================================================\n');

  console.log('1. Initializing preloaded Codex Client...');
  await globalCodexClient.start();
  console.log('✓ Codex Client Ready.\n');

  console.log('2. Generating speech files for simulated live input...');
  const wav1 = await generateWav(PROMPT_1);
  const pcm1 = wav1.subarray(44); // strip header
  const wav2 = await generateWav(PROMPT_2);
  const pcm2 = wav2.subarray(44); // strip header
  console.log('✓ Audio cache pre-generated.\n');

  // Start Codex conversation thread
  console.log('3. Starting Codex Thread...');
  const threadResp = await globalCodexClient.request('thread/start', {
    cwd: '/home/coder/Code/playground',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    model: 'gpt-5.5'
  });
  const threadId = threadResp.thread.id;
  console.log(`✓ Thread Started: ${threadId}\n`);

  console.log('--------------------------------------------------------');
  console.log('TURN 1: Fresh Context (LLM Uncached)');
  console.log('--------------------------------------------------------');
  const metrics1 = await runTurn(threadId, pcm1, 1);
  
  console.log('\n--------------------------------------------------------');
  console.log('TURN 2: Follow-up Turn (LLM Caching Enabled)');
  console.log('--------------------------------------------------------');
  const metrics2 = await runTurn(threadId, pcm2, 2);

  // Tabulate Results
  console.log('\n========================================================================');
  console.log('                        END-TO-END LATENCY REPORT');
  console.log('========================================================================');
  console.log('| Metric Segment           | Turn 1 (Uncached)  | Turn 2 (Cached)    |');
  console.log('|--------------------------|--------------------|--------------------|');
  console.log(`| STT Endpointing Latency  | ${String(metrics1.stt).padStart(14)} ms | ${String(metrics2.stt).padStart(14)} ms |`);
  console.log(`| LLM Time-To-First-Token  | ${String(metrics1.llm).padStart(14)} ms | ${String(metrics2.llm).padStart(14)} ms |`);
  console.log(`| TTS Time-To-First-Chunk  | ${String(metrics1.tts).padStart(14)} ms | ${String(metrics2.tts).padStart(14)} ms |`);
  console.log(`|--------------------------|--------------------|--------------------|`);
  console.log(`| TOTAL END-TO-END DELAY   | ${String(metrics1.total).padStart(14)} ms | ${String(metrics2.total).padStart(14)} ms |`);
  console.log('========================================================================\n');

  console.log('Interpretation:');
  console.log('- "STT Endpointing" is the time from when speech ends to receiving the finalized text.');
  console.log('- "LLM TTFT" is the time from receiving the text to the first Codex response token.');
  console.log('- "TTS TTFT" is the time from the first LLM token to receiving the first audio playback chunk.');
  console.log('- "TOTAL END-TO-END" is the actual delay a user experiences between finishing speaking');
  console.log('  and hearing the bot start its verbal response.');

  // Close Codex Client
  globalCodexClient.close();
}

runBenchmark().catch(err => {
  console.error('Benchmark execution failed:', err);
  globalCodexClient.close();
});
