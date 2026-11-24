/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Host statistics describe local usage, not provider billing or credentials.
const providers=new Set(['codex','claude','gemini','deepseek','kimi','qwen','zai','openrouter','minimax','opencode','opencode-go']);
const periods=['today','month'];
const money=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12?n:null;
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
function periodStart(period,time){
  const d=new Date(time);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),period==='today'?d.getUTCDate():1);
}
function totalTokens(t){
  const values=[t?.input,t?.output,t?.reasoning,t?.cache?.read,t?.cache?.write];
  return values.every(v=>count(v)!==null)?count(values.reduce((sum,v)=>sum+v,0)):null;
}
function parseStats(raw,providerFor){
  const data=raw?.data?.data??raw?.data??raw;
  if(!Array.isArray(data?.models)||data.models.length>10000)throw Error('invalid_local_stats');
  const grouped=new Map();
  for(const item of data.models){
    const id=item?.model?.providerID;
    if(typeof id!=='string')throw Error('invalid_local_stats');
    const provider=providerFor(id);
    if(!providers.has(provider))continue;
    const row={provider,cost:money(item.cost),tokens:totalTokens(item.tokens),steps:count(item.steps)};
    const previous=grouped.get(provider);
    if(previous)for(const [key,validate] of [['cost',money],['tokens',count],['steps',count]])
      row[key]=previous[key]===null||row[key]===null?null:validate(previous[key]+row[key]);
    grouped.set(provider,row);
  }
  return [...grouped.values()];
}
function cleanLocalUsage(value){
  const out={today:null,month:null};
  for(const period of periods){
    const v=value?.[period];
    if(!v||!Number.isSafeInteger(v.from)||!Number.isSafeInteger(v.to)||v.from<=0||v.to<=v.from||
      v.to>8640000000000000||v.from!==periodStart(period,v.to)||!Array.isArray(v.rows)||v.rows.length>providers.size)continue;
    const seen=new Set(),rows=[];
    for(const row of v.rows){
      if(!providers.has(row?.provider)||seen.has(row.provider)){rows.length=0;break;}
      seen.add(row.provider);
      rows.push({provider:row.provider,cost:money(row.cost),tokens:count(row.tokens),steps:count(row.steps)});
    }
    if(rows.length!==v.rows.length)continue;
    out[period]={from:v.from,to:v.to,rows};
  }
  return out;
}
async function readLocalUsage(client,providerFor,now=Date.now()){
  const out={today:null,month:null};
  try{
    const sdk=typeof client==='function'?client():client;
    const owner=typeof sdk?.experimental?.session?.stats==='function'?sdk.experimental.session:sdk?.session;
    if(typeof owner?.stats!=='function')return out;
    await Promise.all(periods.map(async period=>{
      const from=periodStart(period,now);
      if(!Number.isSafeInteger(now)||now<=from)return;
      const controller=new AbortController();
      let timer;
      try{
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('local_stats_timeout'));},5000);});
        const raw=await Promise.race([Promise.resolve().then(()=>owner.stats({from,to:now,timezone:'UTC',tools:'none'},{signal:controller.signal})),timeout]);
        out[period]={from,to:now,rows:parseStats(raw,providerFor)};
      }catch{/* Unknown on failure; never invent or carry forward a period. */}
      finally{clearTimeout(timer);controller.abort();}
    }));
  }catch{/* Older SDKs may not expose statistics. */}
  return cleanLocalUsage(out);
}
module.exports={periodStart,parseStats,cleanLocalUsage,readLocalUsage};
