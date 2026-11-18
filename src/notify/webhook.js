'use strict';
const { ascii } = require('../util/ascii');

const URL_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const EVENTS = new Set(['CONNECTED', 'DISCONNECTED', 'VOICE_JOINED', 'VOICE_LEFT', 'ERROR', 'TEST']);

function isValidUrl(u) { return URL_RE.test(String(u || '')); }

async function post(url, event, code) {
  if (!isValidUrl(url)) throw new Error('invalid webhook URL');
  if (!EVENTS.has(event)) throw new Error('event not allowed');
  const content = '[DVT] ' + event + (code ? ' ' + ascii(code, 40) : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('webhook HTTP ' + res.status);
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

module.exports = { Notifier, isValidUrl };
