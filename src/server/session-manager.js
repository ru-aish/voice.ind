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
      startedAtMs: Date.now(),
      ready: false,
    };

    this.sessions.set(sessionId, session);
    this.logger?.info(`session_created id=${sessionId}`);

    pipeline.on('ready', (payload) => {
      session.ready = true;
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
    });

    pipeline.on('error', (payload) => {
      send(WS_MESSAGE_TYPES.ERROR, {
        error: payload?.error || 'unknown_pipeline_error',
      });
    });

    const handleIncoming = createMessageHandler({ session, send });

    ws.on('message', (message, isBinary) => {
      handleIncoming(message, isBinary).catch((err) => {
        send(WS_MESSAGE_TYPES.ERROR, {
          error: `incoming_message_failed:${err?.message || err}`,
        });
      });
    });

    ws.on('close', async () => {
      this.logger?.debug(`session_ws_closed id=${sessionId}`);
      await this.destroySession(sessionId);
    });

    ws.on('error', async () => {
      this.logger?.warn(`session_ws_error id=${sessionId}`);
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
