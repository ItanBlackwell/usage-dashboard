/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';
const {periodStart,DAY_MS}=require('./local-usage.cjs');

const windows={fiveHour:'5-hour',weekly:'Weekly'};
const periods=['today','month'];
const time=n=>Number.isSafeInteger(n)&&n>0&&n<=8640000000000000;
const percent=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e9;
const eligible=a=>a?.provider==='codex'&&a.kind==='subscription'&&a.source==='OpenCode'&&
  a.message!=='login_required'&&typeof a.id==='string'&&a.id.length>0&&a.id.length<=120;

function cleanBaseline(b){
  return b&&time(b.at)&&time(b.resetsAt)&&b.resetsAt>b.at&&percent(b.peak)
    ?{at:b.at,resetsAt:b.resetsAt,peak:b.peak}:null;
}
function cleanPeriod(p,period){
  return p&&time(p.from)&&time(p.to)&&p.to>p.from&&p.from===periodStart(period,p.to)&&amount(p.amount)
    ?{from:p.from,to:p.to,amount:p.amount}:null;
}
function cleanDays(days){
  const byDay=new Map();
  for(const value of days){
    const day=cleanPeriod(value,'today');
    if(day&&(!byDay.has(day.from)||byDay.get(day.from).to<=day.to))byDay.set(day.from,day);
  }
  return [...byDay.values()].sort((a,b)=>a.from-b.from).slice(-7);
}
function cleanWindow(w){
  const today=cleanPeriod(w?.today,'today');
  // Import the existing current-day aggregate when upgrading older snapshots.
  const daily=cleanDays([...(Array.isArray(w?.daily)&&w.daily.length<=7?w.daily:[]),today]);
  return {baseline:cleanBaseline(w?.baseline),today,month:cleanPeriod(w?.month,'month'),daily};
}
// Only existing connection IDs and bounded numeric aggregates are retained.
function cleanCodexUsage(value,accounts){
  if(!Array.isArray(value)||value.length>80)return [];
  const ids=new Set((accounts||[]).filter(eligible).map(a=>a.id)),seen=new Set(),rows=[];
  for(const row of value){
    if(!ids.has(row?.id)||seen.has(row.id))continue;
    seen.add(row.id);
    rows.push({id:row.id,fiveHour:cleanWindow(row.fiveHour),weekly:cleanWindow(row.weekly)});
  }
  return rows;
}
function sample(account,label,now){
  if(account.state!=='ok'||account.message!=='ok'||!time(account.checkedAt)||account.checkedAt>now)return null;
  const matches=(account.windows||[]).filter(w=>w?.label===label);
  if(matches.length!==1)return null;
  const w=matches[0];
  return percent(w.usedPercent)&&time(w.resetsAt)&&w.resetsAt>account.checkedAt
    ?{at:account.checkedAt,resetsAt:w.resetsAt,peak:w.usedPercent}:null;
}
function observe(previous,current,now){
  const out=cleanWindow(previous),today=periodStart('today',now);
  out.daily=out.daily.filter(d=>d.from>=today-6*DAY_MS&&d.from<=today&&d.to<=now);
  for(const period of periods){
    if(out[period]?.from!==periodStart(period,now)||out[period]?.to>now)out[period]=null;
  }
  const old=out.baseline;
  if(!current||(old&&current.at<=old.at))return out;
  let delta=null,since=null;
  if(old){
    // Tolerate second-resolution reset timestamps, never compare across expiry.
    if(current.at<old.resetsAt&&Math.abs(current.resetsAt-old.resetsAt)<=1000){
      if(current.peak>=old.peak){delta=current.peak-old.peak;since=old.at;}
      // A downward correction is not a refund or a reset. Keep the high-water
      // mark so its rebound cannot be counted twice.
      current={...current,peak:Math.max(current.peak,old.peak)};
    }else if(current.at>=old.resetsAt&&current.resetsAt>old.resetsAt){
      // Observe only the new window's use, never the unseen old-window tail.
      delta=current.peak;since=old.resetsAt;
    }
    // A moved reset time before expiry is ambiguous: start a new baseline.
  }
  out.baseline=current;
  if(delta!==null){
    for(const period of periods){
      const from=periodStart(period,now);
      // Do not allocate a delta across a UTC reporting boundary.
      if(since<from||current.at<=from)continue;
      const total=(out[period]?.amount??0)+delta;
      if(amount(total))out[period]={from,to:current.at,amount:total};
    }
  }
  out.daily=cleanDays([...out.daily,out.today]);
  return out;
}
function advanceCodexUsage(previous,accounts,inventoryWarning,now=Date.now()){
  if(!time(now))return cleanCodexUsage(previous,accounts);
  const existing=new Map(cleanCodexUsage(previous,accounts).map(row=>[row.id,row]));
  const seen=new Set(),rows=[];
  for(const account of (accounts||[]).filter(eligible).slice(0,80)){
    if(seen.has(account.id))continue;
    seen.add(account.id);
    const prior=existing.get(account.id),row={id:account.id};
    for(const [kind,label] of Object.entries(windows)){
      row[kind]=observe(prior?.[kind],inventoryWarning?null:sample(account,label,now),now);
    }
    rows.push(row);
  }
  return rows;
}
module.exports={cleanCodexUsage,advanceCodexUsage};
