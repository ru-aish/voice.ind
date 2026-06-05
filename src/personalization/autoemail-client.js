const PERSONALIZATION_API_KEY =
  process.env.PERSONALIZATION_API_KEY || process.env.AUTOEMAIL_READ_API_KEY || '';

const AUTOEMAIL_BASE = String(
  process.env.AUTOEMAIL_API_BASE || 'https://sender.clarvoc.org'
).replace(/\/$/, '');

const FETCH_TIMEOUT_MS = Math.max(
  250,
  Number(process.env.PERSONALIZATION_FETCH_TIMEOUT_MS || 2500)
);

async function fetchJson(url) {
  const headers = { Accept: 'application/json' };
  if (PERSONALIZATION_API_KEY) headers['X-API-Key'] = PERSONALIZATION_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers, cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchByTrackingId(trackingId) {
  const tid = String(trackingId || '').trim();
  if (!tid) return null;
  const url = `${AUTOEMAIL_BASE}/api/demo-personalization/by-tracking/${encodeURIComponent(tid)}`;
  const { ok, data } = await fetchJson(url);
  if (!ok || !data?.success || !data.record) return null;
  return data.record;
}

async function fetchByCampaignId(campaignId) {
  const cid = String(campaignId || '').trim();
  if (!cid) return null;
  const url = `${AUTOEMAIL_BASE}/api/campaign/${encodeURIComponent(cid)}/demo-personalization?limit=1`;
  const { ok, data } = await fetchJson(url);
  if (!ok || !data?.success) return null;
  const record = data.record || (Array.isArray(data.records) ? data.records[0] : null);
  return record || null;
}

/**
 * Prefer tracking_id (unique person); fall back to first row for campaign.
 */
async function fetchPersonalizationRecord({ trackingId, campaignId }) {
  if (trackingId) {
    const byTid = await fetchByTrackingId(trackingId);
    if (byTid) return byTid;
  }
  if (campaignId) {
    return fetchByCampaignId(campaignId);
  }
  return null;
}

module.exports = {
  fetchPersonalizationRecord,
  fetchByTrackingId,
  fetchByCampaignId,
};