/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Experimental additions on the existing Kimi Code endpoint only. The
// managed CLI's separate OAuth service is deliberately not contacted.
const M=require('./provider-metrics.cjs');
function parseExtras(body,existing,timestamp){
  const windows=[...existing],metrics=[],notices=[];
  const modern=body?.code===0&&body?.data?.kind==='ok'?body.data.quota:null;
  const source=modern?.usages||body?.usages;
  // Prefer legacy enforced counters to summary ratios if both are present.
  // New ratios have been reported as zero despite active use; do not replace
  // measured windows with them, and label summary-only data experimental.
  for(const [keys,label] of [
    [['limit5h','limit_5h'],'5-hour'],[['limit7d','limit_7d'],'Weekly'],
    [['monthTotal','limit_month_total'],'Monthly'],[['monthCode','limit_month_code'],'Monthly · Code']
  ]){
    if(windows.some(w=>w.label===label))continue;
    const item=keys.map(k=>source?.[k]).find(v=>v&&typeof v==='object');
    const used=item?.usedRatio??item?.used_ratio;
    if(typeof used!=='number'||!Number.isFinite(used)||used<0||used>1)continue;
    // A zero from the summary-only 5h/weekly field is not reliable enough.
    if(used===0&&(label==='5-hour'||label==='Weekly'))continue;
    windows.push({label,usedPercent:used*100,remainingPercent:(1-used)*100,resetsAt:timestamp(item.resetAt??item.reset_time)});
    if(!notices.some(n=>n.group==='quota'))notices.push({group:'quota',status:'experimental'});
  }
  const parallel=M.metric('plan_parallel',body?.parallel?.limit);
  if(parallel)metrics.push(parallel);
  const x=modern?.extraUsage??body?.extraUsage??body?.extra_usage;
  let extraCount=0;
  const currency=x?.currency;
  if(x&&['USD','CNY'].includes(currency)){
    for(const [field,alt,code] of [['balanceCents','balance_cents','extra_balance'],['totalCents','total_cents','extra_total'],
      ['monthlyUsedCents','monthly_used_cents','extra_month_used'],['monthlyChargeLimitCents','monthly_charge_limit_cents','extra_month_limit']]){
      if(code==='extra_month_limit'&&(x.monthlyChargeLimitEnabled??x.monthly_charge_limit_enabled)!==true)continue;
      const value=code==='extra_balance'?M.num(x[field]??x[alt]):M.nonnegative(x[field]??x[alt]);
      if(value!==null){const row=M.metric(code,value/100,{currency});if(row){metrics.push(row);extraCount++;}}
    }
  }
  if(!extraCount)notices.push({group:'extra',status:'not_returned'});
  else notices.push({group:'extra',status:'experimental'});
  if(!windows.length)notices.push({group:'quota',status:'missing_windows'});
  return {windows,metrics,notices};
}
module.exports={parseExtras};
