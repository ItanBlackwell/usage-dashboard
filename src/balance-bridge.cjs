/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Local-only receiver for a user-installed browser extension reading the
// VISIBLE OpenAI Platform Billing page. No browser cookies, credentials,
// HTML, URLs with query strings, or tokens are sent to the UI or persisted.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('node:http');

const DEFAULT_PORT = 18746;
const MINUTE = 60_000;
const safePort = x => Number.isInteger(x) && x >= 1025 && x <= 65535 ? x : DEFAULT_PORT;
function validBalance(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= -1_000_000 && x <= 100_000_000;
}
function validPage(url,provider='codex') {
  // Zen reports a fixed source marker, never the private workspace URL.
  return provider==='codex'
    ? url==='https://platform.openai.com/settings/organization/billing/overview'
    : provider==='opencode'&&url==='https://opencode.ai/workspace/billing';
}
function secretEquals(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual, 'utf8'), b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function acceptableOrigin(origin) {
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
async function createBridge({ pairingPath, onBalance, onError = () => {}, now = () => Date.now() }) {
  let config;
  try { config = JSON.parse(await fs.readFile(pairingPath, 'utf8')); }
  catch { return { available: false, close: async () => {} }; }
  if (typeof config.token !== 'string' || config.token.length < 40 || typeof onBalance !== 'function')
    return { available: false, close: async () => {} };
  const port = safePort(config.port);
  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    const allowed = acceptableOrigin(origin);
    const send = (code, body = '') => {
      response.writeHead(code, { 'Content-Type':'text/plain; charset=utf-8',
        'Cache-Control':'no-store', 'Vary':'Origin',
        ...(allowed ? { 'Access-Control-Allow-Origin':origin } : {}) });
      response.end(body);
    };
    if (!allowed || request.url !== '/v1/balance') return send(403);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':'POST, OPTIONS',
        'Access-Control-Allow-Headers':'content-type, x-pv-usage-token',
        'Access-Control-Max-Age':'600', 'Cache-Control':'no-store' });
      return response.end();
    }
    if (request.method !== 'POST') return send(405);
    if (!secretEquals(request.headers['x-pv-usage-token'], config.token)) return send(403);
    let input = '';
    request.on('data', chunk => {
      input += chunk.toString('utf8');
      if (input.length > 1024) request.destroy();
    });
    request.on('end', () => {
      let doc;
      try { doc = JSON.parse(input); } catch { return send(400); }
      const provider=doc?.provider??'codex';
      if (!validBalance(doc?.balanceUsd) || doc.currency !== 'USD' || !validPage(doc.page,provider)) return send(422);
      // ObservedAt is server time. Never trust browser-supplied timestamps.
      void Promise.resolve(onBalance({ provider, usd:doc.balanceUsd, currency:'USD', observedAt:now(), source:'billing-page' }))
        .then(() => send(204)).catch(() => send(500));
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    onError(error?.code === 'EADDRINUSE' ? 'bridge_port_busy' : 'bridge_start_failed');
    return { available:false, close:async()=>{} };
  }
  server.unref?.();
  return { available:true, port, close: () => new Promise(resolve => server.close(() => resolve())) };
}
module.exports = { createBridge, validBalance, validPage, acceptableOrigin, secretEquals, DEFAULT_PORT, MINUTE };
