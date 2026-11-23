/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';
// Only this extension service worker ever reads pairing.json. It never exposes
// the pairing token to the billing page's content-script context.
const billingPrefix = 'https://platform.openai.com/settings/organization/billing/overview';
let configPromise;
const pairing = () => configPromise ??= fetch(chrome.runtime.getURL('pairing.json'))
  .then(r => { if (!r.ok) throw new Error('not paired'); return r.json(); });
async function report(amount, sender) {
  if (!sender?.tab?.url?.startsWith(billingPrefix) ||
    typeof amount !== 'number' || !Number.isFinite(amount) || amount < -1000000 || amount > 100000000) return;
  const cfg = await pairing();
  const port = Number(cfg.port) || 18746;
  const response = await fetch(`http://127.0.0.1:${port}/v1/balance`, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-PV-Usage-Token':cfg.token},
    body:JSON.stringify({ balanceUsd:amount, currency:'USD', page:billingPrefix }),
    cache:'no-store', credentials:'omit', redirect:'error',
  });
  if (!response.ok) throw new Error('local receiver unavailable');
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'pv-balance' && Object.keys(message).every(k => ['type','usd'].includes(k)))
    void report(message.usd, sender).catch(() => {});
});
async function installAlarm() {
  const cfg = await pairing().catch(() => ({}));
  const minutes = Number.isFinite(cfg.refreshMinutes) && cfg.refreshMinutes >= 1 && cfg.refreshMinutes <= 120
    ? cfg.refreshMinutes : 15;
  await chrome.alarms.create('pv-usage-billing', {periodInMinutes:minutes});
}
chrome.runtime.onInstalled.addListener(() => void installAlarm());
chrome.runtime.onStartup.addListener(() => void installAlarm());
void installAlarm();
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'pv-usage-billing') return;
  // Only an already-open billing tab is refreshed. Never open hidden tabs or
  // interrupt a tab the user is currently interacting with.
  void chrome.tabs.query({url:'https://platform.openai.com/settings/organization/billing/overview*'}).then(tabs => {
    for (const tab of tabs) if (tab.id) {
      if (tab.active) void chrome.tabs.sendMessage(tab.id,{type:'pv-scan'}).catch(()=>{});
      else void chrome.tabs.reload(tab.id).catch(()=>{});
    }
  }).catch(()=>{});
});
