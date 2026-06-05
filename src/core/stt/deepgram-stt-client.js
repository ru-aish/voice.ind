const { EventEmitter } = require('events');
const WebSocket = require('ws');

const DEFAULT_MODEL = 'nova-3';
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_ENDPOINTING_MS = 300;

function buildListenUrl(config) {
  const params = new URLSearchParams({
    model: config.model || DEFAULT_MODEL,
    encoding: 'linear16',
    sample_rate: String(config.sampleRate || DEFAULT_SAMPLE_RATE),
    channels: '1',
    interim_results: 'true',
    endpointing: String(config.endpointingMs || DEFAULT_ENDPOINTING_MS),
    vad_events: 'true',
  });
  if (config.language) {
    params.set('language', config.language);
  }
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function normalizeDeepgramMessage(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (data.type === 'SpeechStarted' || data.signal === 'START_SPEECH') {
    return { data: { signal_type: 'START_SPEECH', event_type: 'start' } };
  }

  if (data.type === 'SpeechEnded' || data.signal === 'END_SPEECH') {
    return { data: { signal_type: 'END_SPEECH', event_type: 'end' } };
  }

  const transcript = data.channel?.alternatives?.[0]?.transcript || '';

  if (data.type === 'UtteranceEnd') {
    return { data: { signal_type: 'END_SPEECH', event_type: 'utterance_end' } };
  }

  if (!transcript) {
    return { data: { event_type: data.type || 'metadata' } };
  }

  const isFinal = Boolean(data.is_final || data.speech_final);

  return {
    data: {
      transcript,
      is_final: isFinal,
      final: Boolean(data.speech_final),
      speech_final: Boolean(data.speech_final),
      // Nova endpointing: speech_final doubles as end-of-utterance when SpeechEnded is absent
      ...(data.speech_final ? { signal_type: 'END_SPEECH', event_type: 'speech_final' } : {}),
    },
  };
}

class DeepgramSttClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      apiKey: config.apiKey || '',
      model: config.model || process.env.DEEPGRAM_STT_MODEL || DEFAULT_MODEL,
      sampleRate: Number(config.sampleRate || process.env.SARVAM_STT_SAMPLE_RATE || DEFAULT_SAMPLE_RATE),
      endpointingMs: Number(config.endpointingMs || process.env.DEEPGRAM_ENDPOINTING_MS || DEFAULT_ENDPOINTING_MS),
      language: config.language || process.env.DEEPGRAM_STT_LANGUAGE || 'en',
    };
    this.ws = null;
    this.connected = false;
    this.firstChunkSentAtMs = null;
    this.firstMessageAtMs = null;
    this.connectedAtMs = null;
    this.wavHeaderStripped = false;
  }

  #toPcm(buffer) {
    let buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (!this.wavHeaderStripped && buf.length >= 44 && buf.slice(0, 4).toString('ascii') === 'RIFF') {
      buf = buf.slice(44);
      this.wavHeaderStripped = true;
    }
    return buf;
  }

  async connect() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    if (!this.config.apiKey) {
      throw new Error('Missing DEEPGRAM_API_KEY');
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
      this.connected = false;
    }

    this.ws = new WebSocket(buildListenUrl(this.config), {
      headers: { Authorization: `Token ${this.config.apiKey}` },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deepgram STT connect timeout')), 15000);
      this.ws.once('open', () => {
        clearTimeout(timer);
        this.connected = true;
        this.connectedAtMs = Date.now();
        this.emit('open', { atMs: this.connectedAtMs });
        resolve();
      });
      this.ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    this.ws.on('message', (raw) => {
      if (!this.firstMessageAtMs) {
        this.firstMessageAtMs = Date.now();
        this.emit('first_message', {
          atMs: this.firstMessageAtMs,
          requestToFirstMessageMs: this.firstMessageAtMs - this.connectedAtMs,
          firstChunkToFirstMessageMs: this.firstChunkSentAtMs
            ? this.firstMessageAtMs - this.firstChunkSentAtMs
            : null,
        });
      }

      try {
        const parsed = JSON.parse(raw.toString());
        this.emit('message', normalizeDeepgramMessage(parsed));
      } catch (err) {
        this.emit('error', err);
      }
    });

    this.ws.on('error', (err) => this.emit('error', err));
    this.ws.on('close', (code, reason) => {
      this.connected = false;
      this.emit('close', { code, reason: reason?.toString?.() || '' });
    });
  }

  #sendPcm(buffer) {
    if (!this.ws || !this.connected || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('STT socket is not connected');
    }
    const pcm = this.#toPcm(buffer);
    if (!pcm.length) return;
    this.ws.send(pcm);
    if (!this.firstChunkSentAtMs) {
      this.firstChunkSentAtMs = Date.now();
      this.emit('first_chunk_sent', { atMs: this.firstChunkSentAtMs });
    }
  }

  sendAudioBuffer(audioBuffer) {
    const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
    this.#sendPcm(buf);
  }

  sendAudioBase64(audioBase64) {
    this.#sendPcm(Buffer.from(audioBase64, 'base64'));
  }

  flush() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {}
    }
  }

  async close() {
    if (!this.ws) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      this.ws.close();
    } catch {}
    this.ws = null;
    this.connected = false;
    this.firstChunkSentAtMs = null;
    this.firstMessageAtMs = null;
    this.wavHeaderStripped = false;
  }
}

module.exports = {
  DeepgramSttClient,
  buildListenUrl,
  normalizeDeepgramMessage,
  DEFAULT_MODEL,
};