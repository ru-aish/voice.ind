require('dotenv').config();
const { SarvamAIClient } = require('sarvamai');

async function test() {
  console.log("Starting test...");
  try {
    const apiKey = process.env.SARVAM_API_KEY || process.env.SARVAM_API_SUBSCRIPTION_KEY;
    if (!apiKey) {
      console.error("Missing API Key");
      return;
    }
    
    console.log("Connecting...");
    const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
    const socket = await client.speechToTextStreaming.connect({
      'Api-Subscription-Key': apiKey,
      model: 'saarika:v2.5',
      'language-code': 'gu-IN',
      sample_rate: '16000',
      input_audio_codec: 'pcm_s16le',
      high_vad_sensitivity: 'true',
      vad_signals: 'true',
      flush_signal: 'true',
    });
    
    console.log("Connected successfully!");
    
    socket.on('close', () => {
      console.log("Socket closed.");
    });
    
    socket.on('error', (err) => {
      console.error("Socket error", err);
    });
    
    await socket.waitForOpen();
    console.log("Socket is open.");
    
    socket.close();
  } catch (err) {
    console.error("Connection failed:", err);
  }
}

test();
