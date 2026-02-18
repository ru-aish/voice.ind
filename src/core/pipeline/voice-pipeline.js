const { EventEmitter } = require('events');

const { toolDefinitions, ToolExecutor } = require('../../tools');

const { SarvamSttClient } = require('../stt/sarvam-stt-client');
const {
  extractTranscript,
  extractTranscriptIsFinal,
  extractVadSignalType,
  mergeTranscriptText,
  normalizeTranscriptText,
  sanitizePromptTranscript,
  summarizeSttMessage,
} = require('../stt/transcript-processor');
const { VadHandler } = require('../stt/vad-handler');

const { GroqProvider } = require('../llm/groq-provider');
const { CerebrasProvider } = require('../llm/cerebras-provider');
const { SarvamProvider } = require('../llm/sarvam-provider');
const { GeminiProvider } = require('../llm/gemini-provider');
const { countTokensApprox } = require('../llm/types');

const { SarvamTtsClient } = require('../tts/sarvam-tts-client');
const { extractLineChunks, splitTimeoutSafeChunk } = require('../tts/audio-chunker');

const { BargeInHandler, mergePrompts } = require('./barge-in-handler');
const { LatencyTracker } = require('./latency-tracker');
const { VAD_SIGNALS } = require('../../config/constants');

function nowIso(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isAbortLikeError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('abort');
}

function isTransientProviderError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('retry after') ||
    msg.includes('resource exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('high traffic') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again')
  );
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function mergeText(lhs, rhs) {
  const left = String(lhs || '').trim();
  const right = String(rhs || '').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

function languageLabel(languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu-in' || normalized === 'gu') return 'Gujarati (Gujarati script)';
  if (normalized === 'hi-in' || normalized === 'hi') return 'Hindi (Devanagari script)';
  if (normalized === 'en-in' || normalized === 'en') return 'English (Latin script)';
  return null;
}

const SUPPORTED_TTS_LANGUAGE_CODES = new Set(['hi-in', 'en-in', 'gu-in']);
const DEFAULT_TTS_FALLBACK_LANGUAGE = 'gu-IN';

function canonicalLanguageCode(languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu' || normalized === 'gu-in') return 'gu-IN';
  if (normalized === 'hi' || normalized === 'hi-in') return 'hi-IN';
  if (normalized === 'en' || normalized === 'en-in') return 'en-IN';
  if (!normalized) return '';
  return String(languageCode || '').trim();
}

function resolveTtsLanguageCode(requestedLanguageCode, currentTtsLanguageCode = '') {
  const requested = canonicalLanguageCode(requestedLanguageCode);
  if (SUPPORTED_TTS_LANGUAGE_CODES.has(requested.toLowerCase())) {
    return {
      languageCode: requested,
      fallbackFrom: null,
      reason: null,
    };
  }

  const current = canonicalLanguageCode(currentTtsLanguageCode);
  if (SUPPORTED_TTS_LANGUAGE_CODES.has(current.toLowerCase())) {
    return {
      languageCode: current,
      fallbackFrom: requested || null,
      reason: 'requested_tts_language_not_supported',
    };
  }

  return {
    languageCode: DEFAULT_TTS_FALLBACK_LANGUAGE,
    fallbackFrom: requested || current || null,
    reason: 'requested_and_current_tts_languages_not_supported',
  };
}

function languageScriptRegex(languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu-in' || normalized === 'gu') return /[\u0A80-\u0AFF]/u;
  if (normalized === 'hi-in' || normalized === 'hi') return /[\u0900-\u097F]/u;
  if (normalized === 'en-in' || normalized === 'en') return /[A-Za-z]/;
  return null;
}

function hasRequiredScriptChar(text, languageCode) {
  const content = String(text || '');
  if (!content) return false;
  const re = languageScriptRegex(languageCode);
  if (!re) return true;
  if (re.test(content)) return true;
  if (/\d/.test(content)) return true;
  return false;
}

function buildLanguageConstraintInstruction(languageCode) {
  const label = languageLabel(languageCode);
  if (!label) return null;
  return `Respond only in ${label}. Do not switch to any other language/script.`;
}

function defaultGreetingForLanguage(languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu-in' || normalized === 'gu') {
    return 'નમસ્કાર. હું એલિવિક્સ એઆઈનો વોઇસ સહાયક છું. આજે હું તમારી કેવી રીતે મદદ કરી શકું?';
  }
  if (normalized === 'hi-in' || normalized === 'hi') {
    return 'नमस्कार. मैं एलिविक्स एआई का वॉइस सहायक हूं. आज मैं आपकी कैसे मदद कर सकता हूं?';
  }
  return 'Hello. I am Elevix AI voice assistant. How can I help you today?';
}

function isGenericFrontendGreeting(text) {
  const value = String(text || '').trim().toLowerCase();
  return (
    value === '' ||
    value === 'hello! how can i help you today?' ||
    value === 'hello. how can i help you today?' ||
    value === 'hello how can i help you today'
  );
}

function isSarvamAllowedLanguageError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('allowed languages') ||
    msg.includes('text must contain at least one character') ||
    /code"?\s*:\s*422/.test(msg)
  );
}

function isAnyTtsError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('tts error') || msg.includes('previous tts request still in progress');
}

function previewText(text, maxChars = 180) {
  const content = String(text || '').replace(/\s+/g, ' ').trim();
  if (!content) return '';
  const limit = Math.max(20, Number(maxChars) || 180);
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}...`;
}

function isCommonTtsChar(ch) {
  return /[\s0-9.,!?;:'"()\-_/\\@#$%^&*+=<>{}\[\]|`~…]/u.test(ch);
}

function isLanguageScriptChar(ch, languageCode) {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (normalized === 'gu-in' || normalized === 'gu') return /\p{Script=Gujarati}/u.test(ch);
  if (normalized === 'hi-in' || normalized === 'hi') return /\p{Script=Devanagari}/u.test(ch);
  if (normalized === 'en-in' || normalized === 'en') return /[A-Za-z]/.test(ch);
  return true;
}

function sanitizeTextForTtsLanguage(text, languageCode) {
  const chars = Array.from(String(text || ''));
  const kept = [];
  for (const ch of chars) {
    if (isCommonTtsChar(ch) || isLanguageScriptChar(ch, languageCode)) {
      kept.push(ch);
    }
  }
  return kept.join('').replace(/\s+/g, ' ').trim();
}

function normalizeForTokenCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlapRatio(lhs, rhs) {
  const leftTokens = normalizeForTokenCompare(lhs).split(' ').filter(Boolean);
  const rightTokens = new Set(normalizeForTokenCompare(rhs).split(' ').filter(Boolean));
  if (leftTokens.length === 0 || rightTokens.size === 0) return 0;
  let hits = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1;
  }
  return hits / leftTokens.length;
}

class VoicePipeline extends EventEmitter {
  constructor({ sessionId, config }) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.pendingTtsLanguageFallbackMetric = null;

    this.activeProvider = config.llm.provider;

    const initialTtsLanguage = resolveTtsLanguageCode(
      this.config.tts.languageCode,
      this.config.tts.languageCode
    );
    this.config.tts.languageCode = initialTtsLanguage.languageCode;
    if (initialTtsLanguage.fallbackFrom) {
      this.pendingTtsLanguageFallbackMetric = {
        type: 'tts_language_fallback',
        source: 'initial_config',
        requested: initialTtsLanguage.fallbackFrom,
        applied: initialTtsLanguage.languageCode,
        reason: initialTtsLanguage.reason,
      };
    }

    this.vad = new VadHandler();
    this.bargeIn = new BargeInHandler();

    this.toolExecutor = new ToolExecutor();

    this.sttClient = null;
    this.sttConnectPromise = null;
    this.ttsClient = null;
    this.providers = new Map();

    this.sessionStartedAtMs = null;

    this.lastTranscriptText = '';
    this.lastTranscriptSeq = 0;
    this.activeSegmentTranscript = '';
    this.pendingEndedSegment = null;
    this.lateTranscriptFallback = null;

    this.modelRequestCounter = 0;
    this.liveDispatchedSegments = new Set();
    this.liveTranscriptState = {
      segmentIndex: null,
      lastText: '',
      lastSentAtMs: 0,
    };
    this.conversationHistory = [];
    this.turnStates = new Map();
    this.turnCounter = 0;

    this.sessionGreeting = null;
    this.stopped = false;
  }

  async start() {
    this.sessionStartedAtMs = Date.now();
    try {
      await this.#connectSttClient();
    } catch (err) {
      this.emit('metrics', {
        type: 'stt_connect_init_failed',
        atMs: Date.now(),
        atIso: nowIso(Date.now()),
      });
      this.emit('error', {
        error: `stt_connect_init_failed:${err?.message || err}`,
      });
      this.#ensureSttConnectedNonBlocking('start_init_failed');
    }

    if (this.pendingTtsLanguageFallbackMetric) {
      this.emit('metrics', this.pendingTtsLanguageFallbackMetric);
      this.pendingTtsLanguageFallbackMetric = null;
    }

    this.emit('ready', {
      sessionId: this.sessionId,
      startedAtMs: this.sessionStartedAtMs,
      startedAtIso: nowIso(this.sessionStartedAtMs),
      runtimeTag: 'voice-ai-2026-02-14-r6',
      provider: this.activeProvider,
      sttLanguage: this.config.stt.languageCode,
      sttConnected: Boolean(this.sttClient?.connected),
      ttsLanguage: this.config.tts.languageCode,
      sampleRate: this.config.stt.sampleRate,
    });
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;

    if (this.pendingEndedSegment?.timer) {
      clearTimeout(this.pendingEndedSegment.timer);
    }
    this.pendingEndedSegment = null;

    this.abortCurrent('session_stopped');

    const forcedSegment = this.vad.forceEnd(Date.now());
    if (forcedSegment) {
      this.emit('vad', {
        signal: 'FORCED_END',
        segmentIndex: forcedSegment.segmentIndex,
        durationMs: forcedSegment.durationMs,
      });
    }

    if (this.sttClient) {
      const currentStt = this.sttClient;
      this.sttClient = null;
      await currentStt.close();
    }

    if (this.ttsClient) {
      await this.ttsClient.close();
      this.ttsClient = null;
    }
  }

  async applyConfig(partial) {
    const next = partial || {};

    let restartStt = false;
    let resetTts = false;
    let llmConfigChanged = false;

    const parseFinite = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const parseBounded = (value, min, max) => {
      const parsed = parseFinite(value);
      if (parsed === null) return null;
      return Math.min(max, Math.max(min, parsed));
    };

    const parseBoundedInt = (value, min, max) => {
      const parsed = parseBounded(value, min, max);
      if (parsed === null) return null;
      return Math.round(parsed);
    };

    const validSttCodecs = new Set(['wav', 'pcm_s16le', 'pcm_l16', 'pcm_raw']);

    if (next.provider && ['groq', 'cerebras', 'sarvam', 'gemini'].includes(String(next.provider).toLowerCase())) {
      if (!this.config.llm.providerLocked) {
        this.activeProvider = String(next.provider).toLowerCase();
      }
    }

    if (next.language && String(next.language).trim()) {
      const requestedLang = canonicalLanguageCode(next.language);
      if (requestedLang !== this.config.stt.languageCode) {
        this.config.stt.languageCode = requestedLang;
        restartStt = true;
      }

      const resolvedTtsLanguage = resolveTtsLanguageCode(
        requestedLang,
        this.config.tts.languageCode
      );
      if (resolvedTtsLanguage.languageCode !== this.config.tts.languageCode) {
        this.config.tts.languageCode = resolvedTtsLanguage.languageCode;
        resetTts = true;
      }
      if (resolvedTtsLanguage.fallbackFrom) {
        this.emit('metrics', {
          type: 'tts_language_fallback',
          source: 'language',
          requested: resolvedTtsLanguage.fallbackFrom,
          applied: resolvedTtsLanguage.languageCode,
          reason: resolvedTtsLanguage.reason,
        });
      }
    }

    if (next.sttLanguage && String(next.sttLanguage).trim()) {
      const lang = canonicalLanguageCode(next.sttLanguage);
      if (lang !== this.config.stt.languageCode) {
        this.config.stt.languageCode = lang;
        restartStt = true;
      }
    }

    const sttSampleRate = parseBoundedInt(next.sttSampleRate, 8000, 48000);
    if (sttSampleRate !== null && this.config.stt.sampleRate !== sttSampleRate) {
      this.config.stt.sampleRate = sttSampleRate;
      restartStt = true;
    }

    if (next.sttInputAudioCodec && String(next.sttInputAudioCodec).trim()) {
      const codec = String(next.sttInputAudioCodec).trim().toLowerCase();
      if (validSttCodecs.has(codec) && this.config.stt.inputAudioCodec !== codec) {
        this.config.stt.inputAudioCodec = codec;
        restartStt = true;
      }
    }

    if (next.sttEncoding && String(next.sttEncoding).trim()) {
      const encoding = String(next.sttEncoding).trim();
      if (this.config.stt.encoding !== encoding) {
        this.config.stt.encoding = encoding;
        restartStt = true;
      }
    }

    if (next.ttsLanguage && String(next.ttsLanguage).trim()) {
      const requestedTtsLang = canonicalLanguageCode(next.ttsLanguage);
      const resolvedTtsLanguage = resolveTtsLanguageCode(
        requestedTtsLang,
        this.config.tts.languageCode
      );
      if (resolvedTtsLanguage.languageCode !== this.config.tts.languageCode) {
        this.config.tts.languageCode = resolvedTtsLanguage.languageCode;
        resetTts = true;
      }
      if (resolvedTtsLanguage.fallbackFrom) {
        this.emit('metrics', {
          type: 'tts_language_fallback',
          source: 'ttsLanguage',
          requested: resolvedTtsLanguage.fallbackFrom,
          applied: resolvedTtsLanguage.languageCode,
          reason: resolvedTtsLanguage.reason,
        });
      }
    }

    if (next.speaker && String(next.speaker).trim()) {
      this.config.tts.speaker = String(next.speaker).trim();
      resetTts = true;
    }

    if (next.systemPrompt) {
      const promptText = String(next.systemPrompt).trim();
      if (promptText) {
        this.config.groq.systemPrompt = promptText;
        this.config.cerebras.systemPrompt = promptText;
        this.config.sarvam.systemPrompt = promptText;
        this.config.gemini.systemPrompt = promptText;
      }
    }

    if (next.model && String(next.model).trim()) {
      const model = String(next.model).trim();
      if (this.activeProvider === 'cerebras') {
        if (!this.config.cerebras.modelLocked && this.config.cerebras.model !== model) {
          this.config.cerebras.model = model;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'sarvam') {
        if (!this.config.sarvam.modelLocked && this.config.sarvam.model !== model) {
          this.config.sarvam.model = model;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'gemini') {
        if (!this.config.gemini.modelLocked && this.config.gemini.model !== model) {
          this.config.gemini.model = model;
          llmConfigChanged = true;
        }
      } else if (!this.config.groq.modelLocked && this.config.groq.model !== model) {
        this.config.groq.model = model;
        llmConfigChanged = true;
      }
    }

    if (next.groqModel && String(next.groqModel).trim()) {
      const model = String(next.groqModel).trim();
      if (!this.config.groq.modelLocked && this.config.groq.model !== model) {
        this.config.groq.model = model;
        llmConfigChanged = true;
      }
    }

    if (next.cerebrasModel && String(next.cerebrasModel).trim()) {
      const model = String(next.cerebrasModel).trim();
      if (!this.config.cerebras.modelLocked && this.config.cerebras.model !== model) {
        this.config.cerebras.model = model;
        llmConfigChanged = true;
      }
    }

    if (next.sarvamModel && String(next.sarvamModel).trim()) {
      const model = String(next.sarvamModel).trim();
      if (!this.config.sarvam.modelLocked && this.config.sarvam.model !== model) {
        this.config.sarvam.model = model;
        llmConfigChanged = true;
      }
    }

    if (next.geminiModel && String(next.geminiModel).trim()) {
      const model = String(next.geminiModel).trim();
      if (!this.config.gemini.modelLocked && this.config.gemini.model !== model) {
        this.config.gemini.model = model;
        llmConfigChanged = true;
      }
    }

    const activeTemperature = parseBounded(next.temperature, 0, 2);
    if (activeTemperature !== null) {
      if (this.activeProvider === 'cerebras') {
        if (this.config.cerebras.temperature !== activeTemperature) {
          this.config.cerebras.temperature = activeTemperature;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'sarvam') {
        if (this.config.sarvam.temperature !== activeTemperature) {
          this.config.sarvam.temperature = activeTemperature;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'gemini') {
        if (this.config.gemini.temperature !== activeTemperature) {
          this.config.gemini.temperature = activeTemperature;
          llmConfigChanged = true;
        }
      } else if (this.config.groq.temperature !== activeTemperature) {
        this.config.groq.temperature = activeTemperature;
        llmConfigChanged = true;
      }
    }

    const groqTemperature = parseBounded(next.groqTemperature, 0, 2);
    if (groqTemperature !== null && this.config.groq.temperature !== groqTemperature) {
      this.config.groq.temperature = groqTemperature;
      llmConfigChanged = true;
    }

    const cerebrasTemperature = parseBounded(next.cerebrasTemperature, 0, 2);
    if (cerebrasTemperature !== null && this.config.cerebras.temperature !== cerebrasTemperature) {
      this.config.cerebras.temperature = cerebrasTemperature;
      llmConfigChanged = true;
    }

    const sarvamTemperature = parseBounded(next.sarvamTemperature, 0, 2);
    if (sarvamTemperature !== null && this.config.sarvam.temperature !== sarvamTemperature) {
      this.config.sarvam.temperature = sarvamTemperature;
      llmConfigChanged = true;
    }

    const geminiTemperature = parseBounded(next.geminiTemperature, 0, 2);
    if (geminiTemperature !== null && this.config.gemini.temperature !== geminiTemperature) {
      this.config.gemini.temperature = geminiTemperature;
      llmConfigChanged = true;
    }

    const activeMaxTokens = parseBoundedInt(
      next.maxCompletionTokens ?? next.maxTokens,
      32,
      8192
    );
    if (activeMaxTokens !== null) {
      if (this.activeProvider === 'cerebras') {
        if (this.config.cerebras.maxCompletionTokens !== activeMaxTokens) {
          this.config.cerebras.maxCompletionTokens = activeMaxTokens;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'sarvam') {
        if (this.config.sarvam.maxCompletionTokens !== activeMaxTokens) {
          this.config.sarvam.maxCompletionTokens = activeMaxTokens;
          llmConfigChanged = true;
        }
      } else if (this.activeProvider === 'gemini') {
        if (this.config.gemini.maxCompletionTokens !== activeMaxTokens) {
          this.config.gemini.maxCompletionTokens = activeMaxTokens;
          llmConfigChanged = true;
        }
      } else if (this.config.groq.maxCompletionTokens !== activeMaxTokens) {
        this.config.groq.maxCompletionTokens = activeMaxTokens;
        llmConfigChanged = true;
      }
    }

    const groqMaxTokens = parseBoundedInt(next.groqMaxTokens, 32, 8192);
    if (groqMaxTokens !== null && this.config.groq.maxCompletionTokens !== groqMaxTokens) {
      this.config.groq.maxCompletionTokens = groqMaxTokens;
      llmConfigChanged = true;
    }

    const cerebrasMaxTokens = parseBoundedInt(next.cerebrasMaxTokens, 32, 8192);
    if (
      cerebrasMaxTokens !== null &&
      this.config.cerebras.maxCompletionTokens !== cerebrasMaxTokens
    ) {
      this.config.cerebras.maxCompletionTokens = cerebrasMaxTokens;
      llmConfigChanged = true;
    }

    const sarvamMaxTokens = parseBoundedInt(next.sarvamMaxTokens, 32, 8192);
    if (
      sarvamMaxTokens !== null &&
      this.config.sarvam.maxCompletionTokens !== sarvamMaxTokens
    ) {
      this.config.sarvam.maxCompletionTokens = sarvamMaxTokens;
      llmConfigChanged = true;
    }

    const geminiMaxTokens = parseBoundedInt(next.geminiMaxTokens, 32, 8192);
    if (
      geminiMaxTokens !== null &&
      this.config.gemini.maxCompletionTokens !== geminiMaxTokens
    ) {
      this.config.gemini.maxCompletionTokens = geminiMaxTokens;
      llmConfigChanged = true;
    }

    const contextMaxTurns = parseBoundedInt(next.contextMaxTurns, 1, 5000);
    if (contextMaxTurns !== null && this.config.pipeline.contextMaxTurns !== contextMaxTurns) {
      this.config.pipeline.contextMaxTurns = contextMaxTurns;
      this.#pruneContextHistory();
    }

    const contextMaxChars = parseBoundedInt(next.contextMaxChars, 2000, 500000);
    if (contextMaxChars !== null && this.config.pipeline.contextMaxChars !== contextMaxChars) {
      this.config.pipeline.contextMaxChars = contextMaxChars;
      this.#pruneContextHistory();
    }

    if (next.greeting) {
      this.sessionGreeting = String(next.greeting).trim();
    }

    if (restartStt) {
      await this.#connectSttClient(true);
    }

    if (resetTts && this.ttsClient) {
      await this.ttsClient.close();
      this.ttsClient = null;
    }

    if (next.clearContext === true) {
      this.#clearContext();
    }

    if (llmConfigChanged) {
      this.providers.clear();
      this.emit('metrics', {
        type: 'llm_config_updated',
        provider: this.activeProvider,
        groqModel: this.config.groq.model,
        cerebrasModel: this.config.cerebras.model,
        sarvamModel: this.config.sarvam.model,
        geminiModel: this.config.gemini.model,
      });
    }

    return {
      provider: this.activeProvider,
      providerLocked: this.config.llm.providerLocked === true,
      sttLanguage: this.config.stt.languageCode,
      sttSampleRate: this.config.stt.sampleRate,
      sttInputAudioCodec: this.config.stt.inputAudioCodec,
      ttsLanguage: this.config.tts.languageCode,
      sttModel: this.config.stt.model,
      ttsSpeaker: this.config.tts.speaker,
      groqModel: this.config.groq.model,
      groqModelLocked: this.config.groq.modelLocked === true,
      cerebrasModel: this.config.cerebras.model,
      cerebrasModelLocked: this.config.cerebras.modelLocked === true,
      sarvamModel: this.config.sarvam.model,
      sarvamModelLocked: this.config.sarvam.modelLocked === true,
      geminiModel: this.config.gemini.model,
      geminiModelLocked: this.config.gemini.modelLocked === true,
      groqTemperature: this.config.groq.temperature,
      cerebrasTemperature: this.config.cerebras.temperature,
      sarvamTemperature: this.config.sarvam.temperature,
      geminiTemperature: this.config.gemini.temperature,
      groqMaxTokens: this.config.groq.maxCompletionTokens,
      cerebrasMaxTokens: this.config.cerebras.maxCompletionTokens,
      sarvamMaxTokens: this.config.sarvam.maxCompletionTokens,
      geminiMaxTokens: this.config.gemini.maxCompletionTokens,
      contextMaxTurns: this.config.pipeline.contextMaxTurns,
      contextMaxChars: this.config.pipeline.contextMaxChars,
      contextTurns: this.#currentContextTurns(),
      systemPrompt:
        this.config.groq.systemPrompt ||
        this.config.cerebras.systemPrompt ||
        this.config.sarvam.systemPrompt ||
        this.config.gemini.systemPrompt
          ? 'configured'
          : 'default',
      greeting: this.sessionGreeting || 'none',
    };
  }

  handleAudioChunk(audioBase64OrBuffer) {
    const sttConnected = this.#ensureSttConnectedNonBlocking('audio_chunk');
    if (!sttConnected) {
      this.emit('metrics', {
        type: 'stt_audio_dropped',
        reason: 'stt_not_connected',
      });
      return;
    }

    if (Buffer.isBuffer(audioBase64OrBuffer) || audioBase64OrBuffer instanceof Uint8Array) {
      try {
        this.sttClient.sendAudioBuffer(audioBase64OrBuffer);
      } catch (err) {
        this.emit('metrics', {
          type: 'stt_audio_dropped',
          reason: 'stt_send_failed',
        });
        this.emit('error', { error: `stt_socket_error: ${err?.message || err}` });
        this.#ensureSttConnectedNonBlocking('send_audio_buffer_failed');
      }
      return;
    }

    const audioBase64 = String(audioBase64OrBuffer || '').trim();
    if (!audioBase64) return;
    try {
      this.sttClient.sendAudioBase64(audioBase64);
    } catch (err) {
      this.emit('metrics', {
        type: 'stt_audio_dropped',
        reason: 'stt_send_failed',
      });
      this.emit('error', { error: `stt_socket_error: ${err?.message || err}` });
      this.#ensureSttConnectedNonBlocking('send_audio_base64_failed');
    }
  }

  handleTextInput(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;

    if (this.bargeIn.inFlight) {
      this.bargeIn.queueLatestPrompt(prompt);
      const dropped = this.#markInFlightDropped('text_input_while_provider_inflight');
      if (dropped) {
        this.emit('metrics', {
          type: 'barge_in',
          requestId: dropped.requestId,
          provider: dropped.provider,
          reason: dropped.reason,
        });
      }
      return;
    }

    this.#dispatchTurn(prompt, Date.now(), 'text_input');
  }

  async handleGreetingRequest(languageCode = '') {
    const requestedTts = canonicalLanguageCode(languageCode) || this.config.tts.languageCode;
    const resolvedTtsLanguage = resolveTtsLanguageCode(requestedTts, this.config.tts.languageCode);
    if (resolvedTtsLanguage.languageCode !== this.config.tts.languageCode) {
      this.config.tts.languageCode = resolvedTtsLanguage.languageCode;
      if (this.ttsClient) {
        await this.ttsClient.close();
        this.ttsClient = null;
      }
    }

    const configuredGreeting = String(this.sessionGreeting || '').trim();
    const greetingText = isGenericFrontendGreeting(configuredGreeting)
      ? defaultGreetingForLanguage(this.config.tts.languageCode)
      : configuredGreeting;
    if (!greetingText) return;

    const tts = await this.#ensureTtsClient();
    const greetingRequestId = -1;
    const greetingSegmentIndex = 1;
    const startMs = Date.now();
    const ttsResult = await tts.speakText(greetingText, {
      onAudioChunk: ({ base64, atMs }) => {
        this.emit('audio', {
          requestId: greetingRequestId,
          provider: 'system',
          segmentIndex: greetingSegmentIndex,
          audioBase64: base64,
          atMs,
          atIso: nowIso(atMs),
        });
      },
    });

    this.emit('metrics', {
      type: 'session_greeting_sent',
      requestId: greetingRequestId,
      provider: 'system',
      ttsLanguage: this.config.tts.languageCode,
      textChars: greetingText.length,
      sentAtMs: ttsResult.sentAtMs,
      firstChunkAtMs: ttsResult.firstAudioAtMs,
      totalTtsMs: ttsResult.totalTtsMs,
      wallMs: Math.max(0, Date.now() - startMs),
    });
  }

  abortCurrent(reason = 'client_abort') {
    const dropped = this.#markInFlightDropped(reason);
    if (dropped) {
      this.emit('metrics', {
        type: 'barge_in',
        requestId: dropped.requestId,
        provider: dropped.provider,
        reason: dropped.reason,
      });
    }
  }

  async #connectSttClient(forceReconnect = false) {
    if (forceReconnect && this.sttClient) {
      const staleClient = this.sttClient;
      this.sttClient = null;
      await staleClient.close();
    }

    if (this.sttClient?.connected) return;
    if (this.sttConnectPromise) {
      await this.sttConnectPromise;
      return;
    }

    const connectPromise = (async () => {
      const sttClient = new SarvamSttClient({
        apiKey: this.config.keys.sarvamApiKey,
        model: this.config.stt.model,
        languageCode: this.config.stt.languageCode,
        sampleRate: this.config.stt.sampleRate,
        inputAudioCodec: this.config.stt.inputAudioCodec,
        encoding: this.config.stt.encoding,
        highVadSensitivity: this.config.stt.highVadSensitivity,
        vadSignals: this.config.stt.vadSignals,
        flushSignal: this.config.stt.flushSignal,
      });
      this.sttClient = sttClient;

      sttClient.on('first_chunk_sent', ({ atMs }) => {
        if (this.sttClient !== sttClient) return;
        this.emit('metrics', {
          type: 'stt_first_chunk_sent',
          atMs,
          atIso: nowIso(atMs),
        });
      });

      sttClient.on('first_message', (metrics) => {
        if (this.sttClient !== sttClient) return;
        this.emit('metrics', {
          type: 'stt_first_message_latency',
          ...metrics,
          atIso: nowIso(metrics.atMs),
        });
      });

      sttClient.on('message', (response) => {
        if (this.sttClient !== sttClient) return;
        this.#handleSttMessage(response);
      });

      sttClient.on('error', (err) => {
        if (this.sttClient !== sttClient) return;
        this.emit('error', { error: `stt_socket_error: ${err?.message || err}` });
      });

      sttClient.on('close', (event) => {
        if (this.sttClient !== sttClient) return;
        this.sttClient = null;
        this.emit('metrics', {
          type: 'stt_socket_closed',
          code: event?.code ?? null,
        });
        this.#ensureSttConnectedNonBlocking('stt_socket_closed');
      });

      await sttClient.connect();
      this.emit('metrics', {
        type: 'stt_socket_open',
      });
    })();

    this.sttConnectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this.sttConnectPromise === connectPromise) {
        this.sttConnectPromise = null;
      }
    }
  }

  #ensureSttConnectedNonBlocking(source = 'unknown') {
    if (this.stopped) return false;

    if (this.sttClient?.connected) {
      return true;
    }

    if (this.sttConnectPromise) {
      return false;
    }

    this.emit('metrics', {
      type: 'stt_reconnect_attempt',
      source,
    });

    this.#connectSttClient(true).catch((err) => {
      this.emit('error', { error: `stt_reconnect_error: ${err?.message || err}` });
    });
    return false;
  }

  async #ensureTtsClient() {
    if (!this.ttsClient || this.ttsClient.aborted) {
      this.ttsClient = new SarvamTtsClient({
        apiKey: this.config.keys.sarvamApiKey,
        wsUrl: this.config.tts.wsUrl,
        speaker: this.config.tts.speaker,
        languageCode: this.config.tts.languageCode,
        pace: this.config.tts.pace,
        minBufferSize: this.config.tts.minBufferSize,
        maxChunkLength: this.config.tts.maxChunkLength,
        outputCodec: this.config.tts.outputCodec,
        flushDelayMs: this.config.tts.flushDelayMs,
        sampleRate: this.config.tts.sampleRate,
      });

      this.ttsClient.on('error', (err) => {
        this.emit('error', { error: `tts_socket_error: ${err?.message || err}` });
      });
    }

    await this.ttsClient.connect();
    return this.ttsClient;
  }

  #isTraceEnabled() {
    return Boolean(this.config.pipeline.traceFull || this.config.server.logLevel === 'debug');
  }

  #emitTrace(eventType, payload = {}) {
    if (!this.#isTraceEnabled()) return;
    const atMs = Date.now();
    this.emit('metrics', {
      type: `trace_${eventType}`,
      atMs,
      atIso: nowIso(atMs),
      ...payload,
    });
  }

  #providerRuntimeConfig(providerName) {
    if (providerName === 'cerebras') {
      return {
        model: this.config.cerebras.model,
        temperature: this.config.cerebras.temperature,
        maxCompletionTokens: this.config.cerebras.maxCompletionTokens,
        topP: this.config.cerebras.topP,
        reasoningEffort: this.config.cerebras.reasoningEffort,
      };
    }
    if (providerName === 'sarvam') {
      return {
        model: this.config.sarvam.model,
        temperature: this.config.sarvam.temperature,
        maxCompletionTokens: this.config.sarvam.maxCompletionTokens,
        topP: this.config.sarvam.topP,
        reasoningEffort: this.config.sarvam.reasoningEffort,
      };
    }
    if (providerName === 'gemini') {
      return {
        model: this.config.gemini.model,
        temperature: this.config.gemini.temperature,
        maxCompletionTokens: this.config.gemini.maxCompletionTokens,
        topP: this.config.gemini.topP,
        reasoningEffort: null,
      };
    }
    return {
      model: this.config.groq.model,
      temperature: this.config.groq.temperature,
      maxCompletionTokens: this.config.groq.maxCompletionTokens,
      topP: this.config.groq.topP,
      reasoningEffort: this.config.groq.reasoningEffort,
    };
  }

  #getProvider(providerName) {
    const validProviders = ['cerebras', 'groq', 'sarvam', 'gemini'];
    const normalized = validProviders.includes(providerName) ? providerName : 'groq';
    if (this.providers.has(normalized)) {
      return this.providers.get(normalized);
    }

    let provider;
    if (normalized === 'cerebras') {
      provider = new CerebrasProvider({
        apiKey: this.config.keys.cerebrasApiKey,
        model: this.config.cerebras.model,
        temperature: this.config.cerebras.temperature,
        maxCompletionTokens: this.config.cerebras.maxCompletionTokens,
        topP: this.config.cerebras.topP,
        reasoningEffort: this.config.cerebras.reasoningEffort,
        stop: this.config.cerebras.stop,
        allowReasoningFallback: this.config.cerebras.allowReasoningFallback,
        systemPrompt: this.config.cerebras.systemPrompt,
      });
    } else if (normalized === 'gemini') {
      provider = new GeminiProvider({
        apiKey: this.config.keys.geminiApiKey,
        model: this.config.gemini.model,
        temperature: this.config.gemini.temperature,
        maxCompletionTokens: this.config.gemini.maxCompletionTokens,
        topP: this.config.gemini.topP,
        stop: this.config.gemini.stop,
        systemPrompt: this.config.gemini.systemPrompt,
      });
    } else if (normalized === 'sarvam') {
      provider = new SarvamProvider({
        apiKey: this.config.keys.sarvamApiKey,
        model: this.config.sarvam.model,
        temperature: this.config.sarvam.temperature,
        maxCompletionTokens: this.config.sarvam.maxCompletionTokens,
        topP: this.config.sarvam.topP,
        reasoningEffort: this.config.sarvam.reasoningEffort,
        stop: this.config.sarvam.stop,
        systemPrompt: this.config.sarvam.systemPrompt,
      });
    } else {
      provider = new GroqProvider({
        apiKey: this.config.keys.groqApiKey,
        model: this.config.groq.model,
        temperature: this.config.groq.temperature,
        maxCompletionTokens: this.config.groq.maxCompletionTokens,
        topP: this.config.groq.topP,
        reasoningEffort: this.config.groq.reasoningEffort,
        stop: this.config.groq.stop,
        allowReasoningFallback: this.config.groq.allowReasoningFallback,
        systemPrompt: this.config.groq.systemPrompt,
      });
    }

    this.providers.set(normalized, provider);
    return provider;
  }

  #resetLiveTranscriptStateForSegment(segmentIndex) {
    this.liveTranscriptState = {
      segmentIndex,
      lastText: '',
      lastSentAtMs: 0,
    };
  }

  #clearLateTranscriptFallback() {
    this.lateTranscriptFallback = null;
  }

  #clearContext() {
    this.conversationHistory = [];
    this.turnStates.clear();
    this.turnCounter = 0;
    this.emit('metrics', {
      type: 'context_cleared',
    });
  }

  #currentContextTurns() {
    const turnIds = new Set();
    for (const msg of this.conversationHistory) {
      if (msg?.turnId) turnIds.add(msg.turnId);
    }
    return turnIds.size;
  }

  #pruneContextHistory() {
    const maxTurns = Math.max(0, Number(this.config.pipeline.contextMaxTurns || 0));
    if (maxTurns > 0) {
      const seen = new Set();
      for (let i = this.conversationHistory.length - 1; i >= 0; i -= 1) {
        const turnId = this.conversationHistory[i]?.turnId;
        if (turnId) seen.add(turnId);
        if (seen.size > maxTurns) {
          const cutoffTurnId = turnId;
          this.conversationHistory = this.conversationHistory.filter(
            (msg) => msg.turnId !== cutoffTurnId
          );
          seen.delete(cutoffTurnId);
        }
      }
    }

    const maxChars = Math.max(0, Number(this.config.pipeline.contextMaxChars || 0));
    if (maxChars > 0) {
      let totalChars = this.conversationHistory.reduce(
        (sum, msg) => sum + String(msg?.content || '').length,
        0
      );
      while (totalChars > maxChars && this.conversationHistory.length > 2) {
        const removed = this.conversationHistory.shift();
        totalChars -= String(removed?.content || '').length;
      }
    }
  }

  #ensureUserHistory(turn) {
    if (!turn || turn.historyUserIndex !== null) return;
    const content = String(turn.userPrompt || '').trim();
    if (!content) return;
    this.conversationHistory.push({
      role: 'user',
      content,
      turnId: turn.turnId,
      requestId: turn.requestId,
      interrupted: false,
      timestampMs: Date.now(),
    });
    turn.historyUserIndex = this.conversationHistory.length - 1;
    this.#pruneContextHistory();
  }

  #upsertAssistantHistory(turn, content, interrupted = false) {
    if (!turn) return;
    const text = String(content || '').trim();
    if (!text) return;
    if (turn.historyAssistantIndex === null) {
      this.conversationHistory.push({
        role: 'assistant',
        content: text,
        turnId: turn.turnId,
        requestId: turn.requestId,
        interrupted: !!interrupted,
        timestampMs: Date.now(),
      });
      turn.historyAssistantIndex = this.conversationHistory.length - 1;
      this.#pruneContextHistory();
      return;
    }
    if (!this.conversationHistory[turn.historyAssistantIndex]) return;
    this.conversationHistory[turn.historyAssistantIndex].content = text;
    this.conversationHistory[turn.historyAssistantIndex].interrupted = !!interrupted;
    this.conversationHistory[turn.historyAssistantIndex].timestampMs = Date.now();
  }

  #createTurnState(requestId, prompt) {
    const turnState = {
      turnId: ++this.turnCounter,
      requestId,
      userPrompt: String(prompt || '').trim(),
      assistantGeneratedText: '',
      assistantSpokenText: '',
      status: 'running',
      startedAtMs: Date.now(),
      interruptedAtMs: null,
      completedAtMs: null,
      historyUserIndex: null,
      historyAssistantIndex: null,
    };
    this.turnStates.set(requestId, turnState);
    this.#ensureUserHistory(turnState);
    return turnState;
  }

  #appendGeneratedForTurn(requestId, tokenText) {
    const turn = this.turnStates.get(requestId);
    if (!turn || turn.status !== 'running') return;
    turn.assistantGeneratedText = mergeText(turn.assistantGeneratedText, tokenText);
  }

  #appendSpokenForTurn(requestId, text) {
    const turn = this.turnStates.get(requestId);
    if (!turn || turn.status !== 'running') return;
    turn.assistantSpokenText = mergeText(turn.assistantSpokenText, text);
  }

  #finalizeCompletedTurn(requestId, assistantText) {
    const turn = this.turnStates.get(requestId);
    if (!turn || turn.status !== 'running') return;
    turn.completedAtMs = Date.now();
    turn.status = 'completed';
    const finalAssistant = String(assistantText || '').trim() || String(turn.assistantGeneratedText || '').trim();
    this.#ensureUserHistory(turn);
    this.#upsertAssistantHistory(turn, finalAssistant, false);
    this.turnStates.delete(requestId);
  }

  #finalizeInterruptedTurn(requestId, reason) {
    const turn = this.turnStates.get(requestId);
    if (!turn || turn.status !== 'running') return;
    turn.status = 'interrupted';
    turn.interruptedAtMs = Date.now();
    const spokenPartial = String(turn.assistantSpokenText || '').trim();
    const generatedPartial = String(turn.assistantGeneratedText || '').trim();
    this.#ensureUserHistory(turn);
    if (spokenPartial) {
      this.#upsertAssistantHistory(turn, spokenPartial, true);
    } else if (generatedPartial) {
      this.#upsertAssistantHistory(turn, generatedPartial, true);
    }
    this.emit('metrics', {
      type: 'turn_interrupted_context_saved',
      requestId,
      reason,
      hasSpokenPartial: Boolean(spokenPartial),
      spokenPartialChars: spokenPartial.length,
      hasGeneratedPartial: Boolean(generatedPartial),
      generatedPartialChars: generatedPartial.length,
      contextTurns: this.#currentContextTurns(),
    });
    this.turnStates.delete(requestId);
  }

  #buildContextMessages(prompt) {
    const messages = [];
    const providerName = this.activeProvider;
    let baseSystemPrompt;
    if (providerName === 'cerebras') {
      baseSystemPrompt = this.config.cerebras.systemPrompt;
    } else if (providerName === 'sarvam') {
      baseSystemPrompt = this.config.sarvam.systemPrompt;
    } else if (providerName === 'gemini') {
      baseSystemPrompt = this.config.gemini.systemPrompt;
    } else {
      baseSystemPrompt = this.config.groq.systemPrompt;
    }
    const languageInstruction = buildLanguageConstraintInstruction(this.config.tts.languageCode);

    const systemParts = [];
    if (baseSystemPrompt) systemParts.push(String(baseSystemPrompt).trim());
    if (languageInstruction) systemParts.push(languageInstruction);
    const systemPrompt = systemParts.filter(Boolean).join('\n\n');

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (this.config.pipeline.contextEnabled) {
      for (const msg of this.conversationHistory) {
        if (!msg?.role || !msg?.content) continue;
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  #markInFlightDropped(reason) {
    const dropped = this.bargeIn.dropInFlight(reason);
    if (!dropped) return null;
    this.#finalizeInterruptedTurn(dropped.requestId, reason);

    if (this.ttsClient) {
      try {
        this.ttsClient.abort('Turn aborted');
      } catch {}
      this.ttsClient = null;
    }

    return dropped;
  }

  #isLikelyAssistantEcho(transcript) {
    if (!this.config.pipeline.echoGuardEnabled) return false;
    const sample = String(transcript || '').trim();
    if (!sample) return false;
    if (sample.length < this.config.pipeline.echoGuardMinChars) return false;
    if (!this.bargeIn.inFlight?.requestId) return false;

    const inFlightTurn = this.turnStates.get(this.bargeIn.inFlight.requestId);
    if (!inFlightTurn) return false;

    const assistantText = mergeText(
      inFlightTurn.assistantSpokenText,
      inFlightTurn.assistantGeneratedText
    );
    if (!assistantText) return false;

    const normAssistant = normalizeForTokenCompare(assistantText);
    const normSample = normalizeForTokenCompare(sample);
    if (!normAssistant || !normSample) return false;

    if (normAssistant.includes(normSample)) return true;
    const overlap = tokenOverlapRatio(normSample, normAssistant);
    return overlap >= Number(this.config.pipeline.echoGuardTokenOverlap || 0.8);
  }

  #finalizeSegmentPrompt(segmentIndex, endedAtMs, rawTranscript, dispatchReason) {
    const transcript = sanitizePromptTranscript(
      rawTranscript,
      this.config.pipeline.dedupRepeatedTranscript
    );
    if (!transcript) return false;
    const transcriptWordCount = countWords(transcript);

    const resolvedAtMs = Date.now();
    this.emit('metrics', {
      type: 'prompt_finalized',
      segmentIndex,
      promptChars: transcript.length,
      promptFinalizedAtMs: resolvedAtMs,
      promptFinalizedAtIso: nowIso(resolvedAtMs),
      detectionEndToPromptReadyMs: Math.max(0, resolvedAtMs - endedAtMs),
      dispatchReason,
    });

    this.#clearLateTranscriptFallback();

    if (this.bargeIn.inFlight) {
      if (this.#isLikelyAssistantEcho(transcript)) {
        this.emit('metrics', {
          type: 'skip_provider',
          reason: 'likely_assistant_echo_while_inflight',
          segmentIndex,
          promptChars: transcript.length,
        });
        return false;
      }

      if (this.liveDispatchedSegments.has(segmentIndex)) {
        this.bargeIn.queueLatestPrompt(transcript);
      } else {
        this.bargeIn.mergeQueuedPrompt(transcript);
      }
      const dropped = this.#markInFlightDropped('new_segment_closed_while_provider_inflight');
      if (dropped) {
        this.emit('metrics', {
          type: 'barge_in',
          requestId: dropped.requestId,
          provider: dropped.provider,
          reason: dropped.reason,
          queuedPromptChars: this.bargeIn.queuedPrompt.length,
        });
      }
      return true;
    }

    if (
      transcript.length < this.config.pipeline.minPromptChars ||
      transcriptWordCount < this.config.pipeline.minPromptWords
    ) {
      this.emit('metrics', {
        type: 'skip_provider',
        reason: 'empty_or_short_prompt',
        promptChars: transcript.length,
        promptWords: transcriptWordCount,
        minPromptChars: this.config.pipeline.minPromptChars,
        minPromptWords: this.config.pipeline.minPromptWords,
        segmentIndex,
      });
      return false;
    }

    const promptToSend = mergePrompts(this.bargeIn.consumeQueuedPrompt(), transcript);
    this.#dispatchTurn(promptToSend, endedAtMs, dispatchReason);
    return true;
  }

  #resolveEndedSegmentTranscript(segmentTranscript) {
    if (!this.pendingEndedSegment) return;

    const transcript = sanitizePromptTranscript(
      segmentTranscript,
      this.config.pipeline.dedupRepeatedTranscript
    );
    const endedAtMs = this.pendingEndedSegment.endedAtMs;
    const segmentIndex = this.pendingEndedSegment.segmentIndex;

    if (this.pendingEndedSegment.timer) {
      clearTimeout(this.pendingEndedSegment.timer);
    }
    this.pendingEndedSegment = null;

    if (!transcript) {
      this.lateTranscriptFallback = {
        segmentIndex,
        endedAtMs,
        expiresAtMs: Date.now() + Math.max(0, this.config.pipeline.lateTranscriptMaxMs),
      };
      this.emit('metrics', {
        type: 'waiting_late_transcript',
        segmentIndex,
        lateWindowMs: Math.max(0, this.config.pipeline.lateTranscriptMaxMs),
      });
      return;
    }

    if (
      this.config.pipeline.skipEndAfterLiveDispatch &&
      this.liveDispatchedSegments.has(segmentIndex)
    ) {
      this.liveDispatchedSegments.delete(segmentIndex);
      this.emit('metrics', {
        type: 'skip_provider',
        reason: 'already_dispatched_live_transcript',
        segmentIndex,
      });
      return;
    }

    this.#finalizeSegmentPrompt(segmentIndex, endedAtMs, transcript, 'vad_end_speech');
  }

  #maybeDispatchLiveTranscript(transcript) {
    if (!this.config.pipeline.sendOnTranscript) return;
    if (!this.vad.speechActive || !this.vad.activeSegment) return;

    const text = String(transcript || '').trim();
    if (!text || text.length < this.config.pipeline.sendOnTranscriptMinChars) return;
    if (countWords(text) < this.config.pipeline.minPromptWords) return;

    const segmentIndex = this.vad.activeSegment.segmentIndex;
    if (this.liveTranscriptState.segmentIndex !== segmentIndex) {
      this.#resetLiveTranscriptStateForSegment(segmentIndex);
    }

    if (text === this.liveTranscriptState.lastText) return;

    const nowMs = Date.now();
    if (nowMs - this.liveTranscriptState.lastSentAtMs < this.config.pipeline.sendOnTranscriptDebounceMs) {
      return;
    }

    this.liveTranscriptState.lastText = text;
    this.liveTranscriptState.lastSentAtMs = nowMs;
    this.liveDispatchedSegments.add(segmentIndex);

    if (this.bargeIn.inFlight) {
      this.bargeIn.queueLatestPrompt(text);
      const dropped = this.#markInFlightDropped('new_live_transcript_while_provider_inflight');
      if (dropped) {
        this.emit('metrics', {
          type: 'barge_in',
          requestId: dropped.requestId,
          provider: dropped.provider,
          reason: dropped.reason,
          queuedPromptChars: this.bargeIn.queuedPrompt.length,
          segmentIndex,
        });
      }
      return;
    }

    this.#dispatchTurn(text, nowMs, 'live_transcript');
  }

  #schedulePendingSegmentCheck() {
    if (!this.pendingEndedSegment) return;

    const check = () => {
      if (!this.pendingEndedSegment) return;

      if (
        this.pendingEndedSegment.finalSeen &&
        this.pendingEndedSegment.accumulatedTranscript
      ) {
        this.#resolveEndedSegmentTranscript(this.pendingEndedSegment.accumulatedTranscript);
        return;
      }

      const nowMs = Date.now();
      const elapsedMs = nowMs - this.pendingEndedSegment.endedAtMs;
      const hasAccumulated = !!this.pendingEndedSegment.accumulatedTranscript;
      const sinceLastUpdateMs = this.pendingEndedSegment.lastTranscriptAtMs
        ? nowMs - this.pendingEndedSegment.lastTranscriptAtMs
        : Number.POSITIVE_INFINITY;

      if (
        hasAccumulated &&
        elapsedMs >= this.config.pipeline.transcriptGraceMs &&
        sinceLastUpdateMs >= this.config.pipeline.transcriptPollMs
      ) {
        this.#resolveEndedSegmentTranscript(this.pendingEndedSegment.accumulatedTranscript);
        return;
      }

      if (
        elapsedMs >=
        Math.max(this.config.pipeline.transcriptGraceMs, this.config.pipeline.transcriptMaxWaitMs)
      ) {
        this.#resolveEndedSegmentTranscript(this.pendingEndedSegment.accumulatedTranscript || '');
        return;
      }

      this.pendingEndedSegment.timer = setTimeout(
        check,
        Math.max(20, this.config.pipeline.transcriptPollMs)
      );
    };

    if (this.pendingEndedSegment.timer) clearTimeout(this.pendingEndedSegment.timer);
    this.pendingEndedSegment.timer = setTimeout(
      check,
      Math.max(20, this.config.pipeline.transcriptGraceMs)
    );
  }

  #maybeDispatchQueuedTurn() {
    if (this.bargeIn.inFlight || this.vad.speechActive) return;
    if (!this.bargeIn.hasQueuedPrompt()) return;

    const queued = this.bargeIn.consumeQueuedPrompt();
    this.#dispatchTurn(queued, Date.now(), 'queued_after_barge_in');
  }

  #dispatchTurn(promptText, detectionEndedAtMs, reason) {
    const prompt = String(promptText || '').trim();
    const promptWordCount = countWords(prompt);
    if (
      !prompt ||
      prompt.length < this.config.pipeline.minPromptChars ||
      promptWordCount < this.config.pipeline.minPromptWords
    ) {
      this.emit('metrics', {
        type: 'skip_provider',
        reason: 'empty_or_short_prompt',
        promptChars: prompt.length,
        promptWords: promptWordCount,
        minPromptWords: this.config.pipeline.minPromptWords,
      });
      return;
    }

    const requestId = ++this.modelRequestCounter;
    const provider = this.activeProvider;
    const sendAtMs = Date.now();
    const abortController = new AbortController();

    this.bargeIn.setInFlight({
      requestId,
      provider,
      detectionEndedAtMs,
      sendAtMs,
      promptChars: prompt.length,
      abortController,
    });
    this.#createTurnState(requestId, prompt);

    const detectionEndToProviderSendMs =
      typeof detectionEndedAtMs === 'number' ? Math.max(0, sendAtMs - detectionEndedAtMs) : null;

    this.emit('metrics', {
      type: 'provider_dispatch',
      requestId,
      provider,
      reason,
      promptChars: prompt.length,
      promptEndedAtMs: detectionEndedAtMs,
      promptEndedAtIso: nowIso(detectionEndedAtMs),
      providerSendAtMs: sendAtMs,
      providerSendAtIso: nowIso(sendAtMs),
      detectionEndToProviderSendMs,
    });
    this.#emitTrace('turn_dispatch', {
      requestId,
      provider,
      reason,
      detectionEndedAtMs,
      providerSendAtMs: sendAtMs,
      prompt,
      promptChars: prompt.length,
      promptWords: promptWordCount,
    });

    this.#runProviderTurn(prompt, provider, requestId, detectionEndedAtMs, abortController.signal)
      .catch(async (primaryErr) => {
        const shouldFallbackToGroq =
          provider !== 'groq' &&
          isTransientProviderError(primaryErr) &&
          !isAbortLikeError(primaryErr) &&
          !this.bargeIn.isDropped(requestId);

        if (!shouldFallbackToGroq) {
          throw primaryErr;
        }

        this.emit('metrics', {
          type: 'provider_fallback_attempt',
          requestId,
          fromProvider: provider,
          toProvider: 'groq',
          reason: 'primary_provider_transient_error',
          errorPreview: previewText(String(primaryErr?.message || primaryErr || '')),
        });

        try {
          const summary = await this.#runProviderTurn(
            prompt,
            'groq',
            requestId,
            detectionEndedAtMs,
            abortController.signal
          );
          this.emit('metrics', {
            type: 'provider_fallback_success',
            requestId,
            fromProvider: provider,
            toProvider: 'groq',
          });
          return summary;
        } catch (fallbackErr) {
          this.emit('metrics', {
            type: 'provider_fallback_failed',
            requestId,
            fromProvider: provider,
            toProvider: 'groq',
            fallbackErrorPreview: previewText(String(fallbackErr?.message || fallbackErr || '')),
          });
          throw new Error(
            `primary_provider_error:${primaryErr?.message || primaryErr}; fallback_provider_error:${fallbackErr?.message || fallbackErr}`
          );
        }
      })
      .then((summary) => {
        this.bargeIn.markSettled(requestId);

        const wasDropped = this.bargeIn.consumeDropped(requestId);
        if (wasDropped) {
          this.emit('metrics', {
            type: 'provider_discarded',
            requestId,
            provider,
          });
          return;
        }

        this.#finalizeCompletedTurn(requestId, summary.generatedText);

        this.emit('metrics', {
          type: 'provider_result',
          ...summary,
          contextTurns: this.#currentContextTurns(),
        });
      })
      .catch((err) => {
        this.bargeIn.markSettled(requestId);

        const wasDropped = this.bargeIn.consumeDropped(requestId);
        if (wasDropped || isAbortLikeError(err)) {
          this.#finalizeInterruptedTurn(requestId, 'provider_aborted');
          this.emit('metrics', {
            type: 'provider_aborted',
            requestId,
            provider,
          });
          return;
        }

        if (isSarvamAllowedLanguageError(err) || isAnyTtsError(err)) {
          const currentTurn = this.turnStates.get(requestId);
          this.#finalizeCompletedTurn(
            requestId,
            String(currentTurn?.assistantGeneratedText || '').trim()
          );
          this.emit('metrics', {
            type: 'skip_tts_segment',
            requestId,
            provider,
            reason: isSarvamAllowedLanguageError(err)
              ? 'sarvam_allowed_language_error_top_level'
              : 'tts_error_top_level',
            ttsLanguage: this.config.tts.languageCode,
            textPreview: previewText(String(err?.message || err || '')),
          });
          return;
        }

        // Generic provider errors (network, timeout, etc.)
        // Finalize as interrupted to preserve user prompt in conversation context
        this.#finalizeInterruptedTurn(requestId, 'provider_error');

        this.emit('error', {
          error: `provider_error request=${requestId} provider=${provider} message=${err?.message || err}`,
        });
      })
      .finally(() => {
        this.#maybeDispatchQueuedTurn();
      });
  }

  #buildToolResultMessages(toolCalls, toolResults) {
    const messages = [];
    
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: tc.type || 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    });

    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: typeof result.content === 'string' 
          ? result.content 
          : JSON.stringify(result.content),
      });
    }

    return messages;
  }

  async #runProviderTurn(prompt, providerName, requestId, detectionEndedAtMs, abortSignal) {
    const provider = this.#getProvider(providerName);
    const tts = await this.#ensureTtsClient();

    const tracker = new LatencyTracker(providerName, requestId, prompt, detectionEndedAtMs);

    let segmentIndex = 0;
    const streamDebugEnabled = Boolean(this.config.pipeline.streamDebug);
    const streamDebugMaxPreviews = Math.max(
      0,
      Number(this.config.pipeline.streamDebugMaxPreviews || 0)
    );
    const streamDebugPreviewChars = Math.max(
      40,
      Number(this.config.pipeline.streamDebugPreviewChars || 220)
    );

    const maxToolIterations = Math.max(1, Number(this.config.tools?.maxIterations || 5));
    const toolsEnabled = this.config.tools?.enabled !== false;

    const throwIfAborted = () => {
      if (abortSignal?.aborted) {
        throw new Error('Turn aborted');
      }
    };

    const executeToolCalls = async (toolCalls) => {
      const results = [];
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;
        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (err) {
          const parseErrorResult = {
            success: false,
            error: `Invalid tool arguments JSON: ${err?.message || 'parse error'}`,
          };

          this.emit('tool_result', {
            requestId,
            toolName,
            result: parseErrorResult,
          });

          results.push({
            toolCallId: toolCall.id,
            toolName,
            content: parseErrorResult,
          });

          this.emit('metrics', {
            type: 'tool_result',
            requestId,
            provider: providerName,
            toolName,
            toolCallId: toolCall.id,
            success: false,
            reason: 'invalid_tool_arguments_json',
          });
          continue;
        }
        
        this.emit('tool_call', {
          requestId,
          toolName,
          arguments: toolArgs,
        });

        this.emit('metrics', {
          type: 'tool_call',
          requestId,
          provider: providerName,
          toolName,
          toolCallId: toolCall.id,
        });

        let result;
        try {
          result = await this.toolExecutor.execute(toolName, toolArgs);
        } catch (err) {
          result = { success: false, error: err?.message || 'Tool execution failed' };
        }

        this.emit('tool_result', {
          requestId,
          toolName,
          result,
        });

        results.push({
          toolCallId: toolCall.id,
          toolName,
          content: result,
        });

        this.emit('metrics', {
          type: 'tool_result',
          requestId,
          provider: providerName,
          toolName,
          toolCallId: toolCall.id,
          success: result?.success !== false,
        });
      }
      return results;
    };

    const processStreamWithTts = async (currentMessages, iteration) => {
      let bufferedText = '';
      let ttsDeferredPrefix = '';
      let flushTimer = null;
      let flushQueue = Promise.resolve();
      let streamPreviewBuffer = '';
      let streamPreviewCount = 0;

      const emitStreamPreview = (text, reason) => {
        if (!streamDebugEnabled || streamPreviewCount >= streamDebugMaxPreviews) return;
        const value = String(text || '').trim();
        if (!value) return;
        streamPreviewCount += 1;
        this.emit('metrics', {
          type: 'provider_stream_preview',
          requestId,
          provider: providerName,
          previewIndex: streamPreviewCount,
          reason,
          chars: value.length,
          text: previewText(value, streamDebugPreviewChars),
        });
      };

      const flushStreamPreview = (force = false) => {
        if (!streamDebugEnabled || streamPreviewCount >= streamDebugMaxPreviews) return;
        while (streamPreviewCount < streamDebugMaxPreviews) {
          const idx = streamPreviewBuffer.search(/[.!?।॥\n]/u);
          if (idx >= 0) {
            const sentence = streamPreviewBuffer.slice(0, idx + 1).trim();
            streamPreviewBuffer = streamPreviewBuffer.slice(idx + 1);
            if (sentence) emitStreamPreview(sentence, 'sentence_boundary');
            continue;
          }
          if (force) {
            const remaining = streamPreviewBuffer.trim();
            streamPreviewBuffer = '';
            if (remaining) emitStreamPreview(remaining, 'stream_end_partial');
          }
          break;
        }
      };

      const flushSegment = async (text, reason) => {
        throwIfAborted();
        const segmentText = String(text || '').trim();
        if (!segmentText) return;

        const mergedText = mergeText(ttsDeferredPrefix, segmentText);
        if (!mergedText) return;

        const contentPrepared = this.config.pipeline.ttsSanitize
          ? sanitizeTextForTtsLanguage(mergedText, this.config.tts.languageCode)
          : mergedText;
        if (!contentPrepared) {
          ttsDeferredPrefix = '';
          this.emit('metrics', {
            type: 'skip_tts_segment',
            requestId,
            provider: providerName,
            reason: 'empty_after_tts_sanitize',
            ttsLanguage: this.config.tts.languageCode,
            textChars: mergedText.length,
            textPreview: previewText(mergedText),
          });
          return;
        }

        if (contentPrepared !== mergedText) {
          this.emit('metrics', {
            type: 'tts_text_sanitized',
            requestId,
            provider: providerName,
            ttsLanguage: this.config.tts.languageCode,
            originalChars: mergedText.length,
            sanitizedChars: contentPrepared.length,
            originalPreview: previewText(mergedText),
            sanitizedPreview: previewText(contentPrepared),
          });
        }

        if (!hasRequiredScriptChar(contentPrepared, this.config.tts.languageCode)) {
          ttsDeferredPrefix = contentPrepared;
          this.emit('metrics', {
            type: 'skip_tts_segment',
            requestId,
            provider: providerName,
            reason: 'missing_required_language_char',
            ttsLanguage: this.config.tts.languageCode,
            textChars: contentPrepared.length,
            textPreview: previewText(contentPrepared),
          });
          return;
        }

        ttsDeferredPrefix = '';
        const content = contentPrepared;

        segmentIndex += 1;
        const segStartMs = Date.now();
        this.#appendSpokenForTurn(requestId, content);

        let ttsResult;
        try {
          ttsResult = await tts.speakText(content, {
            onAudioChunk: ({ base64, atMs }) => {
              this.emit('audio', {
                requestId,
                provider: providerName,
                segmentIndex,
                audioBase64: base64,
                atMs,
                atIso: nowIso(atMs),
              });
            },
          });
        } catch (err) {
          if (isSarvamAllowedLanguageError(err) || isAnyTtsError(err)) {
            this.emit('metrics', {
              type: 'skip_tts_segment',
              requestId,
              provider: providerName,
              reason: isSarvamAllowedLanguageError(err)
                ? 'sarvam_allowed_language_error'
                : 'tts_error_non_fatal',
              ttsLanguage: this.config.tts.languageCode,
              textChars: content.length,
              textPreview: previewText(content),
              errorPreview: previewText(String(err?.message || err || '')),
            });
            return;
          }
          throw err;
        }

        throwIfAborted();

        const segment = {
          index: segmentIndex,
          reason,
          text: content,
          textChars: content.length,
          sentAtMs: ttsResult.sentAtMs,
          sentAtIso: nowIso(ttsResult.sentAtMs),
          firstChunkAtMs: ttsResult.firstAudioAtMs,
          firstChunkAtIso: nowIso(ttsResult.firstAudioAtMs),
          sendToFirstChunkMs: ttsResult.sendToFirstAudioMs,
          totalTtsMs: ttsResult.totalTtsMs,
          audioChunkCount: ttsResult.audioChunkCount,
          audioBytes: ttsResult.audioBytes,
          processingWallMs: Date.now() - segStartMs,
        };

        tracker.addSegment(segment);
        this.#emitTrace('tts_segment', {
          requestId,
          provider: providerName,
          segment,
        });
      };

      const enqueueFlush = (text, reason) => {
        if (abortSignal?.aborted) return flushQueue;
        const content = String(text || '').trim();
        if (!content) return flushQueue;
        flushQueue = flushQueue.then(() => flushSegment(content, reason));
        return flushQueue;
      };

      const drainBuffered = (reason) => {
        const text = bufferedText;
        bufferedText = '';
        return enqueueFlush(text, reason);
      };

      const scheduleTimeoutFlush = () => {
        if (abortSignal?.aborted) return;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
          const { chunk, remaining } = splitTimeoutSafeChunk(bufferedText, 8);
          if (!chunk) return;
          bufferedText = remaining;
          enqueueFlush(chunk, 'timeout').catch((err) => {
            if (abortSignal?.aborted || isAbortLikeError(err)) return;
            if (isSarvamAllowedLanguageError(err) || isAnyTtsError(err)) return;
            this.emit('error', {
              error: `flush_timeout_error request=${requestId} message=${err?.message || err}`,
            });
          });
        }, this.config.bridge.flushTimeoutMs);
      };

      const accumulatedToolCalls = [];

      const providerMetrics = await provider.streamText({
        prompt,
        messages: currentMessages,
        abortSignal,
        tools: toolsEnabled ? toolDefinitions : undefined,
        onFirstToken: async ({ atMs, source }) => {
          if (iteration === 0) {
            tracker.markFirstToken(atMs, source);
          }
        },
        onToken: async (tokenText) => {
          throwIfAborted();

          tracker.addGeneratedText(tokenText);
          tracker.addTokensApprox(countTokensApprox(tokenText));
          this.#appendGeneratedForTurn(requestId, tokenText);
          streamPreviewBuffer += tokenText;
          flushStreamPreview(false);

          bufferedText += tokenText;
          const { chunks, remaining } = extractLineChunks(bufferedText, this.config.tts.maxTextChars);
          bufferedText = remaining;

          for (const ready of chunks) {
            throwIfAborted();
            await enqueueFlush(ready, 'line_or_limit');
          }

          scheduleTimeoutFlush();
        },
        onToolCall: async (toolCall) => {
          accumulatedToolCalls.push(toolCall);
        },
      });

      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      if (bufferedText.trim()) {
        await drainBuffered('stream_end');
      }

      await flushQueue;
      flushStreamPreview(true);

      if (ttsDeferredPrefix.trim()) {
        this.emit('metrics', {
          type: 'skip_tts_segment',
          requestId,
          provider: providerName,
          reason: 'stream_ended_without_required_language_char',
          ttsLanguage: this.config.tts.languageCode,
          textChars: ttsDeferredPrefix.trim().length,
          textPreview: previewText(ttsDeferredPrefix),
        });
      }

      this.#emitTrace('llm_stream_iteration_complete', {
        requestId,
        provider: providerName,
        iteration,
        generatedText: String(providerMetrics?.generatedText || ''),
        finishReason: providerMetrics?.finishReason || null,
        tokenCountApprox: providerMetrics?.tokenCountApprox ?? null,
        toolCalls: providerMetrics?.toolCalls || [],
      });

      return {
        providerMetrics,
        toolCalls: accumulatedToolCalls,
      };
    };

    const contextMessages = this.#buildContextMessages(prompt);
    this.emit('metrics', {
      type: 'context_window',
      requestId,
      provider: providerName,
      contextEnabled: this.config.pipeline.contextEnabled,
      messages: contextMessages.length,
      turns: this.#currentContextTurns(),
      promptChars: String(prompt || '').length,
    });
    this.#emitTrace('llm_request', {
      requestId,
      provider: providerName,
      prompt,
      contextMessages,
      providerConfig: this.#providerRuntimeConfig(providerName),
      toolsEnabled,
    });

    let currentMessages = contextMessages;
    let iteration = 0;
    let finalProviderMetrics = null;

    while (iteration < maxToolIterations) {
      throwIfAborted();

      const { providerMetrics, toolCalls } = await processStreamWithTts(currentMessages, iteration);

      if (iteration === 0) {
        tracker.setProviderFinishReason(providerMetrics.finishReason);
      }

      if (!toolCalls || toolCalls.length === 0) {
        finalProviderMetrics = providerMetrics;
        break;
      }

      this.emit('metrics', {
        type: 'tool_calls_detected',
        requestId,
        provider: providerName,
        iteration,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map(tc => tc.function?.name),
      });

      const toolResults = await executeToolCalls(toolCalls);

      const toolResultMessages = this.#buildToolResultMessages(toolCalls, toolResults);
      currentMessages = [...currentMessages, ...toolResultMessages];

      iteration += 1;

      if (iteration >= maxToolIterations) {
        this.emit('metrics', {
          type: 'tool_iteration_limit',
          requestId,
          provider: providerName,
          maxIterations: maxToolIterations,
        });
        break;
      }
    }

    if (finalProviderMetrics?.finishReason === 'length') {
      this.emit('metrics', {
        type: 'provider_truncated',
        requestId,
        provider: providerName,
        finishReason: finalProviderMetrics.finishReason,
        configuredMaxTokens:
          providerName === 'cerebras'
            ? this.config.cerebras.maxCompletionTokens
            : providerName === 'sarvam'
              ? this.config.sarvam.maxCompletionTokens
              : providerName === 'gemini'
                ? this.config.gemini.maxCompletionTokens
            : this.config.groq.maxCompletionTokens,
      });
    }

    throwIfAborted();
    const completed = tracker.complete(finalProviderMetrics?.tpsApprox);
    this.#emitTrace('llm_turn_complete', {
      requestId,
      provider: providerName,
      finalMetrics: {
        finishReason: finalProviderMetrics?.finishReason || null,
        tokenCountApprox: finalProviderMetrics?.tokenCountApprox ?? null,
        generatedText: String(finalProviderMetrics?.generatedText || ''),
        toolCalls: finalProviderMetrics?.toolCalls || [],
      },
      latency: completed,
    });

    return completed;
  }

  #handleSttMessage(response) {
    this.emit('metrics', {
      type: 'stt_message',
      summary: summarizeSttMessage(response),
    });

    const transcript = extractTranscript(response);
    const transcriptIsFinal = extractTranscriptIsFinal(response);
    const transcriptNormalized = normalizeTranscriptText(transcript);

    if (transcriptNormalized) {
      if (transcriptNormalized.length < this.config.pipeline.minTranscriptChars) {
        this.emit('metrics', {
          type: 'skip_transcript',
          reason: 'too_short',
          transcriptChars: transcriptNormalized.length,
          minChars: this.config.pipeline.minTranscriptChars,
        });
      } else {
        this.lastTranscriptText = transcriptNormalized;
        this.lastTranscriptSeq += 1;

        if (this.vad.speechActive) {
          this.activeSegmentTranscript = mergeTranscriptText(
            this.activeSegmentTranscript,
            transcriptNormalized
          );
        }

        if (
          this.bargeIn.inFlight &&
          this.vad.speechActive &&
          this.config.pipeline.abortOnTranscript &&
          transcriptNormalized.length >= this.config.pipeline.abortOnTranscriptMinChars
        ) {
          const dropped = this.#markInFlightDropped('transcript_arrived_while_provider_inflight');
          if (dropped) {
            this.emit('metrics', {
              type: 'barge_in',
              requestId: dropped.requestId,
              provider: dropped.provider,
              reason: dropped.reason,
            });
          }
        }

        this.#maybeDispatchLiveTranscript(
          this.activeSegmentTranscript || transcriptNormalized
        );

        if (this.pendingEndedSegment && this.lastTranscriptSeq > this.pendingEndedSegment.baseTranscriptSeq) {
          this.pendingEndedSegment.accumulatedTranscript = mergeTranscriptText(
            this.pendingEndedSegment.accumulatedTranscript,
            transcriptNormalized
          );
          this.pendingEndedSegment.lastTranscriptAtMs = Date.now();
          this.pendingEndedSegment.finalSeen = this.pendingEndedSegment.finalSeen || transcriptIsFinal;
          if (this.pendingEndedSegment.finalSeen) {
            this.#resolveEndedSegmentTranscript(this.pendingEndedSegment.accumulatedTranscript);
          }
        } else if (!this.vad.speechActive && !this.pendingEndedSegment && this.lateTranscriptFallback) {
          if (Date.now() <= this.lateTranscriptFallback.expiresAtMs) {
            const fallback = this.lateTranscriptFallback;
            this.#clearLateTranscriptFallback();
            this.#finalizeSegmentPrompt(
              fallback.segmentIndex,
              fallback.endedAtMs,
              transcriptNormalized,
              'late_transcript'
            );
          } else {
            this.#clearLateTranscriptFallback();
          }
        }

        this.emit('transcript', {
          text: transcriptNormalized,
          isFinal: transcriptIsFinal,
          speechActive: this.vad.speechActive,
          segmentIndex: this.vad.activeSegment?.segmentIndex || this.pendingEndedSegment?.segmentIndex || null,
        });
        this.#emitTrace('stt_transcript', {
          transcript: transcriptNormalized,
          isFinal: transcriptIsFinal,
          speechActive: this.vad.speechActive,
          segmentIndex:
            this.vad.activeSegment?.segmentIndex || this.pendingEndedSegment?.segmentIndex || null,
        });
      }
    }

    const vadSignalType = extractVadSignalType(response);
    if (vadSignalType === VAD_SIGNALS.START) {
      if (this.bargeIn.inFlight && this.config.pipeline.abortOnStartSpeech) {
        const dropped = this.#markInFlightDropped('speaker_started_again_while_provider_inflight');
        if (dropped) {
          this.emit('metrics', {
            type: 'barge_in',
            requestId: dropped.requestId,
            provider: dropped.provider,
            reason: dropped.reason,
          });
        }
      }

      this.#clearLateTranscriptFallback();

      if (this.pendingEndedSegment) {
        const pendingText = normalizeTranscriptText(
          this.pendingEndedSegment.accumulatedTranscript || this.lastTranscriptText || ''
        );

        if (pendingText) {
          this.#resolveEndedSegmentTranscript(pendingText);
        } else {
          if (this.pendingEndedSegment.timer) {
            clearTimeout(this.pendingEndedSegment.timer);
          }
          this.emit('metrics', {
            type: 'skip_provider',
            reason: 'missing_transcript_before_new_speech',
            segmentIndex: this.pendingEndedSegment.segmentIndex,
          });
          this.pendingEndedSegment = null;
        }
      }

      const started = this.vad.onStart(Date.now(), this.lastTranscriptSeq);
      this.#resetLiveTranscriptStateForSegment(started.segmentIndex);
      this.activeSegmentTranscript = '';

      this.emit('vad', {
        signal: VAD_SIGNALS.START,
        segmentIndex: started.segmentIndex,
        startedAtMs: started.startedAtMs,
      });
      return;
    }

    if (vadSignalType === VAD_SIGNALS.END) {
      const ended = this.vad.onEnd(Date.now(), this.lastTranscriptSeq);
      const segmentTranscript = String(this.activeSegmentTranscript || '').trim();
      this.activeSegmentTranscript = '';

      this.emit('vad', {
        signal: VAD_SIGNALS.END,
        segmentIndex: ended.segmentIndex,
        durationMs: ended.durationMs,
        endedAtMs: ended.endedAtMs,
      });

      this.pendingEndedSegment = {
        segmentIndex: ended.segmentIndex,
        endedAtMs: ended.endedAtMs,
        baseTranscriptSeq: ended.segmentStartTranscriptSeq,
        accumulatedTranscript: normalizeTranscriptText(segmentTranscript),
        lastTranscriptAtMs: segmentTranscript ? Date.now() : null,
        finalSeen: false,
        timer: null,
      };

      if (segmentTranscript) {
        this.#resolveEndedSegmentTranscript(segmentTranscript);
      } else {
        this.#schedulePendingSegmentCheck();
      }
    }
  }
}

module.exports = {
  VoicePipeline,
};
