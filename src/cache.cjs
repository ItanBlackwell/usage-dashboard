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
const providerMetrics = require('./provider-metrics.cjs');

const localUsage = require('./local-usage.cjs');
const EMPTY = () => ({accounts:[],organizations:[],localUsage:{today:null,month:null},inventoryWarning:null,checkedAt:0});
const BUDGET_MESSAGES=new Set(['experimental_budget','no_budgets','unauthorized','forbidden','rate_limited','request_failed','invalid_payload','invalid_balance','unsupported_console','workspace_required','credential_not_readable','login_expired','login_required','plugin_ipc_unavailable']);
function sanitizeBudgets(value){
  if(!Array.isArray(value)||value.length>100)return [];
  const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e10;
  return value.filter(b=>b&&valid(b.limitUsd)&&(b.spentUsd===null||valid(b.spentUsd))&&
    ['each','combined'].includes(b.scope)&&['all','models'].includes(b.coverage)&&
    ['set','model'].includes(b.per)&&typeof b.shared==='boolean'&&Number.isFinite(b.resetsAt)&&b.resetsAt>0)
    .map(b=>({limitUsd:b.limitUsd,spentUsd:b.spentUsd,
      remainingUsd:b.spentUsd===null?null:Math.max(0,b.limitUsd-b.spentUsd),
      resetsAt:b.resetsAt,scope:b.scope,coverage:b.coverage,per:b.per,shared:b.shared}));
}
const readInterval = (value, fallback=5) => Number.isInteger(value) && value>=1 && value<=120 ? value : fallback;
function cacheDirectory(env=process.env,home=os.homedir()) {
  return path.join(env.LOCALAPPDATA || path.join(home,'.cache'), 'usage-dashboard');
}
function cleanWindows(rows,models=false){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,models?40:20).filter(w=>w&&typeof w.label==='string'&&
    typeof w.usedPercent==='number'&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&
    typeof w.remainingPercent==='number'&&Number.isFinite(w.remainingPercent)&&w.remainingPercent>=0&&w.remainingPercent<=100&&
    (!models||providerMetrics.safeModel(w.model)||['general','chat','text','image','video','speech','audio','search'].includes(w.model)))
    .map(w=>({label:w.label.slice(0,40),usedPercent:w.usedPercent,remainingPercent:w.remainingPercent,
      resetsAt:Number.isFinite(w.resetsAt)&&w.resetsAt>0?w.resetsAt:null,...(models?{model:w.model}:{})}));
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
    windows:cleanWindows(a.windows),credits:Number.isFinite(a.credits)?a.credits:null,
    budgets:a.provider==='opencode'&&a.kind==='api'?sanitizeBudgets(a.budgets):[],
    budgetMessage:a.provider==='opencode'&&BUDGET_MESSAGES.has(a.budgetMessage)?a.budgetMessage:null,
    metrics:providerMetrics.cleanMetrics(a.metrics),notices:providerMetrics.cleanNotices(a.notices),
    keyBudget:a.provider==='openrouter'?providerMetrics.cleanKeyBudget(a.keyBudget):null,
    modelWindows:a.provider==='minimax'?cleanWindows(a.modelWindows,true):[],
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
  result.localUsage=localUsage.cleanLocalUsage(value.localUsage);
  result.checkedAt=Number.isFinite(value.checkedAt)?value.checkedAt:0;
  result.inventoryWarning=typeof value.inventoryWarning==='string'?value.inventoryWarning.slice(0,64):null;
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
            if(a.state!=='ok' && (!Array.isArray(a.windows)||!a.windows.length) && prev?.windows?.length&&
              prev.provider===a.provider&&prev.kind===a.kind&&
              ['request_failed','rate_limited','invalid_payload','missing_windows','missing_rate_limits'].includes(a.message))
              return {...a,windows:prev.windows,modelWindows:prev.modelWindows,credits:prev.credits,checkedAt:prev.checkedAt,state:'stale'};
            // Do not resurrect a Console balance from a different workspace
            // or a previous permission grant after its current read failed.
            if(a.provider!=='opencode' && a.provider!=='openrouter' && a.state==='error' && !a.balance && prev?.balance &&
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
        snapshot=sanitizeSnapshot({...next,accounts,organizations:orgs});
        inform();
        await write();
      } catch {} finally {busy=null;}
      return snapshot;
    })();
    return busy;
  }
  const cached=async()=>{await init();return sanitizeSnapshot(snapshot);};
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
  return {cached,refresh,markActive,syncActive,start,stop};
}
module.exports={EMPTY,readInterval,sanitizeSnapshot,cacheDirectory,persistentMonitor};
