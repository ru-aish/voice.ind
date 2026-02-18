const { randomUUID } = require('crypto');

const { VoicePipeline } = require('../core/pipeline/voice-pipeline');
const { createMessageHandler } = require('./message-handler');
const { WS_MESSAGE_TYPES } = require('../config/constants');

class SessionManager {
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger;
    this.sessions = new Map();
  }

  async createSession(ws) {
    const sessionId = randomUUID();
    const sessionStartedAtMs = Date.now();
    let inboundMessages = 0;
    let inboundBinaryMessages = 0;
    let inboundTextMessages = 0;
    let inboundBinaryBytes = 0;
    let lastInboundType = 'none';

    const send = (type, data) => {
      if (!ws || ws.readyState !== ws.OPEN) return;
      ws.send(
        JSON.stringify({
          type,
          data,
        })
      );
    };

    const pipeline = new VoicePipeline({
      sessionId,
      config: this.config,
    });

    const session = {
      id: sessionId,
      ws,
      pipeline,
      startedAtMs: sessionStartedAtMs,
      ready: false,
    };

    this.sessions.set(sessionId, session);
    this.logger?.info(`session_created id=${sessionId}`);

    pipeline.on('ready', (payload) => {
      session.ready = true;
      this.logger?.info(`session_ready id=${sessionId} provider=${payload?.provider || 'unknown'} stt_connected=${payload?.sttConnected === true}`);
      send(WS_MESSAGE_TYPES.READY, payload);
    });

    pipeline.on('transcript', (payload) => {
      send(WS_MESSAGE_TYPES.TRANSCRIPT, {
        transcript: payload.text,
        isFinal: payload.isFinal,
        segmentIndex: payload.segmentIndex,
        speechActive: payload.speechActive,
      });
    });

    pipeline.on('vad', (payload) => {
      send(WS_MESSAGE_TYPES.VAD, {
        vadSignal: payload.signal,
        segmentIndex: payload.segmentIndex,
        durationMs: payload.durationMs,
        startedAtMs: payload.startedAtMs,
        endedAtMs: payload.endedAtMs,
      });
    });

    pipeline.on('audio', (payload) => {
      send(WS_MESSAGE_TYPES.AUDIO, {
        requestId: payload.requestId,
        provider: payload.provider,
        segmentIndex: payload.segmentIndex,
        audio: payload.audioBase64,
        atMs: payload.atMs,
        atIso: payload.atIso,
      });
    });

    pipeline.on('metrics', (payload) => {
      send(WS_MESSAGE_TYPES.METRICS, payload);
      const metricType = String(payload?.type || '');
      const shouldLogDetailed =
        metricType.startsWith('trace_') ||
        metricType === 'provider_dispatch' ||
        metricType === 'provider_result' ||
        metricType === 'stt_first_chunk_sent' ||
        metricType === 'stt_first_message_latency' ||
        metricType === 'stt_socket_open' ||
        metricType === 'stt_socket_closed';
      if (shouldLogDetailed && this.logger?.level === 'debug') {
        this.logger.debug(`session_metric id=${sessionId} type=${metricType}`, payload);
      }
    });

    pipeline.on('error', (payload) => {
      this.logger?.warn(`session_pipeline_error id=${sessionId} error=${payload?.error || 'unknown_pipeline_error'}`);
      send(WS_MESSAGE_TYPES.ERROR, {
        error: payload?.error || 'unknown_pipeline_error',
      });
    });

    const handleIncoming = createMessageHandler({ session, send });

    ws.on('message', (message, isBinary) => {
      inboundMessages += 1;
      if (isBinary) {
        inboundBinaryMessages += 1;
        const size = Number(message?.byteLength ?? message?.length ?? 0);
        if (Number.isFinite(size) && size > 0) inboundBinaryBytes += size;
        lastInboundType = 'binary';
      } else {
        inboundTextMessages += 1;
        try {
          const raw = message?.toString?.() || '';
          const parsed = JSON.parse(raw);
          lastInboundType = String(parsed?.type || 'text_unknown');
        } catch {
          lastInboundType = 'text_invalid_json';
        }
      }
      handleIncoming(message, isBinary).catch((err) => {
        send(WS_MESSAGE_TYPES.ERROR, {
          error: `incoming_message_failed:${err?.message || err}`,
        });
      });
    });

    ws.on('close', async (code, reason) => {
      this.logger?.info(
        `session_ws_closed id=${sessionId} code=${code ?? 'n/a'} reason=${reason?.toString?.() || ''} ready=${session.ready} duration_ms=${Math.max(0, Date.now() - sessionStartedAtMs)} inbound_total=${inboundMessages} inbound_binary=${inboundBinaryMessages} inbound_text=${inboundTextMessages} inbound_binary_bytes=${inboundBinaryBytes} last_inbound_type=${lastInboundType}`
      );
      await this.destroySession(sessionId);
    });

    ws.on('error', async (err) => {
      this.logger?.warn(`session_ws_error id=${sessionId} message=${err?.message || err}`);
      await this.destroySession(sessionId);
    });

    await pipeline.start();
    return session;
  }

  async destroySession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    this.logger?.info(`session_destroyed id=${sessionId}`);

    try {
      await session.pipeline.stop();
    } catch {}
  }

  async shutdownAll() {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.destroySession(sessionId);
    }
  }
}

module.exports = {
  SessionManager,
};
