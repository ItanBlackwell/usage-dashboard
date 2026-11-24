/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// The official Token Plan endpoint reports remaining counts. Do not use
// the legacy coding-plan endpoint with its different count semantics.
const M=require('./provider-metrics.cjs');
function parse(body,timestamp,measuredWindow){
  if(body?.base_resp?.status_code!==undefined&&M.num(body.base_resp.status_code)!==0){
    const code=M.num(body.base_resp.status_code);
    throw Error([1004,2049,2057].includes(code)?'forbidden':code===2062?'missing_windows':'invalid_payload');
  }
  const rows=Array.isArray(body?.model_remains)?body.model_remains:[];
  if(!rows.length)throw Error('missing_windows');
  const byModel=new Map();
  for(const row of rows.slice(0,80)){
    const raw=row?.model_name??row?.model;
    // Only display known public model names or fixed category names.
    const model=M.safeModel(raw)||(['general','chat','text','image','video','speech','audio','search'].includes(String(raw).toLowerCase())?String(raw).toLowerCase():null);
    if(!model)continue;
    const windows=[];
    for(const [prefix,label] of [['current_interval','5-hour'],['current_weekly','Weekly']]){
      if(M.num(row[prefix+'_status'])===3)continue;
      const total=M.num(row[prefix+'_total_count']),remaining=M.num(row[prefix+'_usage_count']);
      const explicit=prefix==='current_weekly'?row.current_weekly_end_time??row.weekly_end_time:row.current_interval_end_time??row.end_time;
      let win=total!==null&&total>0&&remaining!==null?measuredWindow(label,total,remaining,explicit):null;
      const percent=M.num(row[prefix+'_remaining_percent']);
      if(!win&&total!==0&&percent!==null&&percent>=0&&percent<=100)win={label,usedPercent:100-percent,remainingPercent:percent,resetsAt:timestamp(explicit)};
      if(win)windows.push(win);
    }
    if(windows.length&&!byModel.has(model))byModel.set(model,windows);
  }
  const text=[...byModel].filter(([name])=>/^(?:general|chat|text)$|^minimax-m|^coding-plan/i.test(name));
  // The main gauge describes text/chat limits only; no video pool is used
  // as a substitute for the absence of a text allowance.
  const windows=[];
  for(const label of ['5-hour','Weekly']){
    const candidates=text.flatMap(([,wins])=>wins.filter(w=>w.label===label));
    if(candidates.length)windows.push(candidates.reduce((x,y)=>y.remainingPercent<x.remainingPercent?y:x));
  }
  const modelWindows=[...byModel].flatMap(([model,wins])=>wins.map(w=>({...w,model}))).slice(0,40);
  if(!windows.length&&!modelWindows.length)throw Error('missing_windows');
  return {windows,modelWindows,credits:null,notices:[{group:'balance',status:'unsupported'},
    ...(!windows.length?[{group:'quota',status:'missing_windows'}]:[])]};
}
module.exports={parse};
