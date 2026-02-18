const { LlmProvider, countTokensApprox } = require('./types');

function normalizeGeminiRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'assistant' || normalized === 'model') return 'model';
  return 'user';
}

function toGeminiContents(messages) {
  const contents = [];
  for (const msg of messages) {
    const text = String(msg?.content || '').trim();
    if (!text) continue;
    contents.push({
      role: normalizeGeminiRole(msg.role),
      parts: [{ text }],
    });
  }
  return contents;
}

function toGeminiFunctionDeclarations(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const declarations = [];
  for (const tool of tools) {
    if (!tool || tool.type !== 'function' || !tool.function?.name) continue;
    declarations.push({
      name: tool.function.name,
      description: String(tool.function.description || ''),
      parameters: tool.function.parameters || {
        type: 'object',
        properties: {},
      },
    });
  }
  return declarations;
}

class GeminiProvider extends LlmProvider {
  constructor(config) {
    super('gemini');
    this.config = config;
    if (!config.apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY');
    }
  }

  async streamText({ prompt, messages, abortSignal, onToken, onFirstToken, tools, onToolCall }) {
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

    const finalMessages = Array.isArray(messages) && messages.length > 0 ? messages : [];
    if (finalMessages.length === 0) {
      if (this.config.systemPrompt) {
        finalMessages.push({ role: 'system', content: this.config.systemPrompt });
      }
      finalMessages.push({ role: 'user', content: prompt });
    }

    const systemInstructionText = finalMessages
      .filter((m) => String(m?.role || '').toLowerCase() === 'system')
      .map((m) => String(m?.content || '').trim())
      .filter(Boolean)
      .join('\n\n');

    const chatMessages = finalMessages.filter(
      (m) => String(m?.role || '').toLowerCase() !== 'system'
    );

    if (chatMessages.length === 0) {
      chatMessages.push({ role: 'user', content: prompt });
    }

    const requestPayload = {
      contents: toGeminiContents(chatMessages),
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxCompletionTokens,
        topP: this.config.topP,
      },
    };

    if (systemInstructionText) {
      requestPayload.systemInstruction = {
        parts: [{ text: systemInstructionText }],
      };
    }

    const functionDeclarations = toGeminiFunctionDeclarations(tools);
    if (functionDeclarations.length > 0) {
      requestPayload.tools = [{ functionDeclarations }];
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.config.apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error('Gemini stream response body missing');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallCounter = 0;

    while (true) {
      throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) {
          continue;
        }

        let chunk;
        try {
          chunk = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        const candidate = chunk?.candidates?.[0] || {};
        if (candidate.finishReason) {
          metrics.finishReason = String(candidate.finishReason).toLowerCase();
        }

        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (typeof part?.text === 'string' && part.text) {
            if (!metrics.firstTokenAtMs) {
              metrics.firstTokenAtMs = Date.now();
              metrics.firstTokenSource = 'content';
              if (onFirstToken) {
                await onFirstToken({
                  atMs: metrics.firstTokenAtMs,
                  source: 'content',
                  text: part.text,
                });
              }
            }

            metrics.generatedText += part.text;
            metrics.tokenCountApprox += countTokensApprox(part.text);
            if (onToken) {
              await onToken(part.text);
            }
            continue;
          }

          if (part?.functionCall?.name) {
            if (!metrics.firstTokenAtMs) {
              metrics.firstTokenAtMs = Date.now();
              metrics.firstTokenSource = 'tool_call';
              if (onFirstToken) {
                await onFirstToken({
                  atMs: metrics.firstTokenAtMs,
                  source: 'tool_call',
                  text: '',
                });
              }
            }

            const toolCall = {
              id: `gemini_tool_${++toolCallCounter}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            };
            metrics.toolCalls.push(toolCall);
            if (onToolCall) {
              await onToolCall(toolCall);
            }
          }
        }
      }
    }

    metrics.streamCompletedAtMs = Date.now();
    const durationMs = metrics.streamCompletedAtMs - metrics.promptSentAtMs;
    if (durationMs > 0) {
      metrics.tpsApprox = Number(
        (metrics.tokenCountApprox / (durationMs / 1000)).toFixed(2)
      );
    }

    if (!metrics.generatedText.trim() && metrics.toolCalls.length === 0) {
      throw new Error('Gemini stream produced no assistant text or tool calls');
    }

    return metrics;
  }
}

module.exports = {
  GeminiProvider,
};
