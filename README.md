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
| `DEFAULT_PROVIDER` | No | `groq`, `cerebras`, or `sarvam` |
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

## Supported Languages

- `hi-IN` - Hindi
- `en-IN` - English (Indian)
- `gu-IN` - Gujarati

## Architecture

```
Client Audio → Sarvam STT → Groq/Cerebras/Sarvam LLM → Sarvam TTS → Client Audio
```
