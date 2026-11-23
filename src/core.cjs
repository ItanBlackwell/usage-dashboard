/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Credential reading and HTTP are confined to Electron's main process.
// Refresh tokens may be in the parsed auth file but are never extracted, logged, or sent through IPC.
const { readFile } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');

const CODEX_URL = 'https://chatgpt.com/backend-api/wham/usage';
const COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const MAX_PAGES = 12;

const obj = (x) => x && typeof x === 'object' && !Array.isArray(x) ? x : null;
const finite = (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) && Number.isFinite(Number(x)) ? Number(x) : null;
const textValue = (x) => typeof x === 'string' && x.trim() ? x.trim() : null;

function authLocations(env = process.env, home = homedir()) {
  const entries = [];
  if (path.isAbsolute(env.XDG_DATA_HOME || '')) entries.push(path.join(env.XDG_DATA_HOME, 'opencode', 'auth.json'));
  entries.push(path.join(home, '.local', 'share', 'opencode', 'auth.json'));
  if (env.LOCALAPPDATA) entries.push(path.join(env.LOCALAPPDATA, 'opencode', 'auth.json'));
  entries.push(path.join(home, '.codex', 'auth.json'));
  return [...new Set(entries)];
}

function parseCredential(doc, source) {
  const root = obj(doc);
  if (!root) return null;
  const entry = obj(root.openai);
  if (entry && entry.type === 'oauth') {
    const access = textValue(entry.access);
    const account = textValue(entry.accountId) || textValue(entry.account_id);
    const expires = finite(entry.expires);
    if (access) return { access, account, expires, source };
  }
  const tokens = obj(root.tokens);
  if (tokens) {
    const access = textValue(tokens.access_token);
    const account = textValue(tokens.account_id) || textValue(root.account_id);
    if (access) return { access, account, expires: null, source };
  }
  return null;
}

async function findCredential(env = process.env, home = homedir(), loader = readFile) {
  let expired = false;
  for (const location of authLocations(env, home)) {
    try {
      const credential = parseCredential(JSON.parse(await loader(location, 'utf8')), location.includes('.codex') ? 'Codex' : 'OpenCode');
      if (!credential) continue;
      // OpenCode expires is normally milliseconds; do not use a stale token.
      if (credential.expires && credential.expires < Date.now() + 10_000) { expired = true; continue; }
      return { credential, expired };
    } catch (e) {
      if (e && ['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(e.code)) continue;
      // Invalid files are skipped without logging their content.
    }
  }
  return { credential: null, expired };
}

function parseReset(window, now) {
  const w = obj(window);
  if (!w) return null;
  const millisecond = finite(w.reset_time_ms);
  if (millisecond !== null && millisecond >= 0) return Math.round(millisecond);
  const value = w.reset_at ?? w.resetsAt;
  const numeric = finite(value);
  if (numeric !== null && numeric >= 0) return Math.round(numeric < 1e12 ? numeric * 1000 : numeric);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const after = finite(w.reset_after_seconds);
  return after !== null && after >= 0 ? now + after * 1000 : null;
}

function parseWindow(window, defaultLabel, now = Date.now()) {
  const w = obj(window);
  if (!w) return null;
  const duration = finite(w.limit_window_seconds);
  const label = duration !== null ? (duration >= 172800 ? 'Weekly' : '5-hour') : defaultLabel;
  const usedField = finite(w.used_percent ?? w.usedPercent);
  const remainingField = finite(w.percent_left ?? w.percentLeft);
  const used = usedField !== null ? usedField : remainingField !== null ? 100 - remainingField : null;
  if (used === null || used < 0 || used > 100) return null;
  return { label, usedPercent: used, remainingPercent: 100 - used, resetsAt: parseReset(w, now) };
}

function parseCodexUsage(payload, now = Date.now()) {
  const document = obj(payload);
  if (!document) throw new Error('invalid_payload');
  const limit = obj(document.rate_limit) || obj(document.rate_limits);
  if (!limit) throw new Error('missing_rate_limits');
  const windows = [];
  for (const [name, candidates] of [
    ['5-hour', ['five_hour', 'primary_window', 'primary']],
    ['Weekly', ['weekly', 'secondary_window', 'secondary']],
  ]) {
    const candidate = candidates.map((x) => limit[x]).find((x) => obj(x));
    const entry = parseWindow(candidate, name, now);
    if (entry) {
      const existing = windows.findIndex((x) => x.label === entry.label);
      if (existing >= 0) windows[existing] = entry;
      else windows.push(entry);
    }
  }
  if (!windows.length) throw new Error('missing_windows');
  const creditsRaw = obj(document.credits);
  // Credit *amount* is not assumed to be an API monetary balance.
  const credits = finite(creditsRaw?.balance);
  return { windows, credits: credits !== null && credits >= 0 ? credits : null };
}

function parseCostsPage(body) {
  const root = obj(body);
  if (!root || !Array.isArray(root.data)) throw new Error('invalid_costs');
  let totalUsd = 0;
  for (const bucket of root.data) {
    if (!Array.isArray(bucket?.results)) continue;
    for (const result of bucket.results) {
      if (result?.amount?.currency !== 'usd') continue;
      const value = finite(result.amount.value);
      if (value !== null) totalUsd += value;
    }
  }
  return { totalUsd, hasMore: root.has_more === true, nextPage: textValue(root.next_page) };
}

function beginningOfMonth(now = new Date()) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

async function fetchJson(url, headers, fetcher = fetch) {
  // Fixed official origin per function; no caller-supplied URLs or redirects.
  const response = await fetcher(url, {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('unauthorized');
    if (response.status === 429) throw new Error('rate_limited');
    throw new Error('http_error');
  }
  return await response.json();
}

const status = (state, message, extra = {}) => ({ state, message, checkedAt: Date.now(), ...extra });

async function readCodex({ env = process.env, home = homedir(), loader = readFile, fetcher = fetch } = {}) {
  const { credential, expired } = await findCredential(env, home, loader);
  if (!credential) return status('unavailable', expired ? 'login_expired' : 'login_required', { windows: [], credits: null });
  const headers = { Authorization: `Bearer ${credential.access}`, Accept: 'application/json' };
  if (credential.account) headers['ChatGPT-Account-Id'] = credential.account;
  try {
    const payload = await fetchJson(CODEX_URL, headers, fetcher);
    const data = parseCodexUsage(payload);
    return status('ok', 'ok', data);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    const message = ['unauthorized','rate_limited','missing_rate_limits','missing_windows'].includes(code) ? code : 'request_failed';
    return status('error', message, { windows: [], credits: null });
  }
}

async function readApiCosts({ env = process.env, fetcher = fetch, now = new Date() } = {}) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = textValue(env.OPENAI_ADMIN_KEY);
  const budget = finite(env.OPENAI_API_MONTHLY_BUDGET_USD);
  const monthlyBudgetUsd = budget !== null && budget >= 0 ? budget : null;
  if (!key) return status('unavailable', 'admin_key_required', { month, usdSpent: null, monthlyBudgetUsd, usdRemainingBudget: null });
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  try {
    const start = beginningOfMonth(now);
    const end = Math.floor(now.getTime() / 1000);
    let page = null;
    let total = 0;
    const seen = new Set();
    for (let i = 0; i < MAX_PAGES; i++) {
      const url = new URL(COSTS_URL);
      url.searchParams.set('start_time', String(start));
      url.searchParams.set('end_time', String(Math.max(end, start + 1)));
      url.searchParams.set('bucket_width', '1d');
      url.searchParams.set('limit', '31');
      if (page) url.searchParams.set('page', page);
      const parsed = parseCostsPage(await fetchJson(url.toString(), headers, fetcher));
      total += parsed.totalUsd;
      if (!parsed.hasMore) {
        const spent = Math.round((total + Number.EPSILON) * 10000) / 10000;
        return status('ok', 'ok', { month, usdSpent: spent, monthlyBudgetUsd,
          usdRemainingBudget: monthlyBudgetUsd === null ? null : Math.round((monthlyBudgetUsd - spent) * 100) / 100 });
      }
      if (!parsed.nextPage || seen.has(parsed.nextPage)) throw new Error('pagination_error');
      seen.add(parsed.nextPage);
      page = parsed.nextPage;
    }
    throw new Error('pagination_limit');
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    return status('error', ['unauthorized','rate_limited'].includes(code) ? code : 'request_failed',
      { month, usdSpent: null, monthlyBudgetUsd, usdRemainingBudget: null });
  }
}

function makeMonitor(sources = { readCodex, readApiCosts }, now = () => Date.now()) {
  const cache = { codex: null, api: null };
  const pending = { codex: null, api: null };
  const ttl = { codex: 60_000, api: 300_000 };
  async function getOne(which, force) {
    const previous = cache[which];
    if (!force && previous && now() - previous.at < ttl[which]) return previous.value;
    if (pending[which]) return pending[which];
    pending[which] = (async () => {
      try {
        const value = await (which === 'codex' ? sources.readCodex() : sources.readApiCosts());
        if (value.state !== 'ok' && previous?.value.state === 'ok') {
          return { ...previous.value, state: 'stale', message: value.message };
        }
        cache[which] = { at: now(), value };
        return value;
      } finally { pending[which] = null; }
    })();
    return pending[which];
  }
  return {
    async get(force = false) {
      const [codex, api] = await Promise.all([getOne('codex', force), getOne('api', force)]);
      return { codex, api };
    },
  };
}

module.exports = {
  authLocations, parseCredential, findCredential, parseReset, parseWindow, parseCodexUsage,
  parseCostsPage, beginningOfMonth, readCodex, readApiCosts, makeMonitor,
};
