const { DEFAULTS } = require('./constants');
const fs = require('fs');
const path = require('path');

const SUPPORTED_LLM_PROVIDERS = new Set(['groq', 'cerebras', 'sarvam']);

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNum(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStopValue(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'null') return null;
  if (raw.includes('||')) {
    return raw
      .split('||')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return raw;
}

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (!SUPPORTED_LLM_PROVIDERS.has(normalized)) return '';
  return normalized;
}

function resolveProvider(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeProvider(candidate);
    if (normalized) return normalized;
  }
  return DEFAULTS.llm.provider;
}

function getRequired(name, fallback = '') {
  const value = process.env[name] || fallback;
  return String(value || '').trim();
}

function readPromptFile(filePath) {
  try {
    if (!filePath) return '';
    if (!fs.existsSync(filePath)) return '';
    return String(fs.readFileSync(filePath, 'utf8') || '').trim();
  } catch {
    return '';
  }
}

function loadConfig() {
  const sarvamApiKey =
    getRequired('SARVAM_API_KEY') || getRequired('SARVAM_API_SUBSCRIPTION_KEY');
  const defaultPromptFile = path.resolve(__dirname, '..', '..', 'prompts', 'system_prompt.md');
  const promptFilePath = process.env.VOICE_SYSTEM_PROMPT_FILE || defaultPromptFile;
  const promptFromFile = readPromptFile(promptFilePath);
  const groqPromptRaw = process.env.GROQ_SYSTEM_PROMPT;
  const cerebrasPromptRaw = process.env.CEREBRAS_SYSTEM_PROMPT;
  const sharedPromptRaw = process.env.VOICE_SYSTEM_PROMPT;
  const resolvedSharedPrompt = String(sharedPromptRaw || '').trim() || promptFromFile;

  return {
    server: {
      port: parseNum(process.env.PORT, DEFAULTS.port),
      wsPath: process.env.VOICE_SERVER_WS_PATH || DEFAULTS.wsPath,
      heartbeatMs: parseNum(process.env.VOICE_SERVER_HEARTBEAT_MS, DEFAULTS.heartbeatMs),
      logLevel: (process.env.VOICE_SERVER_LOG_LEVEL || DEFAULTS.logLevel).trim().toLowerCase(),
    },

    keys: {
      sarvamApiKey,
      groqApiKey: getRequired('GROQ_API_KEY'),
      cerebrasApiKey: getRequired('CEREBRAS_API_KEY'),
    },

    stt: {
      model: process.env.SARVAM_STT_MODEL || DEFAULTS.stt.model,
      languageCode: process.env.SARVAM_STT_LANGUAGE_CODE || DEFAULTS.stt.languageCode,
      sampleRate: parseNum(process.env.SARVAM_STT_SAMPLE_RATE, DEFAULTS.stt.sampleRate),
      inputAudioCodec:
        process.env.SARVAM_STT_INPUT_AUDIO_CODEC || DEFAULTS.stt.inputAudioCodec,
      encoding: process.env.SARVAM_STT_ENCODING || DEFAULTS.stt.encoding,
      highVadSensitivity: parseBool(
        process.env.SARVAM_STT_HIGH_VAD_SENSITIVITY,
        DEFAULTS.stt.highVadSensitivity
      ),
      vadSignals: parseBool(process.env.SARVAM_STT_VAD_SIGNALS, DEFAULTS.stt.vadSignals),
      flushSignal: parseBool(process.env.SARVAM_STT_FLUSH_SIGNAL, DEFAULTS.stt.flushSignal),
    },

    tts: {
      wsUrl: process.env.SARVAM_TTS_WS_URL || DEFAULTS.tts.wsUrl,
      speaker: process.env.TTS_SPEAKER || DEFAULTS.tts.speaker,
      languageCode:
        process.env.TTS_TARGET_LANGUAGE_CODE ||
        process.env.E2E_TARGET_LANGUAGE_CODE ||
        DEFAULTS.tts.languageCode,
      pace: parseNum(process.env.TTS_PACE, DEFAULTS.tts.pace),
      minBufferSize: parseNum(process.env.TTS_MIN_BUFFER_SIZE, DEFAULTS.tts.minBufferSize),
      maxChunkLength: parseNum(process.env.TTS_MAX_CHUNK_LENGTH, DEFAULTS.tts.maxChunkLength),
      outputCodec: process.env.TTS_OUTPUT_CODEC || DEFAULTS.tts.outputCodec,
      maxTextChars: parseNum(process.env.TTS_MAX_TEXT_CHARS, DEFAULTS.tts.maxTextChars),
      flushDelayMs: parseNum(process.env.TTS_FLUSH_DELAY_MS, DEFAULTS.tts.flushDelayMs),
      sampleRate: parseNum(process.env.TTS_SAMPLE_RATE || process.env.VOICE_TTS_SAMPLE_RATE, DEFAULTS.tts.sampleRate),
    },

    llm: {
      provider: resolveProvider(
        process.env.VOICE_PIPELINE_PROVIDER,
        process.env.DEFAULT_PROVIDER,
        process.env.LLM_PROVIDER,
        DEFAULTS.llm.provider
      ),
    },

    bridge: {
      flushTimeoutMs: parseNum(
        process.env.BRIDGE_FLUSH_TIMEOUT_MS,
        DEFAULTS.bridge.flushTimeoutMs
      ),
    },

    pipeline: {
      transcriptGraceMs: parseNum(
        process.env.VOICE_PIPELINE_TRANSCRIPT_GRACE_MS,
        DEFAULTS.pipeline.transcriptGraceMs
      ),
      transcriptMaxWaitMs: parseNum(
        process.env.VOICE_PIPELINE_TRANSCRIPT_MAX_WAIT_MS,
        DEFAULTS.pipeline.transcriptMaxWaitMs
      ),
      transcriptPollMs: parseNum(
        process.env.VOICE_PIPELINE_TRANSCRIPT_POLL_MS,
        DEFAULTS.pipeline.transcriptPollMs
      ),
      lateTranscriptMaxMs: parseNum(
        process.env.VOICE_PIPELINE_LATE_TRANSCRIPT_MAX_MS,
        DEFAULTS.pipeline.lateTranscriptMaxMs
      ),
      minTranscriptChars: parseNum(
        process.env.VOICE_PIPELINE_MIN_TRANSCRIPT_CHARS,
        DEFAULTS.pipeline.minTranscriptChars
      ),
      minPromptChars: parseNum(
        process.env.VOICE_PIPELINE_MIN_PROMPT_CHARS,
        DEFAULTS.pipeline.minPromptChars
      ),
      minPromptWords: parseNum(
        process.env.VOICE_PIPELINE_MIN_PROMPT_WORDS,
        DEFAULTS.pipeline.minPromptWords
      ),

      abortOnStartSpeech: parseBool(
        process.env.VOICE_PIPELINE_ABORT_ON_START_SPEECH,
        DEFAULTS.pipeline.abortOnStartSpeech
      ),
      abortOnTranscript: parseBool(
        process.env.VOICE_PIPELINE_ABORT_ON_TRANSCRIPT,
        DEFAULTS.pipeline.abortOnTranscript
      ),
      abortOnTranscriptMinChars: parseNum(
        process.env.VOICE_PIPELINE_ABORT_ON_TRANSCRIPT_MIN_CHARS,
        DEFAULTS.pipeline.abortOnTranscriptMinChars
      ),

      sendOnTranscript: parseBool(
        process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT,
        DEFAULTS.pipeline.sendOnTranscript
      ),
      sendOnTranscriptMinChars: parseNum(
        process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT_MIN_CHARS,
        DEFAULTS.pipeline.sendOnTranscriptMinChars
      ),
      sendOnTranscriptDebounceMs: parseNum(
        process.env.VOICE_PIPELINE_SEND_ON_TRANSCRIPT_DEBOUNCE_MS,
        DEFAULTS.pipeline.sendOnTranscriptDebounceMs
      ),
      skipEndAfterLiveDispatch: parseBool(
        process.env.VOICE_PIPELINE_SKIP_END_AFTER_LIVE_DISPATCH,
        DEFAULTS.pipeline.skipEndAfterLiveDispatch
      ),
      dedupRepeatedTranscript: parseBool(
        process.env.VOICE_PIPELINE_DEDUP_REPEATED_TRANSCRIPT,
        DEFAULTS.pipeline.dedupRepeatedTranscript
      ),
      contextEnabled: parseBool(
        process.env.VOICE_PIPELINE_CONTEXT_ENABLED,
        DEFAULTS.pipeline.contextEnabled
      ),
      contextMaxTurns: parseNum(
        process.env.VOICE_PIPELINE_CONTEXT_MAX_TURNS,
        DEFAULTS.pipeline.contextMaxTurns
      ),
      contextMaxChars: parseNum(
        process.env.VOICE_PIPELINE_CONTEXT_MAX_CHARS,
        DEFAULTS.pipeline.contextMaxChars
      ),
      streamDebug: parseBool(
        process.env.VOICE_PIPELINE_STREAM_DEBUG,
        DEFAULTS.pipeline.streamDebug
      ),
      streamDebugMaxPreviews: parseNum(
        process.env.VOICE_PIPELINE_STREAM_DEBUG_MAX_PREVIEWS,
        DEFAULTS.pipeline.streamDebugMaxPreviews
      ),
      streamDebugPreviewChars: parseNum(
        process.env.VOICE_PIPELINE_STREAM_DEBUG_PREVIEW_CHARS,
        DEFAULTS.pipeline.streamDebugPreviewChars
      ),
      ttsSanitize: parseBool(
        process.env.VOICE_PIPELINE_TTS_SANITIZE,
        DEFAULTS.pipeline.ttsSanitize
      ),
      echoGuardEnabled: parseBool(
        process.env.VOICE_PIPELINE_ECHO_GUARD_ENABLED,
        DEFAULTS.pipeline.echoGuardEnabled
      ),
      echoGuardMinChars: parseNum(
        process.env.VOICE_PIPELINE_ECHO_GUARD_MIN_CHARS,
        DEFAULTS.pipeline.echoGuardMinChars
      ),
      echoGuardTokenOverlap: parseNum(
        process.env.VOICE_PIPELINE_ECHO_GUARD_TOKEN_OVERLAP,
        DEFAULTS.pipeline.echoGuardTokenOverlap
      ),

      modelVerbose: parseBool(
        process.env.VOICE_PIPELINE_VERBOSE_MODEL,
        DEFAULTS.pipeline.modelVerbose
      ),
    },

    groq: {
      model: process.env.GROQ_MODEL || DEFAULTS.groq.model,
      temperature: parseNum(process.env.GROQ_TEMPERATURE, DEFAULTS.groq.temperature),
      maxCompletionTokens: parseNum(
        process.env.GROQ_MAX_TOKENS,
        DEFAULTS.groq.maxCompletionTokens
      ),
      topP: parseNum(process.env.GROQ_TOP_P, DEFAULTS.groq.topP),
      reasoningEffort: process.env.GROQ_REASONING_EFFORT || DEFAULTS.groq.reasoningEffort,
      stop: parseStopValue(process.env.GROQ_STOP, DEFAULTS.groq.stop),
      allowReasoningFallback: parseBool(
        process.env.GROQ_ALLOW_REASONING_FALLBACK,
        DEFAULTS.groq.allowReasoningFallback
      ),
      systemPrompt:
        String(groqPromptRaw || '').trim() ||
        resolvedSharedPrompt ||
        DEFAULTS.groq.systemPrompt,
    },

    cerebras: {
      model: process.env.CEREBRAS_MODEL || DEFAULTS.cerebras.model,
      temperature: parseNum(
        process.env.CEREBRAS_TEMPERATURE,
        DEFAULTS.cerebras.temperature
      ),
      maxCompletionTokens: parseNum(
        process.env.CEREBRAS_MAX_TOKENS,
        DEFAULTS.cerebras.maxCompletionTokens
      ),
      topP: parseNum(process.env.CEREBRAS_TOP_P, DEFAULTS.cerebras.topP),
      reasoningEffort:
        process.env.CEREBRAS_REASONING_EFFORT || DEFAULTS.cerebras.reasoningEffort,
      stop: parseStopValue(process.env.CEREBRAS_STOP, DEFAULTS.cerebras.stop),
      allowReasoningFallback: parseBool(
        process.env.CEREBRAS_ALLOW_REASONING_FALLBACK,
        DEFAULTS.cerebras.allowReasoningFallback
      ),
      systemPrompt:
        String(cerebrasPromptRaw || '').trim() ||
        resolvedSharedPrompt ||
        DEFAULTS.cerebras.systemPrompt,
    },

    sarvam: {
      model: process.env.SARVAM_LLM_MODEL || DEFAULTS.sarvam.model,
      temperature: parseNum(
        process.env.SARVAM_LLM_TEMPERATURE,
        DEFAULTS.sarvam.temperature
      ),
      maxCompletionTokens: parseNum(
        process.env.SARVAM_LLM_MAX_TOKENS,
        DEFAULTS.sarvam.maxCompletionTokens
      ),
      topP: parseNum(process.env.SARVAM_LLM_TOP_P, DEFAULTS.sarvam.topP),
      stop: parseStopValue(process.env.SARVAM_LLM_STOP, DEFAULTS.sarvam.stop),
      systemPrompt:
        String(process.env.SARVAM_LLM_SYSTEM_PROMPT || '').trim() ||
        resolvedSharedPrompt ||
        DEFAULTS.sarvam.systemPrompt,
    },

    tools: {
      enabled: parseBool(process.env.VOICE_TOOLS_ENABLED, DEFAULTS.tools.enabled),
      maxIterations: parseNum(process.env.VOICE_TOOLS_MAX_ITERATIONS, DEFAULTS.tools.maxIterations),
      // No external API needed - uses Google Calendar directly
    },
  };
}

module.exports = {
  loadConfig,
  parseBool,
  parseNum,
};
