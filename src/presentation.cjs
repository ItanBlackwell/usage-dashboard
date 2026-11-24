/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Renderer-only whitelist: never show empty providers or unauthenticated
// catalog entries. An unavailable quota for an authenticated account is still
// useful, but login-required / expired entries are not connected.
const unsupported = new Set(['login_required']);
const providers = ['codex','claude','gemini','deepseek','kimi','qwen','zai','openrouter','minimax','opencode','opencode-go'];
function connectedSubscriptions(data) {
  return (Array.isArray(data?.accounts) ? data.accounts : [])
    .filter(a => a && a.kind === 'subscription' && providers.includes(a.provider)
      && !unsupported.has(a.message));
}

function connectedApiKeys(data) {
  return (Array.isArray(data?.accounts) ? data.accounts : [])
    .filter(a => a && a.kind === 'api' && providers.includes(a.provider)
      && !unsupported.has(a.message));
}

// An explicitly configured monthly budget is a limit, NOT a prepaid balance.
// Never render a raw bill, a connected API key with no quota, or a guessed cash
// balance as an account limit.
function availableApiBudgets(data) {
  return (Array.isArray(data?.organizations) ? data.organizations : [])
    .filter(o => o && providers.includes(o.provider) && o.state === 'ok'
      && Number.isFinite(o.monthlyBudgetUsd) && o.monthlyBudgetUsd >= 0
      && Number.isFinite(o.usdRemainingBudget));
}
function minimumRemaining(data) {
  const numbers = connectedSubscriptions(data).flatMap(a => Array.isArray(a.windows)
    ? a.windows.map(w => w.remainingPercent) : [])
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
  for (const b of availableApiBudgets(data)) if (b.monthlyBudgetUsd > 0)
    numbers.push(Math.max(0, Math.min(100, 100*b.usdRemainingBudget/b.monthlyBudgetUsd)));
  return numbers.length ? Math.min(...numbers) : null;
}
// The host can have one active credential PER provider. Prefer an explicitly
// selected account in this window; otherwise favor the active OpenAI account.
// Never silently combine quotas from multiple unrelated accounts.
function indicatorAccount(data,preferredID=null) {
  const all=[...connectedSubscriptions(data),...connectedApiKeys(data)];
  const active=all.filter(a=>a.active);
  if (preferredID) {
    const match=active.find(a=>a.id===preferredID);
    if(match) return match;
  }
  return active.find(a=>a.provider==='codex') || active[0] || null;
}
function indicatorValue(account) {
  if (!account) return null;
  const values=(account.windows||[]).map(w=>w.remainingPercent)
    .filter(n=>Number.isFinite(n)&&n>=0&&n<=100);
  return values.length ? Math.min(...values) : null;
}

// OpenCode accounts may contain both windows, one window, or several variants
// of a window (e.g. per model). Never fabricate a missing window; if several
// comparable windows exist, report the most constrained valid remaining value.
function classifyWindow(label) {
  const name=typeof label==='string'?label.toLowerCase().trim():'';
  if (/^5[\s-]?(?:h(?:our)?s?)\b|^five[\s_-]?hour\b/.test(name)) return 'fiveHour';
  if (/^(?:weekly|week|7[\s-]?(?:d|days?))\b/.test(name)) return 'weekly';
  return 'other';
}
function indicatorWindows(account) {
  const result={fiveHour:null,weekly:null,other:null};
  if(!account||account.kind!=='subscription'||!Array.isArray(account.windows))return result;
  for(const win of account.windows){
    const remaining=win?.remainingPercent;
    if(typeof remaining!=='number'||!Number.isFinite(remaining)||remaining<0||remaining>100)continue;
    const key=classifyWindow(win.label);
    result[key]=result[key]===null?remaining:Math.min(result[key],remaining);
  }
  return result;
}
// Browser readings are workspace/organization scoped, not per-key balances.
function browserBalanceFor(account,snapshot) {
  if(account?.kind!=='api'||!['codex','opencode'].includes(account.provider))return null;
  const keys=connectedApiKeys(snapshot).filter(a=>a.provider===account.provider);
  if(keys.length!==1||keys[0].id!==account.id)return null;
  const b=account.provider==='codex'?snapshot?.browserBalance:snapshot?.zenBrowserBalance;
  return b?.currency==='USD'&&Number.isFinite(b.usd)?b:null;
}
function indicatorPresentation(account,snapshot) {
  if(!account)return {mode:'unavailable'};
  if(account.kind==='api'){
    const own=account.balance;
    // A key spending cap is NOT wallet money. Keep the ring unknown instead of
    // misrepresenting it as a prepaid balance.
    if(own?.kind==='balance' && Number.isFinite(own.amount))return {mode:'api',amount:own.amount,currency:own.currency};
    // Billing credit is organization-wide: only attach it if exactly one
    // OpenAI API account exists. Never attribute it to two unrelated keys.
    const amount=browserBalanceFor(account,snapshot)?.usd??null;
    return {mode:'api',amount,currency:'USD'};
  }
  const windows=indicatorWindows(account);
  if(windows.fiveHour!==null && windows.weekly!==null)return {
    mode:'dual',fiveHour:windows.fiveHour,weekly:windows.weekly,
  };
  if(windows.weekly!==null)return {mode:'single',kind:'weekly',value:windows.weekly};
  if(windows.fiveHour!==null)return {mode:'single',kind:'fiveHour',value:windows.fiveHour};
  if(windows.other!==null)return {mode:'single',kind:'other',value:windows.other};
  return {mode:'unavailable'};
}
module.exports = { connectedSubscriptions, connectedApiKeys, availableApiBudgets, minimumRemaining,
  indicatorAccount,indicatorValue,classifyWindow,indicatorWindows,indicatorPresentation,browserBalanceFor };

