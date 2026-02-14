class LatencyTracker {
  constructor(provider, requestId, prompt, detectionEndedAtMs) {
    this.provider = provider;
    this.requestId = requestId;
    this.prompt = String(prompt || '');
    this.promptSentAtMs = Date.now();
    this.detectionEndedAtMs = detectionEndedAtMs;

    this.firstTokenAtMs = null;
    this.firstTokenSource = null;

    this.firstTtsSendAtMs = null;
    this.firstTtsChunkAtMs = null;

    this.tokenCountApprox = 0;
    this.tpsApprox = null;

    this.generatedText = '';
    this.segments = [];
    this.providerFinishReason = null;

    this.turnCompletedAtMs = null;
  }

  markFirstToken(atMs, source) {
    if (!this.firstTokenAtMs) {
      this.firstTokenAtMs = atMs;
      this.firstTokenSource = source || null;
    }
  }

  addTokensApprox(deltaCount) {
    this.tokenCountApprox += Number(deltaCount || 0);
  }

  addGeneratedText(text) {
    this.generatedText += String(text || '');
  }

  addSegment(segment) {
    this.segments.push(segment);

    if (!this.firstTtsSendAtMs && segment.sentAtMs) {
      this.firstTtsSendAtMs = segment.sentAtMs;
    }

    if (!this.firstTtsChunkAtMs && segment.firstChunkAtMs) {
      this.firstTtsChunkAtMs = segment.firstChunkAtMs;
    }
  }

  complete(tpsApprox) {
    this.turnCompletedAtMs = Date.now();
    this.tpsApprox = Number.isFinite(Number(tpsApprox)) ? Number(tpsApprox) : null;
    return this.summary();
  }

  setProviderFinishReason(reason) {
    const value = String(reason || '').trim();
    this.providerFinishReason = value || null;
  }

  summary() {
    const providerTtftMs =
      this.firstTokenAtMs && this.promptSentAtMs
        ? this.firstTokenAtMs - this.promptSentAtMs
        : null;

    const firstTokenToFirstTtsSendMs =
      this.firstTokenAtMs && this.firstTtsSendAtMs
        ? this.firstTtsSendAtMs - this.firstTokenAtMs
        : null;

    const firstTtsSendToFirstChunkMs =
      this.firstTtsSendAtMs && this.firstTtsChunkAtMs
        ? this.firstTtsChunkAtMs - this.firstTtsSendAtMs
        : null;

    const promptToFirstChunkMs =
      this.promptSentAtMs && this.firstTtsChunkAtMs
        ? this.firstTtsChunkAtMs - this.promptSentAtMs
        : null;

    const detectionEndToFirstTokenMs =
      this.detectionEndedAtMs && this.firstTokenAtMs
        ? Math.max(0, this.firstTokenAtMs - this.detectionEndedAtMs)
        : null;

    const detectionEndToFirstAudioMs =
      this.detectionEndedAtMs && this.firstTtsChunkAtMs
        ? Math.max(0, this.firstTtsChunkAtMs - this.detectionEndedAtMs)
        : null;

    return {
      requestId: this.requestId,
      provider: this.provider,
      promptChars: this.prompt.length,
      promptSentAtMs: this.promptSentAtMs,
      firstTokenAtMs: this.firstTokenAtMs,
      firstTokenSource: this.firstTokenSource,
      providerTtftMs,
      tokenCountApprox: this.tokenCountApprox,
      tpsApprox: this.tpsApprox,
      firstTtsSendAtMs: this.firstTtsSendAtMs,
      firstTtsChunkAtMs: this.firstTtsChunkAtMs,
      firstTokenToFirstTtsSendMs,
      firstTtsSendToFirstChunkMs,
      promptToFirstChunkMs,
      detectionEndToFirstTokenMs,
      detectionEndToFirstAudioMs,
      turnCompletedAtMs: this.turnCompletedAtMs,
      turnTotalMs:
        this.turnCompletedAtMs && this.promptSentAtMs
          ? this.turnCompletedAtMs - this.promptSentAtMs
          : null,
      providerFinishReason: this.providerFinishReason,
      segments: this.segments,
      generatedText: this.generatedText,
    };
  }
}

module.exports = {
  LatencyTracker,
};
