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
const billingPatterns=[billingPrefix+'*','https://opencode.ai/workspace/*/billing*','https://opencode.ai/console/*/settings/billing*'];
function sourceFor(raw){
  try{
    const u=new URL(raw);
    if(u.origin==='https://platform.openai.com'&&u.pathname==='/settings/organization/billing/overview')
      return {provider:'codex',page:billingPrefix};
    if(u.origin==='https://opencode.ai'&&/^\/(?:workspace\/[^/]+\/billing|console\/[^/]+\/settings\/billing)\/?$/.test(u.pathname))
      return {provider:'opencode',page:'https://opencode.ai/workspace/billing'};
  }catch{}
  return null;
}
let configPromise;
const pairing = () => configPromise ??= fetch(chrome.runtime.getURL('pairing.json'))
  .then(r => { if (!r.ok) throw new Error('not paired'); return r.json(); });
async function report(amount, sender) {
  const source=sourceFor(sender?.url);
  if (!source || sender.frameId!==0 || sourceFor(sender?.tab?.url)?.provider!==source.provider ||
    typeof amount !== 'number' || !Number.isFinite(amount) || amount < -1000000 || amount > 100000000) return 'invalid';
  // Do not alternate readings between unrelated open billing tabs.
  const tabs=await chrome.tabs.query({url:billingPatterns});
  if(tabs.filter(t=>sourceFor(t.url)?.provider===source.provider).length!==1)return 'multiple';
  const cfg = await pairing();
  const port = Number(cfg.port) || 18746;
  const response = await fetch(`http://127.0.0.1:${port}/v1/balance`, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-PV-Usage-Token':cfg.token},
    body:JSON.stringify({ balanceUsd:amount, currency:'USD', ...source }),
    cache:'no-store', credentials:'omit', redirect:'error',
  });
  if (!response.ok) throw new Error('local receiver unavailable');
  return 'ok';
}
const states={
  ok:['OK','Balance sent to Usage Dashboard','#287b53'],
  unavailable:['?','No unambiguous credit balance found on this page','#8a6a22'],
  multiple:['2+','Open only one billing tab per provider','#8a6a22'],
  error:['ERR','Local Usage Dashboard receiver unavailable; check pairing and restart OpenCode','#a43c3c'],
  invalid:['?','Unsupported billing page','#8a6a22']
};
async function badge(tabId,status){
  const [text,title,color]=states[status]||states.error;
  await Promise.all([chrome.action.setBadgeText({tabId,text}),chrome.action.setBadgeBackgroundColor({tabId,color}),chrome.action.setTitle({tabId,title})]).catch(()=>{});
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!sourceFor(sender?.url)||sender.frameId!==0||!Number.isInteger(sender.tab?.id))return;
  const valid=message?.type==='pv-balance'&&Object.keys(message).every(k=>['type','usd'].includes(k));
  const unavailable=message?.type==='pv-balance-unavailable'&&Object.keys(message).length===1;
  if(!valid&&!unavailable)return;
  void (async()=>{
    const status=unavailable?'unavailable':await report(message.usd,sender).catch(()=>{configPromise=undefined;return 'error';});
    await badge(sender.tab.id,status);
    reply({ok:status==='ok'||status==='unavailable'});
  })();
  return true;
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
  void chrome.tabs.query({url:billingPatterns}).then(tabs => {
    for (const tab of tabs) if (tab.id) {
      if (tab.active) void chrome.tabs.sendMessage(tab.id,{type:'pv-scan'}).catch(()=>{});
      else void chrome.tabs.reload(tab.id).catch(()=>{});
    }
  }).catch(()=>{});
});
