/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Shared public-safe financial/usage metric contract. Never carry raw response
// objects, labels, credential IDs, private workspace names, or error text.
const SPEC=Object.freeze({
  topped_up:'money',granted:'money',cash:'money',voucher:'money',
  key_daily:'money',key_weekly:'money',key_monthly:'money',key_total:'money',
  byok_daily:'money',byok_weekly:'money',byok_monthly:'money',byok_total:'money',
  wallet_total_credits:'money',wallet_total_usage:'money',
  org_month_cost:'money',org_model_cost:'money',org_month_tokens:'count',org_month_requests:'count',
  org_model_tokens:'count',org_model_requests:'count',
  extra_balance:'money',extra_total:'money',extra_month_used:'money',extra_month_limit:'money',
  model_tokens_24h:'count',model_requests_24h:'count',tokens_24h:'count',requests_24h:'count',
  search_24h:'count',web_read_24h:'count',zread_24h:'count',tool_calls_24h:'count',
  grant_remaining:'money',grant_used:'money',
  plan_parallel:'count'
});
const GROUPS=new Set(['balance','budget','usage','cost','tokens','extra','tools','grants','breakdown','quota']);
const STATUSES=new Set(['unsupported','forbidden','unauthorized','rate_limited','request_failed','invalid_payload','invalid_balance','missing_windows','missing_rate_limits','no_limit','no_balance_access','no_prepaid_balance','not_returned','no_budgets','experimental','insufficient_balance','login_expired','credential_not_readable','workspace_required','unsupported_console','plugin_ipc_unavailable','stale','quota_unavailable']);
const num=x=>(typeof x==='number'||typeof x==='string'&&x.trim()!=='')&&Number.isFinite(Number(x))?Number(x):null;
const nonnegative=x=>{const n=num(x);return n!==null&&n>=0&&n<=1e12?n:null;};
const count=x=>{const n=num(x);return Number.isSafeInteger(n)&&n>=0&&n<=1e15?n:null;};
function safeModel(value){
  // Allow known provider model identifiers, not arbitrary strings from a
  // response (e.g. an account label, API key, email or user-defined name).
  if(typeof value!=='string'||value.length>80||!/^(?:claude[-_]|glm[-_]|minimax[-_]|coding-plan|kimi[-_]|moonshot[-_]|deepseek[-_])[A-Za-z0-9_.-]*$/i.test(value))return null;
  return value;
}
function metric(code,value,{currency=null,model=null,at=null}={}){
  const unit=SPEC[code];
  if(!Object.hasOwn(SPEC,code)||!unit)return null;
  const n=unit==='count'?count(value):num(value);
  if(n===null||Math.abs(n)>1e15||unit==='money'&&!['USD','CNY'].includes(currency)||
    unit==='money'&&Math.abs(n)>1e12||unit==='money'&&n<0&&!['cash','topped_up','org_month_cost','org_model_cost','extra_balance'].includes(code)||
    unit==='date'&&(!Number.isSafeInteger(n)||n<=0||n>8640000000000000))return null;
  const name=model===null?null:safeModel(model);
  if(model!==null&&!name)return null;
  if(['org_model_cost','org_model_tokens','org_model_requests','model_tokens_24h','model_requests_24h'].includes(code)&&!name)return null;
  return {code,value:n===0?0:n,currency:unit==='money'?currency:null,model:name,
    at:Number.isFinite(at)&&at>0&&at<=8640000000000000?at:null};
}
function cleanMetrics(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,120).flatMap(r=>{
    if(!r||typeof r.value!=='number')return [];
    const m=metric(r.code,r.value,{currency:r.currency??null,model:r.model??null,at:r.at??null});
    return m?[m]:[];
  });
}
function cleanNotices(rows){
  if(!Array.isArray(rows))return [];
  const seen=new Set();
  return rows.slice(0,24).filter(r=>r&&GROUPS.has(r.group)&&STATUSES.has(r.status))
    .filter(r=>{const key=r.group+':'+r.status;if(seen.has(key))return false;seen.add(key);return true;})
    .map(r=>({group:r.group,status:r.status}));
}
function cleanKeyBudget(v){
  if(!v||typeof v!=='object')return null;
  const n=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12?x:null;
  const date=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0&&x<=8640000000000000?x:null;
  const period=['daily','weekly','monthly','none'].includes(v.period)?v.period:null;
  return {limit:n(v.limit),remaining:n(v.remaining),period,resetsAt:date(v.resetsAt),expiresAt:date(v.expiresAt),
    includeByok:typeof v.includeByok==='boolean'?v.includeByok:null,freeTier:typeof v.freeTier==='boolean'?v.freeTier:null};
}
function reason(error){return STATUSES.has(error?.message)?error.message:'request_failed';}
module.exports={SPEC,metric,cleanMetrics,cleanNotices,cleanKeyBudget,nonnegative,count,num,safeModel,reason};
