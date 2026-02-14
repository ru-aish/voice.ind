const { WS_MESSAGE_TYPES } = require('../config/constants');

const CLIENT_MESSAGE_SCHEMA = {
  type: "'audio' | 'text' | 'config' | 'abort'",
  data: {
    audio: 'base64 encoded audio chunk (optional)',
    text: 'plain text prompt (optional)',
    config: {
      language: "'hi-IN' | 'gu-IN' | 'en-IN'",
      provider: "'groq' | 'cerebras'",
      enableSpeaker: 'boolean (reserved for client-side playback)',
    },
  },
};

const SERVER_MESSAGE_SCHEMA = {
  type: "'transcript' | 'audio' | 'metrics' | 'error' | 'vad' | 'ready'",
  data: {
    transcript: 'transcribed text',
    isFinal: 'boolean',
    audio: 'base64 encoded audio chunk',
    metrics: 'latency and throughput payload',
    vadSignal: "'START_SPEECH' | 'END_SPEECH'",
    error: 'error message string',
  },
};

module.exports = {
  WS_MESSAGE_TYPES,
  CLIENT_MESSAGE_SCHEMA,
  SERVER_MESSAGE_SCHEMA,
};
