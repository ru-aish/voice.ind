const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const EventEmitter = require('events');
const { LlmProvider, countTokensApprox } = require('./types');

function resolveCodexBinaryPath() {
  const fromEnv = String(process.env.CODEX_BINARY_PATH || '').trim();
  if (fromEnv) return fromEnv;
  return 'codex';
}

function resolveCodexCwd() {
  const fromEnv = String(process.env.CODEX_CWD || '').trim();
  return fromEnv || process.cwd();
}

function binaryExists(binaryPath) {
  if (!binaryPath || binaryPath.includes('/')) {
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

class CodexClient extends EventEmitter {
  constructor(binaryPath = resolveCodexBinaryPath(), cwd = resolveCodexCwd()) {
    super();
    this.binaryPath = binaryPath;
    this.cwd = cwd;
    this.proc = null;
    this.reqId = 1;
    this.pendingRequests = new Map();
    this.rl = null;
    this.initPromise = null;
    this.startError = null;
  }

  async start() {
    if (this.startError) {
      throw this.startError;
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (!binaryExists(this.binaryPath)) {
        const err = new Error(
          `Codex CLI not found at "${this.binaryPath}". Install codex or set CODEX_BINARY_PATH.`
        );
        this.startError = err;
        throw err;
      }

      await new Promise((resolve, reject) => {
        this.proc = spawn(this.binaryPath, ['app-server'], {
          cwd: this.cwd,
        });

        this.proc.once('error', (spawnErr) => {
          this.proc = null;
          const err = new Error(
            `Failed to start Codex (${this.binaryPath}): ${spawnErr.message}`
          );
          this.startError = err;
          reject(err);
        });

        this.rl = readline.createInterface({
          input: this.proc.stdout,
          terminal: false,
        });

        this.rl.on('line', (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.id !== undefined) {
              const req = this.pendingRequests.get(msg.id);
              if (req) {
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                  req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                  req.resolve(msg.result);
                }
              }
            } else {
              this.emit('notification', msg);
            }
          } catch {
            // ignore parsing issues from CLI debug outputs
          }
        });

        this.proc.stderr.on('data', (data) => {
          console.error(`[Codex Daemon Stderr]: ${data.toString().trim()}`);
        });

        this.proc.on('exit', (code, signal) => {
          console.log(`[Codex Daemon Exit]: code=${code} signal=${signal}`);
          this.emit('exit', { code, signal });
          this.proc = null;
          this.rl = null;
          this.initPromise = null;
        });

        resolve();
      });

      await this.request('initialize', {
        clientInfo: { name: 'voice-ai-codex-provider', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      this.notify('initialized');
    })().catch((err) => {
      this.initPromise = null;
      if (!this.startError) this.startError = err;
      throw err;
    });

    return this.initPromise;
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        return reject(new Error('Codex daemon is not running'));
      }
      const rid = this.reqId++;
      this.pendingRequests.set(rid, { resolve, reject });
      const req = {
        jsonrpc: '2.0',
        id: rid,
        method,
        params,
      };
      this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  notify(method, params = {}) {
    if (!this.proc) return;
    const notif = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.proc.stdin.write(`${JSON.stringify(notif)}\n`);
  }

  close() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.rl = null;
      this.initPromise = null;
    }
  }
}

let globalCodexClient = null;

function getGlobalCodexClient() {
  if (!globalCodexClient) {
    globalCodexClient = new CodexClient();
  }
  return globalCodexClient;
}

class CodexProvider extends LlmProvider {
  constructor(config) {
    super('codex');
    this.config = config;
    this.threadId = null;
    this.cwd = resolveCodexCwd();
  }

  async ensureThread() {
    const client = getGlobalCodexClient();
    await client.start();

    if (!this.threadId) {
      const threadResp = await client.request('thread/start', {
        cwd: this.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        model: this.config.model || 'gpt-5.5',
      });
      this.threadId = threadResp.thread.id;
    }
    return this.threadId;
  }

  async streamText({ prompt, messages, abortSignal, onToken, onFirstToken }) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Prompt is empty');
    }

    const client = getGlobalCodexClient();
    await client.start();

    const metrics = {
      provider: this.name,
      model: this.config.model,
      promptSentAtMs: Date.now(),
      firstTokenAtMs: null,
      firstTokenSource: null,
      tokenCountApprox: 0,
      tpsApprox: null,
      streamCompletedAtMs: null,
      generatedText: '',
      finishReason: null,
      toolCalls: [],
    };

    const throwIfAborted = () => {
      if (abortSignal?.aborted) {
        throw new Error('Turn aborted');
      }
    };

    throwIfAborted();

    const threadId = await this.ensureThread();

    let finalPrompt = prompt;
    if (this.config.systemPrompt) {
      finalPrompt = `${this.config.systemPrompt}\n\nUser: ${prompt}`;
    }

    const turnParams = {
      threadId,
      input: [{ type: 'text', text: finalPrompt }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: this.config.model || 'gpt-5.5',
      effort: this.config.reasoningEffort || 'low',
    };

    const turnResp = await client.request('turn/start', turnParams);
    const turnId = turnResp.turn.id;

    throwIfAborted();

    return new Promise((resolve, reject) => {
      const handleNotification = async (msg) => {
        try {
          const method = msg.method;
          const params = msg.params || {};

          if (params.turnId !== turnId && params.threadId !== threadId) {
            const t = params.turn || {};
            if (t.id !== turnId) return;
          }

          if (abortSignal?.aborted) {
            cleanup();
            reject(new Error('Turn aborted'));
            return;
          }

          if (method === 'item/agentMessage/delta') {
            const tokenText = params.delta || '';
            if (tokenText) {
              if (!metrics.firstTokenAtMs) {
                metrics.firstTokenAtMs = Date.now();
                metrics.firstTokenSource = 'content';
                if (onFirstToken) {
                  await onFirstToken({
                    atMs: metrics.firstTokenAtMs,
                    source: metrics.firstTokenSource,
                    text: tokenText,
                  });
                }
              }

              metrics.generatedText += tokenText;
              metrics.tokenCountApprox += countTokensApprox(tokenText);
              if (onToken) {
                await onToken(tokenText);
              }
            }
          } else if (method === 'turn/completed') {
            cleanup();
            metrics.streamCompletedAtMs = Date.now();
            const durationMs = metrics.streamCompletedAtMs - metrics.promptSentAtMs;
            if (durationMs > 0) {
              metrics.tpsApprox = Number(
                (metrics.tokenCountApprox / (durationMs / 1000)).toFixed(2)
              );
            }
            resolve(metrics);
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        client.off('notification', handleNotification);
        abortSignal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = () => {
        cleanup();
        reject(new Error('Turn aborted'));
      };

      client.on('notification', handleNotification);
      abortSignal?.addEventListener('abort', handleAbort);
    });
  }
}

module.exports = {
  CodexProvider,
  getGlobalCodexClient,
};