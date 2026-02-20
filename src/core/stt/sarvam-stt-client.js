const { EventEmitter } = require('events');
const { SarvamAIClient } = require('sarvamai');

class SarvamSttClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.connected = false;
    this.firstChunkSentAtMs = null;
    this.firstMessageAtMs = null;
  }

  async connect() {
    if (this.connected && this.socket) return;

    const apiKey = this.config?.apiKey;
    if (!apiKey) {
      throw new Error('Missing SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY');
    }

    const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });

    this.socket = await client.speechToTextStreaming.connect({
      'Api-Subscription-Key': apiKey,
      model: this.config.model,
      'language-code': this.config.languageCode,
      sample_rate: String(this.config.sampleRate),
      input_audio_codec: this.config.inputAudioCodec,
      high_vad_sensitivity: String(this.config.highVadSensitivity),
      vad_signals: String(this.config.vadSignals),
      flush_signal: String(this.config.flushSignal),
    });

    this.socket.on('message', (response) => {
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
      this.emit('message', response);
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('close', (event) => {
      this.connected = false;
      this.emit('close', event);
    });

    await this.socket.waitForOpen();
    this.connected = true;
    this.connectedAtMs = Date.now();
    this.emit('open', { atMs: this.connectedAtMs });
  }

  sendAudioBase64(audioBase64) {
    if (!this.socket || !this.connected) {
      throw new Error('STT socket is not connected');
    }

    this.socket.transcribe({
      audio: audioBase64,
      sample_rate: this.config.sampleRate,
      encoding: this.config.encoding,
    });

    if (!this.firstChunkSentAtMs) {
      this.firstChunkSentAtMs = Date.now();
      this.emit('first_chunk_sent', { atMs: this.firstChunkSentAtMs });
    }
  }

  sendAudioBuffer(audioBuffer) {
    this.sendAudioBase64(Buffer.from(audioBuffer).toString('base64'));
  }

  flush() {
    if (this.socket?.flush) {
      this.socket.flush();
    }
  }

  async close() {
    if (!this.socket) return;

    try {
      if (this.socket.flush) this.socket.flush();
    } catch {}

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.socket.close();
    } catch {}

    this.socket = null;
    this.connected = false;
  }
}

module.exports = {
  SarvamSttClient,
};
