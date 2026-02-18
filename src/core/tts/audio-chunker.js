const TERMINATOR_REGEX = /[.!?|।॥\n]$/;
const SPLIT_REGEX = /([.!?|।॥\n]+)/;
const SAFE_BREAK_REGEX = /[.!?।॥,\n\s]/;

function extractLineChunks(bufferText, maxChars) {
  const chunks = [];
  let text = String(bufferText || '').trim();
  if (!text) return { chunks, remaining: '' };

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

    if (buffer.length >= maxChars) {
      let splitIdx = -1;
      for (let j = buffer.length - 1; j >= 0; j -= 1) {
        const ch = buffer[j];
        if (ch === ' ' || ch === ',') {
          splitIdx = j + 1;
          break;
        }
      }
      if (splitIdx <= 0) splitIdx = Math.min(maxChars, buffer.length);
      const candidate = buffer.slice(0, splitIdx).trim();
      buffer = buffer.slice(splitIdx).trimStart();
      if (candidate) chunks.push(candidate);
    }
  }

  return { chunks, remaining: buffer };
}

function splitTimeoutSafeChunk(bufferText, minTailChars = 2) {
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
