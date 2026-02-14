const DEFAULTS = {
  port: 8081,
  wsPath: '/',
  heartbeatMs: 30000,
  logLevel: 'info',

  stt: {
    model: 'saaras:v3',
    languageCode: 'gu-IN',
    sampleRate: 16000,
    inputAudioCodec: 'wav',
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
    provider: 'groq',
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
    contextMaxTurns: 8,
    contextMaxChars: 4000,
    streamDebug: true,
    streamDebugMaxPreviews: 2,
    streamDebugPreviewChars: 220,
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
    model: 'openai/gpt-oss-20b',
    temperature: 0.2,
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
};

const VAD_SIGNALS = {
  START: 'START_SPEECH',
  END: 'END_SPEECH',
};

const WS_MESSAGE_TYPES = {
  AUDIO: 'audio',
  TEXT: 'text',
  CONFIG: 'config',
  ABORT: 'abort',
  TRANSCRIPT: 'transcript',
  METRICS: 'metrics',
  ERROR: 'error',
  VAD: 'vad',
  READY: 'ready',
};

module.exports = {
  DEFAULTS,
  VAD_SIGNALS,
  WS_MESSAGE_TYPES,
};
