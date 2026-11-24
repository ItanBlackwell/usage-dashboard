/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Documented beta organization analytics; a regular workspace API key may
// be denied. Read only through the exact already-connected credential.
// Never attribute organization-wide totals to one key.
const M=require('./provider-metrics.cjs');
const BASE='https://api.anthropic.com/v1/organizations/analytics/';
const MAX_PAGES=4;
const parsePage=(body,type)=>{
  if(!body||!Array.isArray(body.data)||body.data.length>1000||typeof body.has_more!=='boolean')
    throw new Error('invalid_payload');
  return body.data.map(row=>{
    if(!row||!row.group||typeof row.group!=='object')throw new Error('invalid_payload');
    const model=M.safeModel(row.group.model);
    if(type==='cost'){
      const n=M.num(row.cost?.amount);
      if(row.cost?.currency!=='USD'||n===null||Math.abs(n)>1e14)throw new Error('invalid_payload');
      return {model,cost:n/100};
    }
    const tokens=M.count(row.usage?.total_tokens),requests=M.count(row.usage?.requests);
    if(tokens===null||requests===null)throw new Error('invalid_payload');
    return {model,tokens,requests};
  });
};
async function read(type,entry,fetchSafe,fetcher,now){
  const url=new URL(BASE+type);
  const date=new Date(now),start=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
  url.searchParams.set('starting_at',start.toISOString());
  url.searchParams.set('ending_at',new Date(Math.max(now,start.getTime()+1000)).toISOString());
  url.searchParams.set('limit','100');
  url.searchParams.append('group_by[]','model');
  const headers={'x-api-key':entry.apiKey,Accept:'application/json',
    'anthropic-version':'2026-10-21','anthropic-beta':'analytics-usage-cost-2026-08-24'};
  const rows=[],pages=new Set();
  let refreshedAt=null;
  for(let i=0;i<MAX_PAGES;i++){
    const body=await fetchSafe(url.toString(),headers,fetcher);
    // The service explicitly uses null plus an empty list when data is
    // not ready. Never report this as a confirmed zero.
    const refreshed=typeof body?.data_refreshed_at==='string'?Date.parse(body.data_refreshed_at):NaN;
    if(!Number.isFinite(refreshed)||refreshed<start.getTime())throw Error('not_returned');
    if(refreshedAt!==null&&refreshedAt!==refreshed)throw Error('invalid_payload');
    refreshedAt=refreshed;
    rows.push(...parsePage(body,type));
    if(!body.has_more){
      // A valid complete report is required before summing. Unattributed or
      // unrecognized model rows still contribute to the organization total.
      const totals={},models=new Map();
      for(const row of rows){
        for(const field of type==='cost'?['cost']:['tokens','requests']){
          totals[field]=(totals[field]??0)+row[field];
          if(row.model){
            const m=models.get(row.model)||{};
            m[field]=(m[field]??0)+row[field];models.set(row.model,m);
          }
        }
      }
      const empty=type==='cost'?{cost:0}:{tokens:0,requests:0};
      const metrics=[];
      const push=(code,val,model=null)=>{const m=M.metric(code,val,{currency:code.endsWith('cost')?'USD':null,model,at:refreshedAt});if(!m)throw Error('invalid_payload');metrics.push(m);};
      for(const [field,value] of Object.entries({...empty,...totals}))push('org_month_'+field,value);
      const ranked=[...models].sort((a,b)=>(b[1].cost??b[1].tokens??0)-(a[1].cost??a[1].tokens??0));
      for(const [model,values] of ranked.slice(0,16))for(const [field,value] of Object.entries(values))push('org_model_'+field,value,model);
      return metrics;
    }
    const next=body.next_page;
    if(typeof next!=='string'||!next||next.length>1024||pages.has(next))throw Error('invalid_payload');
    pages.add(next);url.searchParams.set('page',next);
  }
  throw Error('invalid_payload');
}
async function query(entry,fetchSafe,fetcher,now){
  if(!entry.apiKey)return {state:'unavailable',message:'credential_not_readable',notices:[{group:'usage',status:'credential_not_readable'}]};
  const results=await Promise.allSettled([read('cost',entry,fetchSafe,fetcher,now),read('usage',entry,fetchSafe,fetcher,now)]);
  const notices=[{group:'balance',status:'unsupported'},{group:'budget',status:'unsupported'}];
  const metrics=[];
  for(let i=0;i<results.length;i++){
    const r=results[i],group=i===0?'cost':'tokens';
    if(r.status==='fulfilled'){metrics.push(...r.value);notices.push({group,status:'experimental'});}
    else notices.push({group,status:M.reason(r.reason)});
  }
  return {state:metrics.length?'ok':'error',message:'no_usage_endpoint',metrics,notices};
}
module.exports={query,parsePage};
