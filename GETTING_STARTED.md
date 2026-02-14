# Getting Started (voice.ai)

## 1) Use your existing env
You already have `.env` in repo root. `voice.ai` uses the same variable names.

Minimum keys:
- `SARVAM_API_KEY` (or `SARVAM_API_SUBSCRIPTION_KEY`)
- `GROQ_API_KEY` and/or `CEREBRAS_API_KEY`

## 2) Start server
From repo root:

```bash
npm run voice:server
```

## 3) Start client app (mic -> server -> speaker)
From repo root:

```bash
npm run voice:client
```

Gujarati + Groq:

```bash
npm run voice:client -- --provider=groq --language=gu-IN
```

Cerebras + Hindi:

```bash
npm run voice:client -- --provider=cerebras --language=hi-IN
```

## 4) Useful runtime envs
- `VOICE_SERVER_LOG_LEVEL=info|debug|warn|error`
- `VOICE_SERVER_URL=ws://127.0.0.1:8081/`
- `MIC_DEVICE=pulse`
- `SPEAKER_DEVICE=pulse`
- `VOICE_PIPELINE_CONTEXT_ENABLED=true`
- `VOICE_PIPELINE_CONTEXT_MAX_TURNS=8`
- `VOICE_PIPELINE_CONTEXT_MAX_CHARS=4000`

## 5) What you should see
- VAD events: `START_SPEECH`, `END_SPEECH`
- live transcript lines
- provider latency summary lines (TTFT, TPS, first chunk timings)
- barge-in events when you interrupt the model response
