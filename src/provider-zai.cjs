/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Experimental monitor routes used by the provider's own coding usage tool.
// All hosts and paths are fixed. Keep each optional response independent.
const M=require('./provider-metrics.cjs');
function data(body){
  if(body?.success!==true||!body.data||typeof body.data!=='object')throw Error('invalid_payload');
  return body.data;
}
function modelMetrics(body){
  const d=data(body),total=d.totalUsage,rows=[];
  const add=(code,v,model=null)=>{const m=M.metric(code,v,{model});if(m)rows.push(m);};
  add('tokens_24h',total?.totalTokensUsage);add('requests_24h',total?.totalModelCallCount);
  // The same summary can appear twice. Read a single source; do not sum copies.
  const summary=Array.isArray(d.modelSummaryList)?d.modelSummaryList:total?.modelSummaryList;
  const seen=new Set();
  for(const item of Array.isArray(summary)?summary.slice(0,40):[]){
    const name=M.safeModel(item?.modelName);
    if(!name||seen.has(name))continue;
    seen.add(name);add('model_tokens_24h',item.totalTokens,name);
    add('model_requests_24h',item.totalModelCallCount,name);
  }
  if(!rows.length)throw Error('invalid_payload');
  return rows;
}
function toolMetrics(body){
  const d=data(body),total=d.totalUsage,rows=[];
  for(const [field,code] of [['totalNetworkSearchCount','search_24h'],['totalWebReadMcpCount','web_read_24h'],['totalZreadMcpCount','zread_24h'],['totalSearchMcpCount','tool_calls_24h']]){
    const m=M.metric(code,total?.[field]);if(m)rows.push(m);
  }
  if(!rows.length)throw Error('invalid_payload');
  return rows;
}
function grantMetrics(body,now){
  // This undocumented endpoint has no stable public schema. Accept only
  // an explicit currency and amount/used amount/expiry in a recognized list.
  // Never translate unspecified units or aggregate grants into wallet money.
  if(body?.success===false||body?.code!==undefined&&![0,200].includes(body.code))throw Error('invalid_payload');
  const grants=Array.isArray(body?.data)?body.data:Array.isArray(body?.data?.credit_grants)?body.data.credit_grants:body?.credit_grants;
  if(!Array.isArray(grants)||grants.length>100||body?.has_more===true||body?.data?.has_more===true)throw Error('invalid_payload');
  const rows=[];
  for(const v of grants){
    const total=M.nonnegative(v?.amount),used=M.nonnegative(v?.used_amount),currency=v?.currency;
    const at=typeof v?.expire_at==='string'?Date.parse(v.expire_at):null;
    if(total===null||used===null||used>total||!['USD','CNY'].includes(currency)||!Number.isFinite(at)||at<=0)throw Error('invalid_payload');
    if(at<=now)continue;
    rows.push(M.metric('grant_remaining',total-used,{currency,at}),M.metric('grant_used',used,{currency,at}));
  }
  return rows.filter(Boolean);
}
async function query(entry,fetchSafe,fetcher,now,parseQuota){
  const cn=entry.integrationID.startsWith('zhipuai')||entry.integrationID==='zai-cn-coding-plan';
  const host=cn?'https://open.bigmodel.cn':'https://api.z.ai';
  const token=entry.apiKey||entry.access;
  const raw={Authorization:token,Accept:'application/json','Accept-Language':'en-US,en'};
  const bearer={...raw,Authorization:'Bearer '+token};
  // Preserve the previously working bearer quota request. The monitor
  // script uses the raw token; retry that form only on auth failure.
  const monitor=async(path,params='',preferRaw=true)=>{
    const url=host+'/api/monitor/usage/'+path+params;
    try{return await fetchSafe(url,preferRaw?raw:bearer,fetcher);}
    catch(e){if(!['unauthorized','forbidden'].includes(e?.message))throw e;
      return fetchSafe(url,preferRaw?bearer:raw,fetcher);}
  };
  const wall=ms=>new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');
  const params='?startTime='+encodeURIComponent(wall(now-86400000))+'&endTime='+encodeURIComponent(wall(now));
  const jobs=[
    monitor('quota/limit','',false).then(parseQuota),
    monitor('model-usage',params).then(modelMetrics),
    monitor('tool-usage',params).then(toolMetrics),
    fetchSafe(host+'/api/paas/v4/user/credit_grants',bearer,fetcher).then(x=>grantMetrics(x,now))
  ];
  const results=await Promise.allSettled(jobs),metrics=[],notices=[{group:'balance',status:'unsupported'},{group:'budget',status:'unsupported'}];
  let windows=[],quotaMessage='no_usage_endpoint';
  // Monitor cost units and subscription billing semantics are not stable.
  // Do not manufacture a monetary cost from token counts.
  notices.push({group:'cost',status:'not_returned'});
  for(let i=0;i<results.length;i++){
    const group=['quota','usage','tools','grants'][i],r=results[i];
    if(r.status==='fulfilled'){
      if(i===0){windows=r.value.windows;quotaMessage='experimental_quota';}
      else metrics.push(...r.value);
      notices.push({group,status:i===3&&!r.value.length?'not_returned':'experimental'});
    }else{
      const status=M.reason(r.reason);
      notices.push({group,status});
      if(i===0)quotaMessage=status;
    }
  }
  return {state:windows.length||metrics.length?'ok':'error',kind:windows.length?'subscription':entry.kind,
    message:quotaMessage,windows,metrics,notices,credits:null};
}
module.exports={query,modelMetrics,toolMetrics,grantMetrics};
