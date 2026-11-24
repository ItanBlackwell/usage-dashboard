/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const EMPTY = () => ({accounts:[],organizations:[],inventoryWarning:null,checkedAt:0,billingSessions:[]});
const BILLING_STATES=new Set(['connecting','awaiting_confirmation','confirmation_unavailable','ok','stale','choose_edge','choose_chrome','choose_browser','close_login_browser','page_detected','billing_page_missing','billing_page_ambiguous','billing_page_unavailable','login_required','balance_unavailable','runtime_missing','browser_missing','browser_error','browser_timeout','profile_busy','browser_access_denied','profile_error','disconnect_error']);
function sanitizeBillingSessions(value,accounts) {
  if(!Array.isArray(value))return [];
  const eligible=new Map(accounts.filter(a=>a.kind==='api'&&['codex','opencode'].includes(a.provider)&&a.message!=='login_required').map(a=>[a.id,a.provider]));
  const result=new Map();
  for(const s of value.slice(0,80)){
    if(!s||typeof s.id!=='string'||eligible.get(s.id)!==s.provider||!BILLING_STATES.has(s.state))continue;
    const valid=typeof s.amount==='number'&&Number.isFinite(s.amount)&&s.amount>=(s.provider==='opencode'?0:-1000000)&&s.amount<=100000000;
    const amount=valid&&['ok','stale','login_required','balance_unavailable','browser_missing','browser_error','browser_timeout','profile_busy','browser_access_denied','profile_error','runtime_missing'].includes(s.state)?s.amount:null;
    const checkedAt=amount!==null&&Number.isFinite(s.checkedAt)&&s.checkedAt>0?s.checkedAt:0;
    const safeId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(id);
    const browser=safeId(s.browser)?s.browser:null;
    const browserChoices=Array.isArray(s.browserChoices)?[...new Set(s.browserChoices.filter(safeId))].slice(0,40):[];
    result.set(s.id,{id:s.id,provider:s.provider,state:s.state,amount:checkedAt?amount:null,checkedAt,browser,browserChoices});
  }
  return [...result.values()];
}
const readInterval = (value, fallback=5) => Number.isInteger(value) && value>=1 && value<=120 ? value : fallback;
function cacheDirectory(env=process.env,home=os.homedir()) {
  return path.join(env.LOCALAPPDATA || path.join(home,'.cache'), 'usage-dashboard');
}
function sanitizeSnapshot(value) {
  const result = EMPTY();
  if (!value || typeof value !== 'object') return result;
  // Only public, already sanitized result fields. Never cache a credential,
  // refresh token, JWT, raw HTTP response, or admin key.
  if (Array.isArray(value.accounts)) result.accounts=value.accounts.slice(0,80).map(a=>({
    id:String(a.id||'').slice(0,120), provider:String(a.provider||'').slice(0,24),
    kind:String(a.kind||'').slice(0,24), label:String(a.label||'').slice(0,90),
    source:String(a.source||'').slice(0,30), active:!!a.active,
    state:String(a.state||'unavailable').slice(0,24),message:String(a.message||'').slice(0,64),
    balance:a.balance && ['balance','key_limit'].includes(a.balance.kind) && ['USD','CNY'].includes(a.balance.currency)
      && typeof a.balance.amount==='number' && Number.isFinite(a.balance.amount)
      ? {amount:a.balance.amount,currency:a.balance.currency,kind:a.balance.kind}:null,
    balances:Array.isArray(a.balances)?a.balances.slice(0,2).filter(b=>b && b.kind==='balance'
      && ['USD','CNY'].includes(b.currency) && typeof b.amount==='number' && Number.isFinite(b.amount))
      .map(b=>({amount:b.amount,currency:b.currency,kind:'balance'})):[],
    windows:Array.isArray(a.windows)?a.windows.slice(0,10).map(w=>({
      label:String(w.label||'').slice(0,40), usedPercent:Number(w.usedPercent)||0,
      remainingPercent:Number(w.remainingPercent)||0,
      resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt:null,
    })):[],credits:Number.isFinite(a.credits)?a.credits:null,
    checkedAt:Number.isFinite(a.checkedAt)?a.checkedAt:0,
  }));
  if (Array.isArray(value.organizations)) result.organizations=value.organizations.slice(0,16).map(o=>({
    id:String(o.id||'').slice(0,100),provider:String(o.provider||'').slice(0,24),
    label:String(o.label||'').slice(0,90),month:String(o.month||'').slice(0,10),
    state:String(o.state||'unavailable').slice(0,24), message:String(o.message||'').slice(0,64),
    usdSpent:Number.isFinite(o.usdSpent)?o.usdSpent:null,
    monthlyBudgetUsd:Number.isFinite(o.monthlyBudgetUsd)?o.monthlyBudgetUsd:null,
    usdRemainingBudget:Number.isFinite(o.usdRemainingBudget)?o.usdRemainingBudget:null,
    limitType:String(o.limitType||'custom').slice(0,24),
    checkedAt:Number.isFinite(o.checkedAt)?o.checkedAt:0,
  }));
  result.checkedAt=Number.isFinite(value.checkedAt)?value.checkedAt:0;
  result.inventoryWarning=typeof value.inventoryWarning==='string'?value.inventoryWarning.slice(0,64):null;
  result.billingSessions=sanitizeBillingSessions(value.billingSessions,result.accounts);
  return result;
}
function persistentMonitor(monitor,{directory=cacheDirectory(),settingsPath,clock=Date.now,intervalMinutes=5,onChange=()=>{}}={}) {
  const file=path.join(directory,'snapshot.json');
  let snapshot=EMPTY(), ready, timer, busy=null, writes=Promise.resolve();
  const activeOverrides=new Map();
  // OpenCode's credential inventory may lag behind a confirmed activation.
  // Do not let an older poll undo the latest local switch before it is reflected.
  const awaitingActiveAck=new Map();
  const ACTIVE_ACK_GRACE_MS=30000;
  const inform=()=>{try{onChange(sanitizeSnapshot(snapshot));}catch{}};
  const init=()=>ready??=(async()=>{
    try{snapshot=sanitizeSnapshot(JSON.parse(await fs.readFile(file,'utf8')));}catch{}
    inform();return snapshot;
  })();
  const write=()=>{
    const body=JSON.stringify(sanitizeSnapshot(snapshot));
    writes=writes.catch(()=>{}).then(async()=>{
      await fs.mkdir(directory,{recursive:true});
      const tmp=file+'.'+process.pid+'.tmp';
      await fs.writeFile(tmp,body,{encoding:'utf8',mode:0o600});
      await fs.rename(tmp,file);
    });
    return writes;
  };
  async function refresh(force=true) {
    await init();
    if(busy) return busy;
    busy=(async()=>{
      try {
        const next=await monitor.get(force);
        const previous=snapshot;
        const nextAccounts=Array.isArray(next.accounts)?next.accounts:[];
        const prevById=new Map(previous.accounts.map(a=>[a.id,a]));
        const unavailable=['credentials_unavailable','connections_unavailable','last_known_values'].includes(next.inventoryWarning);
        const incoming=(unavailable && !nextAccounts.length && previous.accounts.length)
          ? previous.accounts.map(a=>({...a,state:'stale'}))
          : nextAccounts.map(a=>{
            const prev=prevById.get(a.id);
            if(a.state!=='ok' && (!Array.isArray(a.windows)||!a.windows.length) && prev?.windows?.length)
              return {...prev,state:'stale'};
            if(a.state==='error' && !a.balance && prev?.balance &&
              prev.provider===a.provider && prev.kind===a.kind &&
              ['request_failed','rate_limited','invalid_payload','invalid_balance'].includes(a.message))
              return {...a,balance:prev.balance,balances:prev.balances,checkedAt:prev.checkedAt,state:'stale'};
            return a;
          });
        const accounts=incoming.map(a=>activeOverrides.has(a.provider)
          ? {...a,active:a.id===activeOverrides.get(a.provider)} : a);
        const orgs=(Array.isArray(next.organizations)?next.organizations:[]).map(o=>{
          const prev=previous.organizations.find(p=>p.id===o.id);
          return o.state!=='ok' && prev?.state==='ok' ? {...prev,state:'stale'} : o;
        });
        snapshot=sanitizeSnapshot({...next,accounts,organizations:orgs,billingSessions:previous.billingSessions});
        inform();
        await write();
      } catch {} finally {busy=null;}
      return snapshot;
    })();
    return busy;
  }
  const cached=async()=>{await init();return sanitizeSnapshot(snapshot);};
  const setBillingSession=async(id,provider,session)=>{
    await init();
    if(!snapshot.accounts.some(a=>a.id===id&&a.provider===provider&&a.kind==='api'&&a.message!=='login_required'))return sanitizeSnapshot(snapshot);
    const remaining=snapshot.billingSessions.filter(s=>s.id!==id);
    snapshot=sanitizeSnapshot({...snapshot,billingSessions:session?[...remaining,{...session,id,provider}]:remaining});
    inform();await write();return sanitizeSnapshot(snapshot);
  };
  // The server acknowledged activation. Update only the public active flags
  // immediately; quota refresh happens separately without blocking the popup.
  const markActive=async(id,provider)=>{
    await init();
    if(!snapshot.accounts.some(a=>a.id===id && a.provider===provider))
      throw new Error('account_not_connected');
    activeOverrides.set(provider,id);
    awaitingActiveAck.set(provider,{id,at:clock()});
    snapshot=sanitizeSnapshot({...snapshot,accounts:snapshot.accounts.map(a=>
      a.provider===provider ? {...a,active:a.id===id} : a)});
    inform();
    await write();
    return sanitizeSnapshot(snapshot);
  };
  // Read-only reconciliation for account switches made in OpenCode settings.
  // The credential values never leave Electron main and are never persisted.
  const syncActive=async credentials=>{
    await init();
    if(!Array.isArray(credentials)) return sanitizeSnapshot(snapshot);
    const state=new Map(credentials.filter(c=>c && typeof c.id==='string' &&
      typeof c.integrationID==='string' && typeof c.active==='boolean')
      .map(c=>[`${c.integrationID}:${c.id}`,c.active]));
    if(!state.size)return sanitizeSnapshot(snapshot);
    const guarded=new Set();
    for(const [provider,pending] of awaitingActiveAck){
      if(state.get(pending.id)===true || clock()-pending.at>=ACTIVE_ACK_GRACE_MS){
        awaitingActiveAck.delete(provider);
      }else{
        guarded.add(provider);
      }
    }
    let changed=false;
    const accounts=snapshot.accounts.map(a=>{
      if(guarded.has(a.provider)||!state.has(a.id)||a.active===state.get(a.id))return a;
      changed=true;return {...a,active:state.get(a.id)};
    });
    for(const a of accounts)if(!guarded.has(a.provider)&&a.active&&state.get(a.id)===true)
      activeOverrides.set(a.provider,a.id);
    if(changed){snapshot=sanitizeSnapshot({...snapshot,accounts});inform();await write();}
    return sanitizeSnapshot(snapshot);
  };
  const start=()=>{
    const interval=readInterval(intervalMinutes)*60_000;
    void init().then(()=>refresh(true));
    timer=setInterval(()=>void refresh(true),interval);timer.unref?.();
  };
  const stop=()=>{if(timer)clearInterval(timer);};
  return {cached,refresh,setBillingSession,markActive,syncActive,start,stop};
}
module.exports={EMPTY,readInterval,sanitizeSnapshot,cacheDirectory,persistentMonitor};
