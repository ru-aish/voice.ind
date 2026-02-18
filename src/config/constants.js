const DEFAULTS = {
  port: 8081,
  wsPath: '/',
  heartbeatMs: 30000,
  logLevel: 'info',

  stt: {
    model: 'saaras:v3',
    languageCode: 'gu-IN',
    sampleRate: 16000,
    inputAudioCodec: 'pcm_s16le',
    encoding: 'audio/wav',
    highVadSensitivity: true,
    vadSignals: true,
    flushSignal: true,
  },

  tts: {
    wsUrl: 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true',
    speaker: 'shubh',
    languageCode: 'gu-IN',
    pace: 1.0,
    minBufferSize: 30,
    maxChunkLength: 50,
    outputCodec: 'wav',
    maxTextChars: 180,
    flushDelayMs: 2,
    sampleRate: 24000,
  },

  llm: {
    provider: 'gemini',
  },

  pipeline: {
    transcriptGraceMs: 220,
    transcriptMaxWaitMs: 1400,
    transcriptPollMs: 120,
    lateTranscriptMaxMs: 3000,
    minTranscriptChars: 2,
    minPromptChars: 8,
    minPromptWords: 2,

    abortOnStartSpeech: true,
    abortOnTranscript: false,
    abortOnTranscriptMinChars: 2,

    sendOnTranscript: true,
    sendOnTranscriptMinChars: 12,
    sendOnTranscriptDebounceMs: 300,
    skipEndAfterLiveDispatch: true,
    dedupRepeatedTranscript: true,
    contextEnabled: true,
    contextMaxTurns: 1200,
    contextMaxChars: 120000,
    streamDebug: true,
    streamDebugMaxPreviews: 2,
    streamDebugPreviewChars: 220,
    traceFull: false,
    ttsSanitize: true,
    echoGuardEnabled: true,
    echoGuardMinChars: 4,
    echoGuardTokenOverlap: 0.8,

    modelVerbose: true,
  },

  bridge: {
    flushTimeoutMs: 120,
  },

  groq: {
    model: 'openai/gpt-oss-120b',
    temperature: 1,
    maxCompletionTokens: 2000,
    topP: 1,
    reasoningEffort: 'low',
    stop: null,
    allowReasoningFallback: false,
    systemPrompt: '',
  },

  cerebras: {
    model: 'gpt-oss-120b',
    temperature: 0.2,
    maxCompletionTokens: 2000,
    topP: 1,
    reasoningEffort: 'low',
    stop: null,
    allowReasoningFallback: false,
    systemPrompt: '',
  },

  sarvam: {
    model: 'sarvam-m:low',
    temperature: 0.2,
    maxCompletionTokens: 2000,
    topP: 1,
    reasoningEffort: 'low',
    stop: null,
    systemPrompt: '',
  },

  gemini: {
    model: 'gemini-flash-lite-latest',
    temperature: 1,
    maxCompletionTokens: 8000,
    topP: 1,
    stop: null,
    systemPrompt: '',
  },

  tools: {
    enabled: true,
    maxIterations: 3,
  },
};

const VAD_SIGNALS = {
  START: 'START_SPEECH',
  END: 'END_SPEECH',
};

const WS_MESSAGE_TYPES = {
  AUDIO: 'audio',
  GREET: 'greet',
  TEXT: 'text',
  CONFIG: 'config',
  ABORT: 'abort',
  TRANSCRIPT: 'transcript',
  METRICS: 'metrics',
  ERROR: 'error',
  VAD: 'vad',
  READY: 'ready',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
};

module.exports = {
  DEFAULTS,
  VAD_SIGNALS,
  WS_MESSAGE_TYPES,
};
