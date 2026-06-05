const { EventEmitter } = require('events');
const WebSocket = require('ws');

const DEFAULT_MODEL = 'aura-2-asteria-en';
const DEFAULT_ENCODING = 'linear16';
const DEFAULT_SAMPLE_RATE = 16000;
const WARMUP_TEXT = 'ok';

function buildWsUrl({ model, encoding, sampleRate }) {
  const params = new URLSearchParams({
    model: model || DEFAULT_MODEL,
    encoding: encoding || DEFAULT_ENCODING,
    sample_rate: String(sampleRate || DEFAULT_SAMPLE_RATE),
  });
  return `wss://api.deepgram.com/v1/speak?${params.toString()}`;
}

function isBinaryAudio(data) {
  return Buffer.isBuffer(data) && data.length > 0;
}

function parseJsonMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

/**
 * Persistent Deepgram streaming TTS WebSocket.
 * Call connect() once, warmup() once (unmeasured), then speak() for measured TTFT.
 */
class DeepgramTtsClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      apiKey: config.apiKey || '',
      model: config.model || process.env.DEEPGRAM_TTS_MODEL || DEFAULT_MODEL,
      encoding: config.encoding || process.env.DEEPGRAM_TTS_ENCODING || DEFAULT_ENCODING,
      sampleRate: Number(config.sampleRate || process.env.DEEPGRAM_TTS_SAMPLE_RATE || DEFAULT_SAMPLE_RATE),
      idleCompleteMs: Number(config.idleCompleteMs || process.env.DEEPGRAM_TTS_IDLE_MS || 120),
    };
    this.ws = null;
    this.connected = false;
    this.warmed = false;
    this.pending = null;
    this.aborted = false;
  }

  get wsUrl() {
    return buildWsUrl(this.config);
  }

  async #runWarmup() {
    if (this.warmed) return;
    await this.#runSpeak(WARMUP_TEXT, { measure: false });
    this.warmed = true;
  }

  async connect() {
    if (this.aborted) {
      throw new Error('TTS session aborted');
    }

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      await this.#runWarmup();
      return;
    }

    if (!this.config.apiKey) {
      throw new Error('Missing DEEPGRAM_API_KEY');
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
      this.connected = false;
      this.warmed = false;
    }

    this.ws = new WebSocket(this.wsUrl, {
      headers: { Authorization: `Token ${this.config.apiKey}` },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deepgram TTS connect timeout')), 15000);
      this.ws.once('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });
      this.ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    this.ws.on('message', (data) => this.#onMessage(data));
    this.ws.on('close', () => {
      this.connected = false;
      this.warmed = false;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.reject(new Error('Deepgram TTS socket closed'));
      }
    });
    this.ws.on('error', (err) => this.emit('error', err));

    await this.#runWarmup();
  }

  #finishPending() {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    if (p.idleTimer) clearTimeout(p.idleTimer);
    const completedAtMs = Date.now();
    p.resolve({
      sentAtMs: p.sentAtMs,
      firstAudioAtMs: p.firstChunkAt || null,
      completedAtMs,
      sendToFirstAudioMs:
        p.sentAtMs && p.firstChunkAt ? p.firstChunkAt - p.sentAtMs : null,
      totalTtsMs: completedAtMs - p.sentAtMs,
      audioChunkCount: p.audioChunkCount,
      audioBytes: p.audioBytes,
      audioChunks: p.audioChunks,
      firstChunkLatencyMs:
        p.firstChunkAt != null && p.textSentAt != null ? p.firstChunkAt - p.textSentAt : null,
      totalMs: completedAtMs - p.startedAt,
    });
  }

  #scheduleIdleComplete() {
    if (!this.pending) return;
    if (this.pending.idleTimer) clearTimeout(this.pending.idleTimer);
    this.pending.idleTimer = setTimeout(() => this.#finishPending(), this.config.idleCompleteMs);
  }

  #onMessage(data) {
    if (!this.pending) return;

    if (isBinaryAudio(data)) {
      if (this.pending.firstChunkAt === null) {
        this.pending.firstChunkAt = Date.now();
      }
      this.pending.audioChunks.push(data);
      this.pending.audioChunkCount += 1;
      this.pending.audioBytes += data.length;

      if (this.pending.onAudioChunk) {
        const atMs = Date.now();
        const payload = {
          base64: data.toString('base64'),
          chunk: data,
          atMs,
        };
        this.emit('audio', payload);
        this.pending.onAudioChunk(payload);
      }
      this.#scheduleIdleComplete();
      return;
    }

    const msg = parseJsonMessage(data);
    if (!msg) return;

    if (msg.type === 'Flushed' || msg.type === 'Cleared') {
      this.#finishPending();
    } else if (msg.type === 'Warning') {
      const p = this.pending;
      this.pending = null;
      if (p.idleTimer) clearTimeout(p.idleTimer);
      p.reject(new Error(msg.description || msg.code || 'Deepgram TTS warning'));
    }
  }

  #sendSpeakFlush(text) {
    this.ws.send(JSON.stringify({ type: 'Speak', text }));
    this.ws.send(JSON.stringify({ type: 'Flush' }));
  }

  #runSpeak(text, options = {}) {
    const { measure = true } = options;
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Deepgram TTS not connected'));
    }
    if (this.pending) {
      return Promise.reject(new Error('Deepgram TTS request already in flight'));
    }

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const textSentAt = Date.now();
      const sentAtMs = Date.now();
      this.pending = {
        measure,
        startedAt: sentAtMs,
        sentAtMs,
        textSentAt: sentAtMs,
        firstChunkAt: null,
        audioChunks: [],
        audioChunkCount: 0,
        audioBytes: 0,
        onAudioChunk: options.onAudioChunk || null,
        resolve,
        reject,
      };
      this.#sendSpeakFlush(text);

      const timer = setTimeout(() => {
        if (!this.pending) return;
        const p = this.pending;
        this.pending = null;
        p.reject(new Error('Deepgram TTS speak timeout'));
      }, 30000);

      const originalResolve = resolve;
      const originalReject = reject;
      this.pending.resolve = (result) => {
        clearTimeout(timer);
        originalResolve(result);
      };
      this.pending.reject = (err) => {
        clearTimeout(timer);
        originalReject(err);
      };
    });
  }

  /** Unmeasured startup warmup on an open socket. */
  async warmup() {
    if (!this.connected) await this.connect();
    else await this.#runWarmup();
  }

  async speakText(text, options = {}) {
    if (this.aborted) {
      throw new Error('TTS session aborted');
    }

    const content = String(text || '').trim();
    if (!content) {
      const nowMs = Date.now();
      return {
        sentAtMs: nowMs,
        firstAudioAtMs: null,
        completedAtMs: nowMs,
        sendToFirstAudioMs: null,
        totalTtsMs: 0,
        audioChunkCount: 0,
        audioBytes: 0,
        audioChunks: [],
      };
    }

    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    return this.#runSpeak(content, {
      measure: true,
      onAudioChunk: options.onAudioChunk,
    });
  }

  /** @deprecated use speakText */
  async speak(text, options = {}) {
    return this.speakText(text, options);
  }

  abort(reason = 'TTS aborted') {
    this.aborted = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      if (p.idleTimer) clearTimeout(p.idleTimer);
      p.reject(new Error(reason));
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.connected = false;
    this.warmed = false;
  }

  async close() {
    this.aborted = false;
    this.warmed = false;
    this.connected = false;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'Close' }));
        }
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

module.exports = {
  DeepgramTtsClient,
  buildWsUrl,
  DEFAULT_MODEL,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
};