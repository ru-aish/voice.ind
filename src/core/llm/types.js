class LlmProvider {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  async streamText({ prompt, messages, abortSignal, onToken, onFirstToken }) {
    throw new Error('streamText must be implemented by provider');
  }
}

function countTokensApprox(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isReasoningModel(modelName) {
  return /(^|\/)gpt-oss-/i.test(String(modelName || ''));
}

function isAbortError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('abort');
}

module.exports = {
  LlmProvider,
  countTokensApprox,
  isReasoningModel,
  isAbortError,
};
