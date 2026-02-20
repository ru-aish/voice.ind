# voice.ai - Real-time Voice AI Server

WebSocket server for real-time voice conversations with STT, LLM, and TTS.

## Endpoint

```
wss://your-domain.onrender.com/
```

## Protocol

### Connect
```javascript
const ws = new WebSocket('wss://your-app.onrender.com/');
```

### Send Audio (Input)
```json
{
  "type": "audio",
  "data": {
    "audio": "<base64-encoded-wav>"
  }
}
```

Or send raw binary WebSocket frames (preferred for low latency).

### Receive Audio (Output)
```json
{
  "type": "audio",
  "data": {
    "audio": "<base64-encoded-wav-chunk>",
    "segmentIndex": 1
  }
}
```

### Events Received

| Type | Description |
|------|-------------|
| `ready` | Session initialized |
| `transcript` | User speech transcribed |
| `audio` | AI response audio chunk |
| `vad` | Voice activity (START_SPEECH/END_SPEECH) |
| `metrics` | Latency and timing info |
| `error` | Error messages |

### Configuration
```json
{
  "type": "config",
  "data": {
    "config": {
      "language": "hi-IN",
      "provider": "groq"
    }
  }
}
```

### Direct Text Input (skip STT)
```json
{
  "type": "text",
  "data": {
    "text": "Hello, how are you?"
  }
}
```

## Quick Start

```bash
npm install
npm run start
```

Server runs on `ws://localhost:8081/`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SARVAM_API_KEY` | Yes | For STT and TTS |
| `GROQ_API_KEY` | Yes | For LLM inference |
| `CEREBRAS_API_KEY` | No | Alternative LLM |
| `GEMINI_API_KEY` | No | Gemini LLM provider (or use `GOOGLE_API_KEY`) |
| `DEFAULT_PROVIDER` | No | `groq`, `cerebras`, `sarvam`, or `gemini` |
| `SARVAM_STT_LANGUAGE_CODE` | No | Default: `hi-IN` |

## Deploy

### Docker
```bash
docker build -t voice-ai-server .
docker run -p 8081:8081 --env-file .env voice-ai-server
```

### Render / Railway
- Root directory: `.`
- Build: Docker
- Port: `8081`
- Add environment variables

## Client Example

```javascript
const WebSocket = require('ws');
const fs = require('fs');

const ws = new WebSocket('wss://your-app.onrender.com/');

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'ready') {
    // Send audio
    const audio = fs.readFileSync('input.wav');
    ws.send(JSON.stringify({
      type: 'audio',
      data: { audio: audio.toString('base64') }
    }));
  }
  
  if (msg.type === 'audio') {
    const audioBuffer = Buffer.from(msg.data.audio, 'base64');
    fs.writeFileSync('output.wav', audioBuffer);
    console.log('Received audio chunk');
  }
  
  if (msg.type === 'transcript') {
    console.log('User said:', msg.data.transcript);
  }
});
```

## Twilio-Condition Simulator Client

Use this when you want to test quality under Twilio media constraints without connecting real Twilio calls.

- Inbound simulation: 8kHz mono PCMU (`audio/x-mulaw`) frames in 20ms chunks
- Outbound simulation: server audio is converted back to 8kHz PCMU Twilio-style `media` frames
- Lifecycle simulation: `connected`, `start`, `media`, `stop`
- Modes:
  - `bridge` (default): works with current server protocol (`type: "audio"`) while forcing Twilio codec path
  - `twilio`: sends raw Twilio JSON events directly (for protocol-change testing)

```bash
npm run client:twilio -- --input=./samples/me.wav --mode=bridge
```

Optional:

```bash
npm run client:twilio -- --input=./samples/me.wav --mode=bridge --provider=gemini --language=hi-IN --tts-language=hi-IN --save-assistant-wav=./out/twilio-decoded.wav
```

Raw Twilio frame mode:

```bash
npm run client:twilio -- --input=./samples/me.wav --mode=twilio
```

## Twilio Live Communication

The server now accepts Twilio Media Stream events on the same WebSocket endpoint.

- Inbound from Twilio:
  - `connected`, `start`, `media`, `stop`, `mark`, `dtmf`
  - `media.payload` must be base64 PCMU (`audio/x-mulaw`, `8000 Hz`, mono)
- Outbound to Twilio:
  - Server sends `{"event":"media","streamSid":"...","media":{"payload":"<base64-ulaw-8k>"}}`
- Transcoding is handled internally:
  - Twilio `mulaw 8k` -> server STT PCM16 (configured sample rate)
  - Server TTS PCM/WAV -> Twilio `mulaw 8k`

Use Twilio stream URL with a Twilio hint query param:

```xml
<Response>
  <Connect>
    <Stream url="wss://your-domain.example.com/?twilio=1" />
  </Connect>
</Response>
```

If your server path is not `/`, keep that path and append `?twilio=1`.

### Local PC Twilio-Like Live Talk (No Twilio Account Needed)

Use this to talk from your PC mic and hear replies, while using Twilio-style media protocol over WebSocket.

```bash
npm run client:twilio:live -- --url=ws://127.0.0.1:8081/?twilio=1 --provider=sarvam --language=gu-IN --tts-language=gu-IN
```

This client:
- captures mic audio from your PC (`arecord`, PCM16 8k)
- sends Twilio `connected/start/media/stop` events
- receives Twilio `event: "media"` from server
- plays audio back locally (`aplay`, PCM16 8k)
- uses the same backend interruption path as `client:live` (Sarvam STT VAD + server barge-in)

Optional devices:

```bash
npm run client:twilio:live -- --mic-device=pulse --speaker-device=pulse --chunk-ms=20
```

## Supported Languages

- `hi-IN` - Hindi
- `en-IN` - English (Indian)
- `gu-IN` - Gujarati

## Architecture

```
Client Audio → Sarvam STT → Groq/Cerebras LLM → Sarvam TTS → Client Audio
```
