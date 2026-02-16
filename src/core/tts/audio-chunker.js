const TERMINATOR_REGEX = /[.!?|।॥\n]$/;
const SPLIT_REGEX = /([.!?|।॥\n]+)/;

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

module.exports = {
  extractLineChunks,
};
