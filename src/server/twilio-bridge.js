function parsePcm16FromBuffer(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = buffer.readInt16LE(i * 2);
  }
  return out;
}

function int16ToBuffer(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    out.writeInt16LE(samples[i], i * 2);
  }
  return out;
}

function resamplePcm16Linear(input, inputRate, outputRate) {
  if (inputRate === outputRate) return Int16Array.from(input);
  if (!input.length) return new Int16Array(0);
  const outputLength = Math.max(1, Math.floor((input.length * outputRate) / inputRate));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const src = (i * inputRate) / outputRate;
    const index = Math.floor(src);
    const frac = src - index;
    const a = input[Math.min(index, input.length - 1)];
    const b = input[Math.min(index + 1, input.length - 1)];
    output[i] = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac)));
  }
  return output;
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function pcm16ToMulawSample(sample) {
  let pcm = sample | 0;
  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; exponent > 0 && (pcm & expMask) === 0; expMask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function mulawToPcm16Sample(muLawByte) {
  const value = (~muLawByte) & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  if (sign) sample = -sample;
  return Math.max(-32768, Math.min(32767, sample));
}

function pcm16ToMulawBuffer(samples) {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = pcm16ToMulawSample(samples[i]);
  }
  return out;
}

function mulawBufferToPcm16(buffer) {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    out[i] = mulawToPcm16Sample(buffer[i]);
  }
  return out;
}

function parseWavChunk(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) break;

    if (chunkId === 'fmt ') {
      if (chunkSize >= 16) {
        channels = buffer.readUInt16LE(chunkStart + 2);
        sampleRate = buffer.readUInt32LE(chunkStart + 4);
        bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      }
    } else if (chunkId === 'data') {
      dataStart = chunkStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (dataStart < 0 || channels !== 1 || bitsPerSample !== 16) {
    return null;
  }

  return {
    sampleRate: sampleRate || 24000,
    pcm: buffer.subarray(dataStart, Math.min(dataStart + dataSize, buffer.length)),
  };
}

function isLikelyTwilioRequestUrl(req) {
  const rawUrl = String(req?.url || '');
  if (!rawUrl) return false;
  const lower = rawUrl.toLowerCase();
  if (lower.includes('twilio=1') || lower.includes('source=twilio') || lower.includes('provider=twilio')) {
    return true;
  }
  return false;
}

class TwilioBridge {
  constructor({ ws, session, logger, sendMetric }) {
    this.ws = ws;
    this.session = session;
    this.logger = logger;
    this.sendMetric = sendMetric;
    this.active = false;
    this.streamSid = null;
    this.currentServerAudioRate = 24000;
  }

  #extractCustomParameters(startPayload = {}) {
    const raw = startPayload?.customParameters ?? startPayload?.custom_parameters;
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const out = {};
      for (const item of raw) {
        const name = String(item?.name || item?.key || '').trim();
        const value = String(item?.value || '').trim();
        if (name) out[name] = value;
      }
      return out;
    }
    if (typeof raw === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        const key = String(k || '').trim();
        if (!key) continue;
        out[key] = String(v ?? '').trim();
      }
      return out;
    }
    return {};
  }

  async #applyStartConfig(startPayload = {}) {
    const params = this.#extractCustomParameters(startPayload);
    const next = {};
    if (params.provider) next.provider = params.provider;
    if (params.language) next.language = params.language;
    if (params.ttsLanguage) next.ttsLanguage = params.ttsLanguage;
    if (params.sttSampleRate) next.sttSampleRate = Number(params.sttSampleRate);
    if (params.ttsSampleRate) next.ttsSampleRate = Number(params.ttsSampleRate);
    if (params.ttsOutputCodec) next.ttsOutputCodec = String(params.ttsOutputCodec).trim();
    if (params.speaker) next.speaker = String(params.speaker).trim();
    if (Object.keys(next).length === 0) return;

    try {
      const applied = await this.session.pipeline.applyConfig(next);
      this.sendMetric({
        type: 'twilio_start_config_applied',
        requested: next,
        applied,
      });
    } catch (err) {
      this.sendMetric({
        type: 'twilio_start_config_error',
        requested: next,
        error: String(err?.message || err),
      });
    }
  }

  enable(reason = 'unknown') {
    if (this.active) return;
    this.active = true;
    this.sendMetric({
      type: 'twilio_bridge_enabled',
      reason,
    });
    this.logger?.info(`twilio_bridge_enabled session=${this.session.id} reason=${reason}`);
  }

  isTwilioFrame(parsed) {
    return Boolean(parsed && typeof parsed === 'object' && parsed.event);
  }

  handleTwilioIncoming(parsed) {
    if (!this.active) this.enable('inbound_twilio_event');

    const event = String(parsed?.event || '').toLowerCase();
    if (!event) return;

    if (event === 'start') {
      this.streamSid = String(parsed?.start?.streamSid || parsed?.streamSid || '').trim() || this.streamSid;
      this.#applyStartConfig(parsed?.start || {}).catch(() => {});
      this.sendMetric({
        type: 'twilio_start',
        streamSid: this.streamSid,
        tracks: parsed?.start?.tracks || null,
      });
      return;
    }

    if (event === 'media') {
      const payload = String(parsed?.media?.payload || '').trim();
      if (!payload) return;
      const ulaw = Buffer.from(payload, 'base64');
      const pcm8 = mulawBufferToPcm16(ulaw);
      const sttSampleRate = Math.max(8000, Number(this.session?.pipeline?.config?.stt?.sampleRate || 16000));
      const pcmAtSttRate = resamplePcm16Linear(pcm8, 8000, sttSampleRate);
      this.session.pipeline.handleAudioChunk(int16ToBuffer(pcmAtSttRate));
      return;
    }

    if (event === 'stop') {
      this.sendMetric({
        type: 'twilio_stop',
        streamSid: this.streamSid || String(parsed?.streamSid || '').trim() || null,
      });
      return;
    }

    if (event === 'mark' || event === 'dtmf' || event === 'connected') {
      this.sendMetric({
        type: `twilio_${event}`,
      });
    }
  }

  sendTwilioAudioFromPipeline(audioBase64) {
    if (!this.active) return;
    const raw = Buffer.from(String(audioBase64 || ''), 'base64');
    if (!raw.length) return;

    let pcmSource = raw;
    let sourceRate = this.currentServerAudioRate;
    const wav = parseWavChunk(raw);
    if (wav) {
      pcmSource = wav.pcm;
      sourceRate = wav.sampleRate;
      this.currentServerAudioRate = sourceRate;
    }

    const pcmSamples = parsePcm16FromBuffer(pcmSource);
    const pcm8 = resamplePcm16Linear(pcmSamples, sourceRate, 8000);
    const ulaw = pcm16ToMulawBuffer(pcm8);

    const out = {
      event: 'media',
      streamSid: this.streamSid || undefined,
      media: {
        payload: ulaw.toString('base64'),
      },
    };

    if (this.ws?.readyState === this.ws?.OPEN) {
      this.ws.send(JSON.stringify(out));
    }
  }
}

module.exports = {
  TwilioBridge,
  isLikelyTwilioRequestUrl,
};
