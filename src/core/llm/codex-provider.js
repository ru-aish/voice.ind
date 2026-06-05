const { spawn } = require('child_process');
const readline = require('readline');
const EventEmitter = require('events');
const { LlmProvider, countTokensApprox } = require('./types');

class CodexClient extends EventEmitter {
  constructor(binaryPath = '/home/coder/.local/bin/codex', cwd = '/home/coder/Code/playground') {
    super();
    this.binaryPath = binaryPath;
    this.cwd = cwd;
    this.proc = null;
    this.reqId = 1;
    this.pendingRequests = new Map();
    this.rl = null;
    this.initPromise = null;
  }

  async start() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.proc = spawn(this.binaryPath, ['app-server'], {
        cwd: this.cwd
      });

      this.rl = readline.createInterface({
        input: this.proc.stdout,
        terminal: false
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
        } catch (err) {
          // ignore parsing issues from CLI debug outputs
        }
      });

      this.proc.on('error', (err) => {
        this.emit('error', err);
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

      // Perform handshake
      await this.request('initialize', {
        clientInfo: { name: 'voice-ai-codex-provider', version: '1.0.0' },
        capabilities: { experimentalApi: true }
      });
      this.notify('initialized');
    })();

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
        params
      };
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  notify(method, params = {}) {
    if (!this.proc) return;
    const notif = {
      jsonrpc: '2.0',
      method,
      params
    };
    this.proc.stdin.write(JSON.stringify(notif) + '\n');
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

// Instantiate global preloaded Codex client
const globalCodexClient = new CodexClient();

// Proactively launch Codex app-server on module load to preload it
globalCodexClient.start().catch((err) => {
  console.error('[Codex Preload Error]:', err);
});

class CodexProvider extends LlmProvider {
  constructor(config) {
    super('codex');
    this.config = config;
    this.threadId = null;
  }

  async ensureThread() {
    if (!this.threadId) {
      const threadResp = await globalCodexClient.request('thread/start', {
        cwd: '/home/coder/Code/playground',
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        model: this.config.model || 'gpt-5.5'
      });
      this.threadId = threadResp.thread.id;
    }
    return this.threadId;
  }

  async streamText({ prompt, messages, abortSignal, onToken, onFirstToken }) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Prompt is empty');
    }

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

    // 1. Ensure thread exists
    const threadId = await this.ensureThread();

    // 2. Format final prompt with system prompt if configured
    let finalPrompt = prompt;
    if (this.config.systemPrompt) {
      finalPrompt = `${this.config.systemPrompt}\n\nUser: ${prompt}`;
    }

    const turnParams = {
      threadId: threadId,
      input: [{ type: 'text', text: finalPrompt }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: this.config.model || 'gpt-5.5',
      effort: this.config.reasoningEffort || 'low'
    };

    const turnResp = await globalCodexClient.request('turn/start', turnParams);
    const turnId = turnResp.turn.id;

    throwIfAborted();

    // 3. Listen to streaming notifications from daemon
    return new Promise((resolve, reject) => {
      const handleNotification = async (msg) => {
        try {
          const method = msg.method;
          const params = msg.params || {};

          // Filter messages belonging to this turn
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
        globalCodexClient.off('notification', handleNotification);
        abortSignal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = () => {
        cleanup();
        reject(new Error('Turn aborted'));
      };

      globalCodexClient.on('notification', handleNotification);
      abortSignal?.addEventListener('abort', handleAbort);
    });
  }
}

module.exports = {
  CodexProvider,
  globalCodexClient
};
