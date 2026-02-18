const TERMINATOR_REGEX = /[.!?|।॥\n]$/;
const SPLIT_REGEX = /([.!?|।॥\n]+)/;
const SAFE_BREAK_REGEX = /[.!?।॥,\n\s]/;
const STRONG_BREAK_REGEX = /[.!?।॥\n]/;
const CLAUSE_BREAK_REGEX = /[,;:\n]/;

function findSplitIndex(buffer, targetIdx) {
  if (!buffer) return -1;

  // Prefer strong sentence endings first.
  for (let i = Math.min(targetIdx, buffer.length - 1); i >= 0; i -= 1) {
    if (STRONG_BREAK_REGEX.test(buffer[i])) return i + 1;
  }

  // Then try clause boundaries.
  for (let i = Math.min(targetIdx, buffer.length - 1); i >= 0; i -= 1) {
    if (CLAUSE_BREAK_REGEX.test(buffer[i])) return i + 1;
  }

  // Finally allow whitespace split.
  for (let i = Math.min(targetIdx, buffer.length - 1); i >= 0; i -= 1) {
    if (/\s/.test(buffer[i])) return i + 1;
  }

  return -1;
}

function extractLineChunks(bufferText, maxChars) {
  const chunks = [];
  let text = String(bufferText || '').trim();
  if (!text) return { chunks, remaining: '' };
  const softMax = Math.max(40, Number(maxChars) || 180);
  const hardMax = Math.max(softMax + 30, Math.round(softMax * 1.7));
  const minTailChars = 8;

  const parts = text.split(SPLIT_REGEX);
  let buffer = '';

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;

    buffer += part;

    if (TERMINATOR_REGEX.test(buffer)) {
      const candidate = buffer.replace(/\n+/g, ' ').trim();
      if (candidate) chunks.push(candidate);
      buffer = '';
      continue;
    }

    // Don't split mid-sentence unless the buffer gets much larger than softMax.
    if (buffer.length >= hardMax) {
      let splitIdx = findSplitIndex(buffer, softMax);
      if (splitIdx <= 0) {
        splitIdx = findSplitIndex(buffer, hardMax);
      }
      if (splitIdx <= 0) splitIdx = Math.min(buffer.length, hardMax);

      const candidate = buffer.slice(0, splitIdx).trim();
      const next = buffer.slice(splitIdx).trimStart();

      // Avoid tiny leftovers like "અપ" that sound broken in TTS.
      if (next && next.length < minTailChars && !STRONG_BREAK_REGEX.test(candidate)) {
        continue;
      }

      buffer = next;
      if (candidate) chunks.push(candidate);
    }
  }

  return { chunks, remaining: buffer };
}

function splitTimeoutSafeChunk(bufferText, minTailChars = 8) {
  const text = String(bufferText || '');
  if (!text.trim()) return { chunk: '', remaining: '' };

  let splitIdx = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (SAFE_BREAK_REGEX.test(text[i])) {
      splitIdx = i + 1;
      break;
    }
  }

  if (splitIdx <= 0) {
    return { chunk: '', remaining: text };
  }

  const chunk = text.slice(0, splitIdx).trim();
  const remaining = text.slice(splitIdx).trimStart();

  // Keep tiny tails (often half words) for the next token burst.
  if (remaining && remaining.length < Math.max(1, Number(minTailChars) || 2)) {
    return { chunk: '', remaining: text };
  }

  return { chunk, remaining };
}

module.exports = {
  extractLineChunks,
  splitTimeoutSafeChunk,
};
