'use strict';
const { ascii } = require('../util/ascii');

const URL_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const EVENTS = new Set(['CONNECTED', 'DISCONNECTED', 'VOICE_JOINED', 'VOICE_LEFT', 'ERROR', 'TEST']);

function isValidUrl(u) { return URL_RE.test(String(u || '')); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, event, code, { fetchImpl = fetch, sleepFn = sleep } = {}) {
  if (!isValidUrl(url)) throw new Error('invalid webhook URL');
  if (!EVENTS.has(event)) throw new Error('event not allowed');
  const content = '[DVT] ' + event + (code ? ' ' + ascii(code, 40) : '');
  const init = () => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000)
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, init());
    if (res.status === 429 && attempt === 0) {
      // Rate limit Discord : on attend retry_after (secondes) si c'est raisonnable, une seule fois.
      let retry = NaN;
      try { retry = Number((await res.json()).retry_after); } catch (_) { /* corps illisible */ }
      if (!(retry > 0 && retry <= 5)) throw new Error('webhook rate limited');
      await sleepFn(Math.ceil(retry * 1000));
      continue;
    }
    if (res.status === 429) throw new Error('webhook rate limited');
    if (!res.ok) throw new Error('webhook HTTP ' + res.status);
    return;
  }
}

class Notifier {
  constructor(log, getUrl, isEnabled) {
    this.log = log; this.getUrl = getUrl; this.isEnabled = isEnabled; this.last = new Map();
  }

  active() { return this.isEnabled() && isValidUrl(this.getUrl()); }

  notify(event, code) {
    if (!this.active()) return;
    const key = event + ':' + (code || '');
    const now = Date.now();
    if (now - (this.last.get(key) || 0) < 5000) return;
    this.last.set(key, now);
    post(this.getUrl(), event, code).catch((e) => this.log.warn('webhook: ' + e.message));
  }

  async notifyNow(event, code) {
    if (!this.active()) return;
    try { await post(this.getUrl(), event, code); }
    catch (e) { this.log.warn('webhook: ' + e.message); }
  }

  async test() { await post(this.getUrl(), 'TEST'); }
}

module.exports = { Notifier, isValidUrl, post };
