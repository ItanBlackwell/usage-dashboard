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
const DAY_MS=86400000;
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
function statsOwner(client){
  const sdk=typeof client==='function'?client():client;
  return typeof sdk?.experimental?.session?.stats==='function'?sdk.experimental.session:sdk?.session;
}
async function readRange(owner,providerFor,from,to){
  if(typeof owner?.stats!=='function'||!Number.isSafeInteger(to)||to<=from)return null;
  const controller=new AbortController();
  let timer;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('local_stats_timeout'));},5000);});
    const raw=await Promise.race([Promise.resolve().then(()=>owner.stats({from,to,timezone:'UTC',tools:'none'},{signal:controller.signal})),timeout]);
    return {from,to,rows:parseStats(raw,providerFor)};
  }catch{return null;}
  finally{clearTimeout(timer);controller.abort();}
}
async function readLocalUsage(client,providerFor,now=Date.now()){
  const out={today:null,month:null};
  try{
    const owner=statsOwner(client);
    await Promise.all(periods.map(async period=>{
      out[period]=await readRange(owner,providerFor,periodStart(period,now),now);
    }));
  }catch{/* Older SDKs may not expose statistics. */}
  return cleanLocalUsage(out);
}
// Store only the six completed UTC days; the current day uses localUsage.today.
function cleanLocalWeek(value){
  const empty={checkedAt:0,days:[]};
  const at=value?.checkedAt;
  if(!Number.isSafeInteger(at)||at<=0||at>8640000000000000||!Array.isArray(value.days)||value.days.length>6)return empty;
  const today=periodStart('today',at),byDay=new Map();
  for(const item of value.days){
    const row=cleanLocalUsage({today:item}).today;
    if(!row||row.from<today-6*DAY_MS||row.from>=today||row.to!==row.from+DAY_MS-1)continue;
    byDay.set(row.from,row);
  }
  return {checkedAt:at,days:[...byDay.values()].sort((a,b)=>a.from-b.from)};
}
async function readLocalWeek(client,providerFor,now=Date.now(),previous=null){
  if(!Number.isSafeInteger(now)||now<=0||now>8640000000000000)return cleanLocalWeek(null);
  const today=periodStart('today',now),old=cleanLocalWeek(previous);
  const ttl=old.days.length===6?3600000:300000;
  // Requery completed days hourly to reflect local history changes; retry
  // missing days no more than once per five minutes. No provider requests.
  if(old.checkedAt>0&&old.checkedAt<=now&&periodStart('today',old.checkedAt)===today&&now-old.checkedAt<ttl)return old;
  const days=[];
  try{
    const owner=statsOwner(client);
    if(typeof owner?.stats==='function'){
      const dates=Array.from({length:6},(_,i)=>today-(6-i)*DAY_MS);
      for(let i=0;i<dates.length;i+=3){
        const page=await Promise.all(dates.slice(i,i+3).map(from=>readRange(owner,providerFor,from,from+DAY_MS-1)));
        days.push(...page.filter(Boolean));
      }
    }
  }catch{/* A missing host method or malformed response is not zero spend. */}
  return cleanLocalWeek({checkedAt:now,days});
}
module.exports={DAY_MS,periodStart,parseStats,cleanLocalUsage,readLocalUsage,cleanLocalWeek,readLocalWeek};
