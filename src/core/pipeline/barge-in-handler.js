function mergePrompts(base, addition) {
  const lhs = String(base || '').trim();
  const rhs = String(addition || '').trim();
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  return `${lhs} ${rhs}`;
}

class BargeInHandler {
  constructor() {
    this.inFlight = null;
    this.droppedRequestIds = new Set();
    this.queuedPrompt = '';
  }

  setInFlight(payload) {
    this.inFlight = {
      ...payload,
      settled: false,
    };
  }

  clearInFlight(requestId = null) {
    if (!this.inFlight) return;
    if (requestId !== null && this.inFlight.requestId !== requestId) return;
    this.inFlight = null;
  }

  markSettled(requestId) {
    if (!this.inFlight) return;
    if (this.inFlight.requestId === requestId) {
      this.inFlight.settled = true;
      this.inFlight = null;
    }
  }

  dropInFlight(reason) {
    if (!this.inFlight || this.inFlight.settled) {
      return null;
    }

    const { requestId, provider, abortController } = this.inFlight;
    this.droppedRequestIds.add(requestId);

    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    return { requestId, provider, reason };
  }

  isDropped(requestId) {
    return this.droppedRequestIds.has(requestId);
  }

  consumeDropped(requestId) {
    return this.droppedRequestIds.delete(requestId);
  }

  queueLatestPrompt(prompt) {
    this.queuedPrompt = String(prompt || '').trim();
  }

  mergeQueuedPrompt(prompt) {
    this.queuedPrompt = mergePrompts(this.queuedPrompt, prompt);
  }

  hasQueuedPrompt() {
    return Boolean(this.queuedPrompt.trim());
  }

  consumeQueuedPrompt() {
    const out = this.queuedPrompt.trim();
    this.queuedPrompt = '';
    return out;
  }
}

module.exports = {
  BargeInHandler,
  mergePrompts,
};
