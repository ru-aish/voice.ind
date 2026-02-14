class VadHandler {
  constructor() {
    this.speechActive = false;
    this.activeSegment = null;
    this.segments = [];
  }

  onStart(nowMs, transcriptSeq) {
    this.speechActive = true;
    this.activeSegment = {
      segmentIndex: this.segments.length + 1,
      startedAtMs: nowMs,
      startTranscriptSeq: transcriptSeq,
    };
    return {
      segmentIndex: this.activeSegment.segmentIndex,
      startedAtMs: nowMs,
    };
  }

  onEnd(nowMs, transcriptSeq) {
    const segment = {
      segmentIndex: this.activeSegment?.segmentIndex || this.segments.length + 1,
      startedAtMs: this.activeSegment?.startedAtMs || null,
      endedAtMs: nowMs,
      durationMs: this.activeSegment?.startedAtMs ? nowMs - this.activeSegment.startedAtMs : null,
      reason: 'speech_stopped',
      segmentStartTranscriptSeq: this.activeSegment?.startTranscriptSeq ?? transcriptSeq,
    };

    this.segments.push(segment);
    this.speechActive = false;
    this.activeSegment = null;
    return segment;
  }

  forceEnd(nowMs) {
    if (!this.speechActive || !this.activeSegment?.startedAtMs) {
      return null;
    }

    const segment = {
      segmentIndex: this.activeSegment.segmentIndex,
      startedAtMs: this.activeSegment.startedAtMs,
      endedAtMs: nowMs,
      durationMs: nowMs - this.activeSegment.startedAtMs,
      reason: 'session_stopped_before_end_speech',
      segmentStartTranscriptSeq: this.activeSegment.startTranscriptSeq,
    };

    this.segments.push(segment);
    this.speechActive = false;
    this.activeSegment = null;
    return segment;
  }

  getSummary() {
    return this.segments.slice();
  }
}

module.exports = {
  VadHandler,
};
