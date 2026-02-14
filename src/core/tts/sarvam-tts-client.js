const { EventEmitter } = require('events');
const WebSocket = require('ws');

class SarvamTtsClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ws = null;
    this.connected = false;
    this.pending = null;
    this.aborted = false;
  }

  async connect() {
    if (this.connected && this.ws) return;

    if (!this.config.apiKey) {
      throw new Error('Missing SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY');
    }

    this.ws = new WebSocket(this.config.wsUrl, [
      `api-subscription-key.${this.config.apiKey}`,
    ]);

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.connected = true;
        const configData = {
          speaker: this.config.speaker,
          target_language_code: this.config.languageCode,
          pace: this.config.pace,
          min_buffer_size: this.config.minBufferSize,
          max_chunk_length: this.config.maxChunkLength,
          output_audio_codec: this.config.outputCodec,
        };
        if (this.config.sampleRate) {
          configData.speech_sample_rate = String(this.config.sampleRate);
        }
        this.ws.send(
          JSON.stringify({
            type: 'config',
            data: configData,
          })
        );
        resolve();
      };

      this.ws.once('open', onOpen);
      this.ws.once('error', reject);
    });

    this.ws.on('message', (raw) => this.#handleMessage(raw));
    this.ws.on('error', (err) => {
      this.emit('error', err);
      if (this.pending && !this.pending.done) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(err);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (this.pending && !this.pending.done) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error('TTS socket closed before completion event'));
      }
    });
  }

  #handleMessage(raw) {
    if (this.aborted || !this.pending) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'audio' && msg.data?.audio) {
      const chunk = Buffer.from(msg.data.audio, 'base64');
      this.pending.audioChunks.push(chunk);
      this.pending.audioChunkCount += 1;
      this.pending.audioBytes += chunk.length;

      if (!this.pending.firstAudioAtMs) {
        this.pending.firstAudioAtMs = Date.now();
      }

      const payload = {
        base64: msg.data.audio,
        chunk,
        atMs: Date.now(),
      };
      this.emit('audio', payload);
      if (this.pending.onAudioChunk) {
        this.pending.onAudioChunk(payload);
      }
      return;
    }

    if (msg.type === 'event' && msg.data?.event_type === 'final') {
      if (this.pending.done) return;
      const pending = this.pending;
      this.pending = null;
      pending.done = true;
      const completedAtMs = Date.now();

      pending.resolve({
        sentAtMs: pending.sentAtMs,
        firstAudioAtMs: pending.firstAudioAtMs || null,
        completedAtMs,
        sendToFirstAudioMs:
          pending.sentAtMs && pending.firstAudioAtMs
            ? pending.firstAudioAtMs - pending.sentAtMs
            : null,
        totalTtsMs: completedAtMs - pending.sentAtMs,
        audioChunkCount: pending.audioChunkCount,
        audioBytes: pending.audioBytes,
        audioChunks: pending.audioChunks,
      });
      return;
    }

    if (msg.type === 'error') {
      if (this.pending && !this.pending.done) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error(`TTS error: ${JSON.stringify(msg.data)}`));
      }
    }
  }

  async speakText(text, options = {}) {
    if (this.aborted) {
      throw new Error('TTS session aborted');
    }

    if (!this.connected || !this.ws) {
      await this.connect();
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

    if (this.pending) {
      throw new Error('Previous TTS request still in progress');
    }

    return new Promise((resolve, reject) => {
      this.pending = {
        done: false,
        resolve,
        reject,
        sentAtMs: Date.now(),
        firstAudioAtMs: null,
        audioChunkCount: 0,
        audioBytes: 0,
        audioChunks: [],
        onAudioChunk: options.onAudioChunk,
      };

      this.ws.send(JSON.stringify({ type: 'text', data: { text: content } }));
      setTimeout(() => {
        if (this.ws && this.connected) {
          this.ws.send(JSON.stringify({ type: 'flush' }));
        }
      }, Math.max(0, Number(this.config.flushDelayMs || 0)));
    });
  }

  abort(reason = 'TTS aborted') {
    this.aborted = true;
    if (this.pending && !this.pending.done) {
      const pending = this.pending;
      this.pending = null;
      pending.reject(new Error(reason));
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.connected = false;
    this.ws = null;
  }

  async close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.connected = false;
    this.ws = null;
    this.pending = null;
  }
}

module.exports = {
  SarvamTtsClient,
};
