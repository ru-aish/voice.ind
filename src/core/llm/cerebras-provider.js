const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const { LlmProvider, countTokensApprox, isReasoningModel } = require('./types');

function extractDeltaText(chunk, allowReasoningFallback) {
  const choice = chunk?.choices?.[0];
  const delta = choice?.delta || {};

  const content = typeof delta.content === 'string' ? delta.content : '';
  const reasoning = typeof delta.reasoning === 'string' ? delta.reasoning : '';

  if (content) {
    return { text: content, source: 'content', finishReason: choice?.finish_reason ?? null };
  }
  if (allowReasoningFallback && reasoning) {
    return { text: reasoning, source: 'reasoning', finishReason: choice?.finish_reason ?? null };
  }
  return { text: '', source: null, finishReason: choice?.finish_reason ?? null };
}

class CerebrasProvider extends LlmProvider {
  constructor(config) {
    super('cerebras');
    this.config = config;
    if (!config.apiKey) {
      throw new Error('Missing CEREBRAS_API_KEY');
    }
    this.client = new Cerebras({ apiKey: config.apiKey });
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

    const requestPayload = {
      model: this.config.model,
      messages: finalMessages,
      temperature: this.config.temperature,
      max_completion_tokens: this.config.maxCompletionTokens,
      top_p: this.config.topP,
      stream: true,
      stop: this.config.stop,
    };

    if (isReasoningModel(this.config.model)) {
      requestPayload.reasoning_effort = this.config.reasoningEffort;
    }

    const stream = await this.client.chat.completions.create(requestPayload);

    for await (const chunk of stream) {
      throwIfAborted();
      const choice = chunk?.choices?.[0];
      if (choice?.finish_reason) {
        metrics.finishReason = choice.finish_reason;
      }
      const extracted = extractDeltaText(chunk, this.config.allowReasoningFallback);
      const tokenText = extracted.text;
      if (!tokenText) continue;

      if (!metrics.firstTokenAtMs) {
        metrics.firstTokenAtMs = Date.now();
        metrics.firstTokenSource = extracted.source;
        if (onFirstToken) {
          await onFirstToken({
            atMs: metrics.firstTokenAtMs,
            source: extracted.source,
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

    metrics.streamCompletedAtMs = Date.now();
    const durationMs = metrics.streamCompletedAtMs - metrics.promptSentAtMs;
    if (durationMs > 0) {
      metrics.tpsApprox = Number(
        (metrics.tokenCountApprox / (durationMs / 1000)).toFixed(2)
      );
    }

    if (!metrics.generatedText.trim()) {
      throw new Error('Cerebras stream produced no assistant text');
    }

    return metrics;
  }
}

module.exports = {
  CerebrasProvider,
};
