const { WS_MESSAGE_TYPES } = require('../config/constants');

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createMessageHandler({ session, send }) {
  return async function handleIncoming(message, isBinary = false) {
    try {
      if (isBinary) {
        if (!session.ready) return;
        session.pipeline.handleAudioChunk(message);
        return;
      }

      const parsed = safeJsonParse(message.toString());
      if (!parsed || typeof parsed !== 'object') {
        send(WS_MESSAGE_TYPES.ERROR, {
          error: 'invalid_json_message',
        });
        return;
      }

      const type = String(parsed.type || '').trim();
      const data = parsed.data || {};

      if (!type) {
        send(WS_MESSAGE_TYPES.ERROR, { error: 'missing_message_type' });
        return;
      }

      if (type === WS_MESSAGE_TYPES.AUDIO) {
        const audio = data.audio;
        if (!audio) {
          send(WS_MESSAGE_TYPES.ERROR, { error: 'audio_payload_missing' });
          return;
        }
        if (!session.ready) return;
        session.pipeline.handleAudioChunk(audio);
        return;
      }

      if (type === WS_MESSAGE_TYPES.TEXT) {
        session.pipeline.handleTextInput(data.text || '');
        return;
      }

      if (type === WS_MESSAGE_TYPES.CONFIG) {
        const applied = await session.pipeline.applyConfig(data.config || {});
        send(WS_MESSAGE_TYPES.METRICS, {
          type: 'session_config_updated',
          applied,
        });
        return;
      }

      if (type === WS_MESSAGE_TYPES.ABORT) {
        session.pipeline.abortCurrent('client_abort');
        send(WS_MESSAGE_TYPES.METRICS, {
          type: 'client_abort_received',
        });
        return;
      }

      send(WS_MESSAGE_TYPES.ERROR, {
        error: `unknown_message_type:${type}`,
      });
    } catch (err) {
      send(WS_MESSAGE_TYPES.ERROR, {
        error: `message_handler_error:${err?.message || err}`,
      });
    }
  };
}

module.exports = {
  createMessageHandler,
};
