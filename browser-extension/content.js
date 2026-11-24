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
    location.origin==='https://opencode.ai' && /^\/(?:workspace\/[^/]+\/billing|console\/[^/]+\/settings\/billing)\/?$/.test(location.pathname)?'opencode':null;
  if(!provider)return;
  const isVisible = el => !!el && el.nodeType===1 && !el.closest('button,input,script,style,[hidden],[aria-hidden="true"]') &&
    el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
  const normalize = text => String(text??'').replace(/\s+/g,' ').trim();
  const amount = text => {
    const s=normalize(text);
    const m=s.match(/^(?:([-−]?)\s*(?:US\s*\$|\$|USD)\s*([-−]?)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|([-−]?)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*USD)$/i);
    if(!m || (m[1]&&m[2]))return null;
    const n=Number((m[3]||m[6]).replaceAll(',','')+'.'+(m[4]||m[7]||'0'))*(m[1]||m[2]||m[5]?-1:1);
    return Number.isFinite(n)&&n>=-1000000&&n<=100000000?n:null;
  };
  function readBalance() {
    const root=document.querySelector('main,[role="main"]')||document.body;
    const labels=provider==='opencode'
      ? /^(?:credit balance|prepaid balance|available credit(?:s)?|current balance|available balance|balance|credits)$/i
      : /^(?:credit balance|prepaid balance|available credit(?:s)?|current balance|available balance)$/i;
    const values=new Set();
    for(const el of root.querySelectorAll('div,span,p,dt,dd,h1,h2,h3,h4,h5,h6,strong,b,label')){
      if(!isVisible(el))continue;
      const text=normalize(el.innerText);
      const inline=text.match(/^(.+?)\s*[:：]?\s+((?:[-−]?\s*(?:US\s*\$|\$|USD)|[-−]?\s*\d).+)$/i);
      if(inline&&labels.test(inline[1].replace(/[:：]$/,''))){
        const n=amount(inline[2]);if(n!==null)values.add(n);
      }
      if(!labels.test(text.replace(/[:：]$/,'')))continue;
      for(const candidate of [el.nextElementSibling,el.parentElement?.nextElementSibling,el.parentElement]){
        if(!isVisible(candidate))continue;
        const s=normalize(candidate.innerText);
        const tail=s.toLowerCase().startsWith(text.toLowerCase())?s.slice(text.length).replace(/^\s*[:：]\s*/,''):s;
        const n=amount(tail);
        if(n!==null){values.add(n);break;}
      }
    }
    return values.size===1?[...values][0]:null;
  }
  let lastValue, lastSent=0, queued=null, sending=false;
  async function scan() {
    if(sending)return;
    const value=readBalance(),time=Date.now();
    if(value===lastValue&&time-lastSent<30_000)return;
    sending=true;
    try{
      const result=await chrome.runtime.sendMessage(value===null?{type:'pv-balance-unavailable'}:{type:'pv-balance',usd:value});
      if(result?.ok){lastValue=value;lastSent=time;}
    }catch{}finally{sending=false;}
  }
  const schedule = () => { if (queued) return; queued = setTimeout(() => { queued=null; scan(); }, 700); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'pv-scan') scan(); });
  schedule();
  setInterval(scan, 30_000);
})();
