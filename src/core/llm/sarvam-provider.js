const { LlmProvider, countTokensApprox } = require('./types');
const { accumulateToolCallDelta, flushAccumulatedToolCalls } = require('./tool-call-accumulator');

class SarvamProvider extends LlmProvider {
  constructor(config) {
    super('sarvam');
    this.config = config;
    if (!config.apiKey) {
      throw new Error('Missing SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY');
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

    const accumulatedToolCalls = new Map();

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

    let model = String(this.config.model || '').trim() || 'sarvam-m';
    let aliasReasoningEffort = null;
    if (model.includes(':')) {
      const [base, alias] = model.split(':', 2);
      if (base) model = base;
      const normalizedAlias = String(alias || '').trim().toLowerCase();
      if (normalizedAlias === 'low' || normalizedAlias === 'high' || normalizedAlias === 'medium') {
        aliasReasoningEffort = normalizedAlias;
      }
    }

    const requestPayload = {
      model,
      messages: finalMessages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxCompletionTokens,
      top_p: this.config.topP,
      stream: true,
      stop: this.config.stop,
    };

    const reasoningEffort = this.config.reasoningEffort || aliasReasoningEffort;
    if (reasoningEffort) {
      requestPayload.reasoning_effort = reasoningEffort;
    }
    if (tools && tools.length > 0) {
      requestPayload.tools = tools;
    }

    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': this.config.apiKey,
      },
      body: JSON.stringify(requestPayload),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Sarvam HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error('Sarvam stream response body missing');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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

        const choice = chunk?.choices?.[0] || {};
        if (choice.finish_reason) {
          metrics.finishReason = choice.finish_reason;
        }

        const delta = choice?.delta || {};
        const tokenText = typeof delta.content === 'string' ? delta.content : '';

        if (!metrics.firstTokenAtMs && (tokenText || delta.tool_calls)) {
          metrics.firstTokenAtMs = Date.now();
          metrics.firstTokenSource = tokenText ? 'content' : 'tool_call';
          if (onFirstToken) {
            await onFirstToken({
              atMs: metrics.firstTokenAtMs,
              source: metrics.firstTokenSource,
              text: tokenText || '',
            });
          }
        }

        if (tokenText) {
          metrics.generatedText += tokenText;
          metrics.tokenCountApprox += countTokensApprox(tokenText);
          if (onToken) {
            await onToken(tokenText);
          }
        }

        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            accumulateToolCallDelta(accumulatedToolCalls, toolCallDelta);
          }
        }
      }
    }

    await flushAccumulatedToolCalls(accumulatedToolCalls, metrics, onToolCall);

    metrics.streamCompletedAtMs = Date.now();
    const durationMs = metrics.streamCompletedAtMs - metrics.promptSentAtMs;
    if (durationMs > 0) {
      metrics.tpsApprox = Number(
        (metrics.tokenCountApprox / (durationMs / 1000)).toFixed(2)
      );
    }

    if (!metrics.generatedText.trim() && metrics.toolCalls.length === 0) {
      throw new Error('Sarvam stream produced no assistant text or tool calls');
    }

    return metrics;
  }
}

module.exports = {
  SarvamProvider,
};
