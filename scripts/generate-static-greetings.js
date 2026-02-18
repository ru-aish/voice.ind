const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { SarvamAIClient } = require('sarvamai');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function synthOne({ languageCode, text, outputFile }) {
  const apiKey =
    process.env.SARVAM_API_KEY ||
    process.env.SARVAM_API_SUBSCRIPTION_KEY;
  if (!apiKey) {
    throw new Error('Missing SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY in voice.ind/.env');
  }

  const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  const response = await client.textToSpeech.convert({
    text,
    target_language_code: languageCode,
    speaker: process.env.TTS_SPEAKER || 'shubh',
    model: process.env.TTS_MODEL || 'bulbul:v3',
    pace: Number(process.env.TTS_PACE || 1.0),
    speech_sample_rate: Number(process.env.TTS_SAMPLE_RATE || 24000),
    output_audio_codec: 'wav',
  });

  if (!response?.audios?.[0]) {
    throw new Error(`No audio returned for ${languageCode}`);
  }
  const wav = Buffer.from(response.audios[0], 'base64');
  fs.writeFileSync(outputFile, wav);
  console.log(`saved ${outputFile} bytes=${wav.length}`);
}

async function main() {
  const outDir = path.resolve(__dirname, '..', '..', 'fe.voice.ind', 'public', 'audio', 'greetings');
  fs.mkdirSync(outDir, { recursive: true });

  const greetings = [
    {
      languageCode: 'gu-IN',
      outputFile: path.join(outDir, 'gu-IN.wav'),
      text: 'નમસ્કાર. હું એલિવિક્સ એઆઈનો વોઇસ સહાયક છું. આજે હું તમારી કેવી રીતે મદદ કરી શકું?',
    },
    {
      languageCode: 'hi-IN',
      outputFile: path.join(outDir, 'hi-IN.wav'),
      text: 'नमस्कार. मैं एलिविक्स एआई का वॉइस सहायक हूं. आज मैं आपकी कैसे मदद कर सकता हूं?',
    },
    {
      languageCode: 'en-IN',
      outputFile: path.join(outDir, 'en-IN.wav'),
      text: 'Hello. I am Elevix AI voice assistant. How can I help you today?',
    },
  ];

  for (const item of greetings) {
    await synthOne(item);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
