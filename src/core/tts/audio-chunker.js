const PUNCTUATION_REGEX = /[.!?\n।॥,;:]/;
const SENTENCE_END_REGEX = /[.!?\n।॥]/;

function extractLineChunks(bufferText, maxChars) {
  const chunks = [];
  let text = String(bufferText || '');

  while (text.length > 0) {
    const newlineIdx = text.indexOf('\n');
    if (newlineIdx >= 0) {
      const candidate = text.slice(0, newlineIdx + 1).trim();
      text = text.slice(newlineIdx + 1);
      if (candidate) chunks.push(candidate);
      continue;
    }

    let punctIdx = -1;
    for (let i = 0; i < text.length; i += 1) {
      if (PUNCTUATION_REGEX.test(text[i])) {
        punctIdx = i;
        break;
      }
    }

    if (punctIdx >= 0 && punctIdx + 1 <= maxChars) {
      const candidate = text.slice(0, punctIdx + 1).trim();
      text = text.slice(punctIdx + 1);
      if (candidate) chunks.push(candidate);
      continue;
    }

    if (text.length <= maxChars) break;

    let splitIdx = -1;
    for (let i = Math.min(maxChars - 1, text.length - 1); i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === ' ' || PUNCTUATION_REGEX.test(ch)) {
        splitIdx = i + 1;
        break;
      }
    }

    if (splitIdx <= 0) splitIdx = maxChars;
    const candidate = text.slice(0, splitIdx).trim();
    text = text.slice(splitIdx);
    if (candidate) chunks.push(candidate);
  }

  return { chunks, remaining: text };
}

module.exports = {
  extractLineChunks,
};
