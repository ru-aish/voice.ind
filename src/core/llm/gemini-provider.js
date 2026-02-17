const { LlmProvider, countTokensApprox } = require('./types');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function normalizeRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'assistant' || raw === 'model') return 'model';
  return 'user';
}

function toGeminiPayload({ prompt, messages, systemPrompt, config }) {
  const candidateMessages = Array.isArray(messages) && messages.length > 0
    ? messages
    : [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: String(prompt || '') },
      ];

  const systemParts = [];
  const turns = [];
  for (const msg of candidateMessages) {
    const role = String(msg?.role || '').trim().toLowerCase();
    const content = String(msg?.content || '').trim();
    if (!content) continue;
    if (role === 'system') {
      systemParts.push(content);
      continue;
    }
    turns.push({
      role: normalizeRole(role),
      text: content,
    });
  }

  if (turns.length === 0) {
    turns.push({ role: 'user', text: String(prompt || '').trim() });
  }

  const normalizedTurns = [];
  for (const turn of turns) {
    if (!turn.text) continue;
    const last = normalizedTurns[normalizedTurns.length - 1];
    if (last && last.role === turn.role) {
      last.text = `${last.text}\n${turn.text}`.trim();
      continue;
    }
    normalizedTurns.push(turn);
  }

  while (normalizedTurns.length > 0 && normalizedTurns[0].role !== 'user') {
    normalizedTurns.shift();
  }
  if (normalizedTurns.length === 0) {
    normalizedTurns.push({ role: 'user', text: String(prompt || '').trim() || 'Hello' });
  }

  const payload = {
    contents: normalizedTurns.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    generationConfig: {
      temperature: config.temperature,
      topP: config.topP,
      maxOutputTokens: config.maxCompletionTokens,
    },
  };

  if (Array.isArray(config.stop)) {
    payload.generationConfig.stopSequences = config.stop;
  } else if (typeof config.stop === 'string' && config.stop.trim()) {
    payload.generationConfig.stopSequences = [config.stop.trim()];
  }

  const joinedSystem = systemParts.join('\n\n').trim();
  if (joinedSystem) {
    payload.systemInstruction = {
      parts: [{ text: joinedSystem }],
    };
  }

  return payload;
}

function extractTextFromResponse(responseJson) {
  const parts = responseJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

class GeminiProvider extends LlmProvider {
  constructor(config) {
    super('gemini');
    this.config = config;
    if (!config.apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY');
    }
  }

  async streamText({ prompt, messages, abortSignal, onToken, onFirstToken }) {
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!hasMessages && (!prompt || !String(prompt).trim())) {
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

    const body = toGeminiPayload({
      prompt,
      messages,
      systemPrompt: this.config.systemPrompt,
      config: this.config,
    });

    const endpoint =
      `${GEMINI_API_BASE}/${encodeURIComponent(this.config.model)}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(this.config.apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Gemini stream is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let cumulativeText = '';

    while (true) {
      if (abortSignal?.aborted) {
        throw new Error('Turn aborted');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const currentText = extractTextFromResponse(parsed);
        const finishReason = parsed?.candidates?.[0]?.finishReason;
        if (finishReason) {
          metrics.finishReason = String(finishReason).toLowerCase();
        }

        if (!currentText) continue;

        let delta = currentText;
        if (currentText.startsWith(cumulativeText)) {
          delta = currentText.slice(cumulativeText.length);
        } else if (cumulativeText.startsWith(currentText)) {
          delta = '';
        }
        cumulativeText = currentText;

        if (!delta) continue;

        if (!metrics.firstTokenAtMs) {
          metrics.firstTokenAtMs = Date.now();
          metrics.firstTokenSource = 'content';
          if (onFirstToken) {
            await onFirstToken({
              atMs: metrics.firstTokenAtMs,
              source: 'content',
              text: delta,
            });
          }
        }

        metrics.generatedText += delta;
        metrics.tokenCountApprox += countTokensApprox(delta);
        if (onToken) {
          await onToken(delta);
        }
      }
    }

    metrics.streamCompletedAtMs = Date.now();
    const durationMs = metrics.streamCompletedAtMs - metrics.promptSentAtMs;
    if (durationMs > 0) {
      metrics.tpsApprox = Number((metrics.tokenCountApprox / (durationMs / 1000)).toFixed(2));
    }

    if (!metrics.generatedText.trim()) {
      throw new Error('Gemini stream produced no assistant text');
    }

    return metrics;
  }
}

module.exports = {
  GeminiProvider,
};
