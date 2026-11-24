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
// Only all-spend, non-model-specific budgets can describe the remaining
// general allowance. Overlapping policies constrain rather than add.
function tightestGeneralBudget(account,now=Date.now()){
  const rows=(account?.budgets||[]).filter(b=>b.coverage==='all'&&b.per==='set'&&
    Number.isFinite(b.remainingUsd)&&b.remainingUsd>=0&&Number.isFinite(b.resetsAt)&&b.resetsAt>now);
  return rows.reduce((best,b)=>!best||b.remainingUsd<best.remainingUsd?b:best,null);
}
// Inventory-only metadata is not a new balance measurement. Retain previously
// confirmed values only for the identical account while IPC is unavailable.
function mergeInventoryFallback(inventory,previous) {
  const current=Array.isArray(inventory?.accounts)?inventory.accounts:[];
  const prior=Array.isArray(previous?.accounts)?previous.accounts:[];
  const byId=new Map(prior.map(a=>[a.id,a]));
  const accounts=current.map(a=>{
    const p=byId.get(a.id);
    if(!p||p.provider!==a.provider||p.kind!==a.kind||p.source!==a.source||p.message==='login_required')return a;
    const known=Number.isFinite(p.balance?.amount)||(p.windows||[]).length||Number.isFinite(p.credits)||(p.budgets||[]).length;
    if(!known)return a;
    return {...a,active:p.active,balance:p.balance,balances:p.balances,windows:p.windows,
      credits:p.credits,budgets:(p.budgets||[]).filter(b=>b.resetsAt>Date.now()),
      budgetMessage:p.provider==='opencode'?'plugin_ipc_unavailable':null,
      checkedAt:p.checkedAt,state:'stale',message:'plugin_ipc_unavailable'};
  });
  const merged={accounts,organizations:inventory?.organizations||[],inventoryWarning:inventory?.inventoryWarning??null,checkedAt:inventory?.checkedAt??0};
  return merged;
}
function formatCurrency(amount,currency) {
  if(!Number.isFinite(amount)||!['USD','CNY'].includes(currency))return '—';
  return (currency==='CNY'?'¥':'$')+(amount===0?0:amount).toFixed(2);
}
function indicatorPresentation(account,snapshot) {
  if(!account)return {mode:'unavailable'};
  if(account.kind==='api'){
    const own=account.balance;
    // A key spending cap is NOT wallet money. Keep the ring unknown instead of
    // misrepresenting it as a prepaid balance.
    if(own?.kind==='balance' && Number.isFinite(own.amount))return {mode:'api',amount:own.amount,currency:own.currency};
    const budget=tightestGeneralBudget(account);
    if(budget)return {mode:'api',amount:budget.remainingUsd,currency:'USD',metric:'budget'};
    return {mode:'api',amount:null,currency:'USD'};
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
  indicatorAccount,indicatorValue,classifyWindow,indicatorWindows,indicatorPresentation,tightestGeneralBudget,formatCurrency,mergeInventoryFallback };

