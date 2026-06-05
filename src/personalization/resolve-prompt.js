const fs = require('fs');
const path = require('path');
const { getTypeDefinition, promptsDir } = require('./registry');
const { fetchPersonalizationRecord } = require('./autoemail-client');

function readTemplate(relPath) {
  const full = path.join(promptsDir, relPath);
  try {
    return String(fs.readFileSync(full, 'utf8') || '').trim();
  } catch {
    return '';
  }
}

function fillPlaceholders(template, record, placeholders) {
  let out = template;
  for (const [token, field] of Object.entries(placeholders)) {
    const val = record?.[field] != null ? String(record[field]) : '';
    const patterns = [
      new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'),
      new RegExp(`\\{\\{\\s*${token.replace(/_/g, '_')}\\s*\\}\\}`, 'g'),
    ];
    for (const re of patterns) {
      out = out.replace(re, val);
    }
  }
  return out;
}

function hasRequiredFields(record, requiredFields) {
  if (!record || !Array.isArray(requiredFields)) return false;
  return requiredFields.every((f) => String(record[f] || '').trim());
}

/**
 * Resolve dynamic system prompt from AutoEmail personalization row.
 * @returns {Promise<{ applied: boolean, type: string|null, systemPrompt: string|null, record: object|null, reason: string }>}
 */
async function resolvePersonalizationPrompt({ trackingId, campaignId }) {
  const record = await fetchPersonalizationRecord({ trackingId, campaignId });
  if (!record) {
    return {
      applied: false,
      type: null,
      systemPrompt: null,
      record: null,
      reason: 'no_personalization_record',
    };
  }

  const typeKey = String(
    record.personalization_type || record.type || ''
  ).trim().toLowerCase();
  if (!typeKey) {
    return {
      applied: false,
      type: null,
      systemPrompt: null,
      record,
      reason: 'missing_personalization_type',
    };
  }

  const def = getTypeDefinition(typeKey);
  if (!def) {
    return {
      applied: false,
      type: typeKey,
      systemPrompt: null,
      record,
      reason: `unknown_personalization_type:${typeKey}`,
    };
  }

  if (!hasRequiredFields(record, def.requiredFields)) {
    return {
      applied: false,
      type: typeKey,
      systemPrompt: null,
      record,
      reason: 'missing_required_listing_fields',
    };
  }

  const template = readTemplate(def.templateFile);
  if (!template) {
    return {
      applied: false,
      type: typeKey,
      systemPrompt: null,
      record,
      reason: `template_not_found:${def.templateFile}`,
    };
  }

  const systemPrompt = fillPlaceholders(template, record, def.placeholders);
  return {
    applied: true,
    type: typeKey,
    systemPrompt,
    record,
    reason: 'ok',
  };
}

module.exports = {
  resolvePersonalizationPrompt,
  fillPlaceholders,
  hasRequiredFields,
};