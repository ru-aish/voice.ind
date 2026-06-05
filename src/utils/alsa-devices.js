const { execSync } = require('child_process');

function listAlsaDevices(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 3000 });
  } catch {
    return '';
  }
}

function parseAlsaEntries(text) {
  const entries = [];
  let card = null;
  for (const line of text.split('\n')) {
    const cardMatch = line.match(/^card (\d+):/);
    if (cardMatch) {
      card = cardMatch[1];
      continue;
    }
    const devMatch = line.match(/device (\d+):/i);
    if (devMatch && card !== null) {
      entries.push({
        card,
        device: devMatch[1],
        label: line.trim(),
        isDefault: line.includes('(*)'),
        isHdmi: /hdmi/i.test(line),
        isAnalog: /analog|mic|headset|speaker/i.test(line),
      });
    }
  }
  return entries;
}

function pickDevice(entries, kind) {
  if (!entries.length) return null;

  const preferred =
    entries.find((e) => e.isDefault && (kind === 'playback' ? !e.isHdmi : true)) ||
    entries.find((e) => e.isAnalog && !e.isHdmi) ||
    entries.find((e) => !e.isHdmi) ||
    entries[0];

  return `plughw:${preferred.card},${preferred.device}`;
}

function detectAlsaDevice(kind) {
  const command = kind === 'capture' ? 'arecord -l' : 'aplay -l';
  const entries = parseAlsaEntries(listAlsaDevices(command));
  return pickDevice(entries, kind);
}

function resolveAudioDevice(envValue, kind) {
  const raw = String(envValue || '').trim().toLowerCase();
  if (raw && !['', 'pulse', 'auto', 'default'].includes(raw)) {
    return String(envValue).trim();
  }
  return detectAlsaDevice(kind) || 'default';
}

module.exports = {
  detectAlsaDevice,
  resolveAudioDevice,
};