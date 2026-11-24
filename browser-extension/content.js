/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';
(() => {
  const provider=location.origin==='https://platform.openai.com' &&
    location.pathname==='/settings/organization/billing/overview'?'codex':
    location.origin==='https://opencode.ai' && /^\/workspace\/[^/]+\/billing\/?$/.test(location.pathname)?'opencode':null;
  if(!provider)return;
  const isVisible = el => !!el && el.nodeType === 1 && !el.closest('button,input,script,style') &&
    getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const amount = text => {
    const matches = String(text || '').match(/(?:\$|USD\s*)\s*(-?[\d,]+(?:\.\d{1,2})?)/ig) || [];
    if (matches.length !== 1) return null; // refuse ambiguous payment pages
    const n = Number(matches[0].replace(/(?:\$|USD\s*)/ig,'').replaceAll(',','').trim());
    return Number.isFinite(n) && n >= -1000000 && n <= 100000000 ? n : null;
  };
  function readBalance() {
    const els = Array.from(document.querySelectorAll('main *, [role="main"] *'));
    const labelPattern=provider==='opencode'
      ? /^(?:credit\s+balance|prepaid\s+balance|available\s+credit|balance)$/i
      : /^(?:credit\s+balance|prepaid\s+balance|available\s+credit)$/i;
    const labels = els.filter(el => isVisible(el) && el.children.length <= 2 &&
      labelPattern.test((el.innerText || '').trim()));
    const values=new Set();
    for (const el of labels) {
      const near = [el.nextElementSibling, el.parentElement?.nextElementSibling,
        el.parentElement, el.parentElement?.parentElement];
      for (const candidate of near) {
        if (!isVisible(candidate)) continue;
        const text = (candidate.innerText || '').trim();
        // A nearby section should be small and contain a SINGLE monetary figure.
        if (text.length > 240) continue;
        const found = amount(text);
        if (found !== null) {values.add(found);break;}
      }
    }
    return values.size===1?[...values][0]:null;
  }
  let lastValue = null, lastSent = 0, queued = null;
  function scan() {
    const value = readBalance();
    if (value === null) return;
    const time = Date.now();
    if (value === lastValue && time - lastSent < 30_000) return;
    lastValue = value; lastSent = time;
    chrome.runtime.sendMessage({type:'pv-balance',usd:value}).catch(()=>{});
  }
  const schedule = () => { if (queued) return; queued = setTimeout(() => { queued=null; scan(); }, 700); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'pv-scan') scan(); });
  schedule();
  setInterval(scan, 30_000);
})();
