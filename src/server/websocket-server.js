const { WebSocketServer } = require('ws');

const { SessionManager } = require('./session-manager');
const { createLogger } = require('../utils/logger');

class VoiceWebSocketServer {
  constructor(config) {
    this.config = config;
    this.wss = null;
    this.logger = createLogger('voice-ai-server', config.server.logLevel);
    this.sessionManager = new SessionManager(config, this.logger);
    this.heartbeatTimer = null;
  }

  async start() {
    if (!this.config.keys.sarvamApiKey) {
      throw new Error('Missing SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY');
    }

    this.wss = await new Promise((resolve, reject) => {
      const server = new WebSocketServer(
        {
          port: this.config.server.port,
          path: this.config.server.wsPath,
        },
        () => resolve(server)
      );
      server.once('error', reject);
    });

    this.wss.on('connection', async (ws, req) => {
      ws.isAlive = true;
      this.logger.debug('client_connected', { remote: req?.socket?.remoteAddress || 'unknown' });
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      try {
        await this.sessionManager.createSession(ws, req);
      } catch (err) {
        try {
          ws.send(
            JSON.stringify({
              type: 'error',
              data: {
                error: `session_init_failed:${err?.message || err}`,
              },
            })
          );
        } catch {}
        ws.close();
      }
    });

    this.wss.on('error', (err) => {
      // keep process alive; server operators can restart if needed
      this.logger.error(`ws-error ${err?.message || err}`);
    });

    this.#startHeartbeat();
    this.logger.info(
      `listening port=${this.config.server.port} path=${this.config.server.wsPath} log_level=${this.config.server.logLevel}`
    );

    return {
      port: this.config.server.port,
      path: this.config.server.wsPath,
    };
  }

  #startHeartbeat() {
    const intervalMs = Math.max(5000, Number(this.config.server.heartbeatMs || 30000));

    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.logger.debug('heartbeat_timeout_terminate_client');
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, intervalMs);

    this.heartbeatTimer.unref();
  }

  async stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.sessionManager.shutdownAll();
    this.logger.info('all_sessions_shutdown');

    if (!this.wss) return;

    await new Promise((resolve) => {
      this.wss.close(() => resolve());
    });

    this.wss = null;
  }
}

module.exports = {
  VoiceWebSocketServer,
};
