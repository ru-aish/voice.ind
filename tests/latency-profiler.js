require('dotenv').config();
const { SarvamTtsClient } = require('../src/core/tts/sarvam-tts-client');
const { SarvamSttClient } = require('../src/core/stt/sarvam-stt-client');
const fs = require('fs');
const path = require('path');
const { GroqProvider } = require('../src/core/llm/groq-provider');
const { SarvamProvider } = require('../src/core/llm/sarvam-provider');

// Configuration
const CONFIG = {
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    temperature: 0.7,
    maxCompletionTokens: 150,
    topP: 1,
    reasoningEffort: 'low',
    stop: null,
    allowReasoningFallback: false,
    systemPrompt: 'You are a helpful assistant. Keep answers very short (under 10 words).',
  },
  tts: {
    apiKey: process.env.SARVAM_API_KEY || process.env.SARVAM_API_SUBSCRIPTION_KEY,
    wsUrl: process.env.SARVAM_TTS_WS_URL || 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true',
    speaker: process.env.TTS_SPEAKER || 'shubh',
    languageCode: 'gu-IN', // Gujarati for quality test
    pace: parseFloat(process.env.TTS_PACE || '1.0'),
    minBufferSize: parseInt(process.env.TTS_MIN_BUFFER_SIZE || '30'),
    maxChunkLength: parseInt(process.env.TTS_MAX_CHUNK_LENGTH || '50'),
    outputCodec: process.env.TTS_OUTPUT_CODEC || 'wav',
    sampleRate: parseInt(process.env.TTS_SAMPLE_RATE || '16000'),
    flushDelayMs: parseInt(process.env.TTS_FLUSH_DELAY_MS || '2'),
  },
  stt: {
    apiKey: process.env.SARVAM_API_KEY || process.env.SARVAM_API_SUBSCRIPTION_KEY,
    model: 'saarika:v2.5',
    languageCode: 'gu-IN', // Gujarati for quality test
    sampleRate: parseInt(process.env.SARVAM_STT_SAMPLE_RATE || '16000'),
    inputAudioCodec: process.env.SARVAM_STT_INPUT_AUDIO_CODEC || 'pcm_s16le',
    encoding: process.env.SARVAM_STT_ENCODING || 'audio/wav',
    highVadSensitivity: process.env.SARVAM_STT_HIGH_VAD_SENSITIVITY === 'true',
    vadSignals: process.env.SARVAM_STT_VAD_SIGNALS === 'true',
    flushSignal: process.env.SARVAM_STT_FLUSH_SIGNAL === 'true',
  },
  iterations: 1, // Single run for quality check
  // Long Gujarati Input
  initialText: "નમસ્તે, આ એક ટેસ્ટ છે જેમાં આપણે સારિકા મોડેલની ગુણવત્તા ચકાસી રહ્યા છીએ. અમારે જોવું છે કે આ મોડેલ લાંબા અને જટિલ વાક્યોને કેટલી ચોકસાઈથી સમજી શકે છે અને તેનું લખાણ કરી શકે છે. કૃપા કરીને આ વાક્યનું ધ્યાનપૂર્વક સાંભળીને લખાણ કરો.",
  chunkDelayMs: 30, // Simulate network/mic streaming delay
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runProfiler() {
  console.log("Starting Quality Check (Gujarati): TTS -> STT(Saarika v2.5)...");
  console.log(`Config: STT=${CONFIG.stt.model}, Lang=${CONFIG.stt.languageCode}`);
  
  const ttsClient = new SarvamTtsClient(CONFIG.tts);
  const sttClient = new SarvamSttClient(CONFIG.stt);
  
  sttClient.on('open', () => console.log('[STT] Socket Open'));
  sttClient.on('close', () => console.log('[STT] Socket Closed'));
  sttClient.on('error', (e) => console.error('[STT] Error:', e));

  // Initialize connection
  try {
    console.log("Connecting to services...");
    await ttsClient.connect();
    await sttClient.connect();
    console.log("Connected.");
  } catch (err) {
    console.error("Connection failed:", err);
    process.exit(1);
  }

  let currentInput = CONFIG.initialText;
  const results = [];

  for (let i = 0; i < CONFIG.iterations; i++) {
    console.log(`\n--- Quality Check Iteration ---`);
    console.log(`Input Text (Gujarati): "${currentInput}"`);

    const iterationMetrics = {
      llmRequestTime: 0,
      llmFirstTokenTime: 0,
      llmCompleteTime: 0,
      ttsRequestTime: 0,
      ttsFirstAudioTime: 0,
      ttsCompleteTime: 0,
      sttFirstChunkSentTime: 0,
      sttFirstTranscriptTime: 0,
      sttFinalTranscriptTime: 0,
    };

    // --- LLM STEP (BYPASSED) ---
    // iterationMetrics.llmRequestTime = Date.now();
    let llmResponseText = currentInput; // Direct loop
    // console.log(`\n(LLM Bypassed) Processing Text: "${llmResponseText}"`);
    /* 
    try {
        await groqProvider.streamText({ ... });
    } catch (e) { ... } 
    */

    if (!llmResponseText) {
        console.error("No text to process");
        break;
    }
    
    const cleanedText = llmResponseText;

    // --- TTS STEP ---
    const ttsPromise = new Promise((resolve, reject) => {
      const audioChunks = [];
      let firstChunkReceived = false;

      ttsClient.speakText(cleanedText || "...", {
        onAudioChunk: (payload) => {
          if (!firstChunkReceived) {
            iterationMetrics.ttsFirstAudioTime = Date.now();
            firstChunkReceived = true;
            process.stdout.write('.');
          }
          if (payload.chunk) {
             audioChunks.push(payload.chunk);
          }
        }
      }).then((result) => {
          iterationMetrics.ttsCompleteTime = Date.now();
          resolve(Buffer.concat(audioChunks));
      }).catch(reject);
    });

    iterationMetrics.ttsRequestTime = Date.now();
    let audioBuffer;
    try {
        audioBuffer = await ttsPromise;
        console.log(`\nTTS Completed. Bytes: ${audioBuffer.length}`);
        
        // Save audio for user verification
        const audioFile = path.join(__dirname, 'test_gujarati.wav');
        fs.writeFileSync(audioFile, audioBuffer);
        console.log(`Audio saved to: ${audioFile}`);
        
    } catch (e) {
        console.error("TTS Failed:", e);
        debugger;
        break;
    }

    // --- STT STEP ---
    iterationMetrics.sttFirstChunkSentTime = Date.now();
    
    // Create a new promise for STT completion
    const sttPromise = new Promise((resolve, reject) => {
        let accumulatedTrans = "";
        let firstTransReceived = false;
        let lastTransTime = 0;
        let resolveTimer = null;

        const finish = () => {
             if (resolveTimer) clearTimeout(resolveTimer);
             sttClient.off('message', onMessage);
             resolve(accumulatedTrans || "[No Transcript]");
        };

        const onMessage = (msg) => {
             // Debug log (can comment out later to reduce noise)
             // console.log('[STT Msg]', JSON.stringify(msg).substring(0, 200));

             if (msg.type === 'data' && msg.data && msg.data.transcript) {
                 const transcript = msg.data.transcript.trim();
                 if (transcript) {
                     if (!firstTransReceived) {
                         iterationMetrics.sttFirstTranscriptTime = Date.now();
                         firstTransReceived = true;
                         process.stdout.write('+');
                     }
                     accumulatedTrans += " " + transcript;
                     lastTransTime = Date.now();
                     
                     // Reset "silence" timer
                     if (resolveTimer) clearTimeout(resolveTimer);
                     resolveTimer = setTimeout(finish, 2000); // Wait 2s silence after last transcript
                 }
                 // If Sarvam sends is_final, use it, but V3 events might differ. 
                 // We rely on silence timeout for this test loop.
             }
        };
        
        // Listen to messages
        sttClient.on('message', onMessage);

        // Absolute max timeout
        setTimeout(() => {
            if (! accumulatedTrans) finish();
        }, 15000); 
    });

    // Send audio in chunks
    const CHUNK_SIZE = 4096; 
    for (let offset = 0; offset < audioBuffer.length; offset += CHUNK_SIZE) {
        const chunk = audioBuffer.slice(offset, offset + CHUNK_SIZE);
        sttClient.sendAudioBuffer(chunk);
        await sleep(CONFIG.chunkDelayMs); 
    }
    sttClient.flush();

    let recognizedText = "";
    try {
        recognizedText = await sttPromise;
        iterationMetrics.sttFinalTranscriptTime = Date.now();
        console.log(`STT Transcript: "${recognizedText}"`);
        
        if (recognizedText && recognizedText !== "[Timeout/No Final]" && recognizedText.length > 2) {
            currentText = recognizedText;
        } else {
            console.log("Transcript distinct failure, keeping text.");
        }

    } catch(e) {
        console.error("STT Failed", e);
    }

    // Metrics Calculation
    const llmTtft = iterationMetrics.llmFirstTokenTime > 0 ? (iterationMetrics.llmFirstTokenTime - iterationMetrics.llmRequestTime) : -1;
    const llmTotal = iterationMetrics.llmCompleteTime - iterationMetrics.llmRequestTime;
    const ttsLatency = iterationMetrics.ttsFirstAudioTime > 0 ? (iterationMetrics.ttsFirstAudioTime - iterationMetrics.ttsRequestTime) : -1;
    const ttsTotal = iterationMetrics.ttsCompleteTime - iterationMetrics.ttsRequestTime;
    const sttLatency = iterationMetrics.sttFirstTranscriptTime > 0 ? (iterationMetrics.sttFirstTranscriptTime - iterationMetrics.sttFirstChunkSentTime) : -1;
    const sttTotal = iterationMetrics.sttFinalTranscriptTime - iterationMetrics.sttFirstChunkSentTime;
    
    // Total Round Trip: From sending LLM Request to getting Final STT Transcript
    const totalRoundTrip = iterationMetrics.sttFinalTranscriptTime - iterationMetrics.llmRequestTime;

    const resultEntry = {
        iteration: i + 1,
        llmTtftMs: llmTtft,
        llmTotalMs: llmTotal,
        ttsLatencyMs: ttsLatency,
        sttLatencyMs: sttLatency,
        totalMs: totalRoundTrip
    };
    results.push(resultEntry);

    console.log(`Metrics: LLM TTFT=${llmTtft}ms, TTS Latency=${ttsLatency}ms, STT Latency=${sttLatency}ms, Total=${totalRoundTrip}ms`);
    
    // Clear listeners for next iteration if not using `once`
    sttClient.removeAllListeners('message');
    
    await sleep(1000);
  }

  console.log("\n--- Final Results ---");
  console.table(results);

  // Compute Averages
  const avgLlmTtft = results.reduce((acc, curr) => acc + curr.llmTtftMs, 0) / results.length;
  const avgTTSLatency = results.reduce((acc, curr) => acc + curr.ttsLatencyMs, 0) / results.length;
  const avgSTTLatency = results.reduce((acc, curr) => acc + curr.sttLatencyMs, 0) / results.length;
  const avgTotal = results.reduce((acc, curr) => acc + curr.totalMs, 0) / results.length;
  
  console.log("\n--- Averages ---");
  console.log(`Avg LLM TTFT: ${avgLlmTtft.toFixed(2)}ms`);
  console.log(`Avg TTS First Byte: ${avgTTSLatency.toFixed(2)}ms`);
  console.log(`Avg STT First Token: ${avgSTTLatency.toFixed(2)}ms`);
  console.log(`Avg Full Round Trip: ${avgTotal.toFixed(2)}ms`);

  process.exit(0);
}

runProfiler().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
