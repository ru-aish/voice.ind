function normalizeTranscriptText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractTranscript(response) {
  const transcript = response?.data?.transcript || response?.transcript || response?.text || '';
  return normalizeTranscriptText(transcript);
}

function extractTranscriptIsFinal(response) {
  const data = response?.data || {};
  const candidates = [
    data?.is_final,
    data?.final,
    data?.isFinal,
    response?.is_final,
    response?.final,
    response?.isFinal,
  ];
  if (candidates.some((v) => v === true)) return true;

  const typeHints = [
    data?.transcript_type,
    data?.type,
    data?.event_type,
    response?.transcript_type,
    response?.type,
    response?.event_type,
  ]
    .map((v) => String(v || '').toLowerCase())
    .filter(Boolean);

  return typeHints.some((v) => v.includes('final'));
}

function extractVadSignalType(response) {
  const signalType =
    response?.data?.signal_type ||
    response?.signal_type ||
    response?.data?.event?.signal_type ||
    response?.event?.signal_type;

  if (!signalType) return null;
  return String(signalType).toUpperCase();
}

function mergeTranscriptText(existingText, incomingText) {
  const a = normalizeTranscriptText(existingText);
  const b = normalizeTranscriptText(incomingText);
  if (!a) return b;
  if (!b) return a;

  if (b.startsWith(a) || b.includes(a)) return b;
  if (a.startsWith(b) || a.includes(b)) return a;

  const maxOverlap = Math.min(a.length, b.length, 80);
  let overlap = 0;

  for (let i = maxOverlap; i >= 1; i -= 1) {
    if (a.slice(-i) === b.slice(0, i)) {
      overlap = i;
      break;
    }
  }

  if (overlap > 0) {
    return normalizeTranscriptText(`${a}${b.slice(overlap)}`);
  }

  return normalizeTranscriptText(`${a} ${b}`);
}

function collapseConsecutiveWordRepeats(text) {
  const words = normalizeTranscriptText(text).split(' ').filter(Boolean);
  if (words.length <= 1) return normalizeTranscriptText(text);

  const out = [];
  let prev = '';
  let streak = 0;

  for (const word of words) {
    if (word === prev) {
      streak += 1;
      if (streak <= 2) out.push(word);
      continue;
    }
    prev = word;
    streak = 1;
    out.push(word);
  }

  return out.join(' ');
}

function collapseRepeatedPrefixPattern(text) {
  const words = normalizeTranscriptText(text).split(' ').filter(Boolean);
  if (words.length < 8) return normalizeTranscriptText(text);

  const maxPattern = Math.min(10, Math.floor(words.length / 3));
  for (let p = 1; p <= maxPattern; p += 1) {
    const pattern = words.slice(0, p);
    let i = 0;
    let repeats = 0;

    while (i + p <= words.length) {
      let same = true;
      for (let j = 0; j < p; j += 1) {
        if (words[i + j] !== pattern[j]) {
          same = false;
          break;
        }
      }
      if (!same) break;
      repeats += 1;
      i += p;
    }

    if (repeats >= 3) {
      return [...pattern, ...words.slice(i)].join(' ');
    }
  }

  return normalizeTranscriptText(text);
}

function sanitizePromptTranscript(text, dedupRepeatedTranscript = true) {
  let out = normalizeTranscriptText(text);
  if (!dedupRepeatedTranscript) return out;
  out = collapseRepeatedPrefixPattern(out);
  out = collapseConsecutiveWordRepeats(out);
  return normalizeTranscriptText(out);
}

function summarizeSttMessage(response) {
  const data = response?.data;
  if (response?.type === 'error') return `error:${JSON.stringify(data || response)}`;
  if (data?.event_type || data?.signal_type) {
    return `event:${data.event_type || data.signal_type}`;
  }
  if (data?.transcript) return data.transcript;
  return JSON.stringify(response);
}

module.exports = {
  normalizeTranscriptText,
  extractTranscript,
  extractTranscriptIsFinal,
  extractVadSignalType,
  mergeTranscriptText,
  sanitizePromptTranscript,
  summarizeSttMessage,
};
