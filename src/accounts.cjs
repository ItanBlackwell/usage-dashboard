/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// OpenCode V2 account discovery and multi-provider quotas. This module MUST run
// only inside the GUI plugin's Electron main() process. Never return a credential,
// key, token, raw server response or exception text through IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const base = require('./core.cjs');
const metrics = require('./provider-metrics.cjs');
const localUsage = require('./local-usage.cjs');
const claudeApi = require('./provider-claude.cjs');
const kimiExtras = require('./provider-kimi.cjs');
const zaiApi = require('./provider-zai.cjs');
const minimaxApi = require('./provider-minimax.cjs');

// Only explicit, first-party integration IDs are accepted. Generic OpenAI-compatible
// gateways MUST NOT be treated as any provider or receive its credentials.
const PROVIDER_IDS = Object.freeze({
  codex:['openai','codex','chatgpt','openai-chatgpt'],
  claude:['anthropic','claude','claude-agent','claude-code','anthropic-agent'],
  gemini:['google','google-ai','gemini','google-generative-ai'],
  deepseek:['deepseek'],
  kimi:['moonshotai','moonshotai-cn','moonshot','moonshot-cn','kimi','kimi-coding','kimi-for-coding'],
  qwen:['alibaba','dashscope','qwen','qwen-code'],
  zai:['zai','zai-coding-plan','zai-cn-coding-plan','zhipuai','zhipuai-coding-plan','glm'],
  openrouter:['openrouter'],
  opencode:['opencode'],
  'opencode-go':['opencode-go'],
  minimax:['minimax','minimax-cn','minimax-coding-plan','minimax-cn-coding-plan'],
});
const DISPLAY = Object.freeze({codex:'OpenAI',claude:'Claude',gemini:'Gemini',deepseek:'DeepSeek',
  kimi:'Kimi',qwen:'Qwen',zai:'Z.AI',openrouter:'OpenRouter',minimax:'MiniMax',
  opencode:'OpenCode','opencode-go':'OpenCode Go'});
const PROVIDER_ENV = Object.freeze({
  gemini:['GEMINI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'], deepseek:['DEEPSEEK_API_KEY'],
  kimi:['MOONSHOT_API_KEY','MOONSHOTAI_API_KEY','KIMI_API_KEY','KIMI_CODING_API_KEY'],
  qwen:['DASHSCOPE_API_KEY','QWEN_API_KEY'],zai:['ZAI_API_KEY','GLM_API_KEY','ZHIPUAI_API_KEY'],
  opencode:['OPENCODE_API_KEY'], 'opencode-go':['OPENCODE_GO_API_KEY','OPENCODE_API_KEY'],
  openrouter:['OPENROUTER_API_KEY'],minimax:['MINIMAX_API_KEY','MINIMAX_CN_API_KEY','MINIMAX_CODING_API_KEY'],
});
const CODEX_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CLAUDE_URL = 'https://api.anthropic.com/api/oauth/usage';
const ANTHROPIC_COSTS_URL = 'https://api.anthropic.com/v1/organizations/analytics/cost';
const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const OPENAI_SPEND_LIMIT_URL = 'https://api.openai.com/v1/organization/spend_limit';
const OPENCODE_CONSOLE = 'https://opencode.ai/console';
const MAX_ORGS = 12;
const MAX_PAGES = 15;
const MAX_ACCOUNTS = 60;
const nowMs = () => Date.now();
const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : null;
const string = x => typeof x === 'string' && x.trim() ? x.trim() : null;
const number = x => typeof x === 'number' || (typeof x === 'string' && x.trim()) ? (Number.isFinite(Number(x)) ? Number(x) : null) : null;
const arr = x => Array.isArray(x) ? x : Array.isArray(x?.data) ? x.data : Array.isArray(x?.items) ? x.items : Array.isArray(x?.data?.data) ? x.data.data : [];
const timestamp = x => {
  const n = number(x);
  if (n !== null) return n < 1e12 ? n * 1000 : n;
  if (typeof x === 'string') { const t = Date.parse(x); return Number.isFinite(t) ? t : null; }
  return null;
};
const fingerprint = token => crypto.createHash('sha256').update(token).digest('hex'); // main-process dedupe only
const safeLabel = (x, fallback) => {
  const label = string(x);
  if (!label || /^\s*(sk-[\w-]+|oc_sk_[\w-]+|Bearer\s+|eyJ[A-Za-z0-9_-]{24,})/.test(label)) return fallback;
  return label.replace(/[\x00-\x1f]/g, '').slice(0, 90);
};
function providerFor(integrationID) {
  const id = String(integrationID || '').toLowerCase();
  for (const [provider, ids] of Object.entries(PROVIDER_IDS)) if (ids.includes(id)) return provider;
  return null;
}
function isCodingPlan(id) {
  return /(?:^kimi-(?:for-)?coding$|coding-plan$)/.test(String(id || '').toLowerCase());
}
function classify(connection, cred) {
  const id=cred?.integrationID || connection?.integrationID;
  // Go is a subscription even when it is connected with an API key.
  const provider = providerFor(id);
  if (provider === 'opencode-go') return 'subscription';
  if (provider === 'opencode') return 'api';
  const type = cred?.value?.type || (connection?.type === 'env' ? 'key' : connection?.method);
  return type === 'oauth' || (type === 'external' && providerFor(id) === 'claude') || isCodingPlan(id)
    ? 'subscription' : 'api';
}
function keyFor(cred,conn,env,provider) {
  if(cred?.value?.type==='key') return string(cred.value.key);
  if(conn?.type==='env' && PROVIDER_ENV[provider]?.includes(conn.name)) return string(env?.[conn.name]);
  return null;
}
function consoleMetadata(credential){
  const m=object(credential?.value?.metadata);
  return {consoleServer:m?.server===undefined?null:typeof m.server==='string'?m.server:'invalid',
    consoleOrg:m?.orgID===undefined?null:typeof m.orgID==='string'?m.orgID:'invalid'};
}
function accountIdMeta(metadata) {
  const m = object(metadata);
  return string(m?.accountId) || string(m?.account_id) || string(m?.chatgptAccountId) || string(m?.chatgpt_account_id) || null;
}

// Strictly private objects include access tokens. Public metadata does not.
function collectAccounts(integrations, credentials, env = {}) {
  const connIndex = new Map();
  const selected = new Map();
  for (const integration of arr(integrations)) {
    const provider = providerFor(integration?.id);
    if (!provider) continue;
    for (const connection of arr(integration?.connections)) {
      const key = connection?.type === 'credential' ? connection.id : `env:${connection?.name || ''}`;
      if (key) connIndex.set(`${integration.id}:${key}`, { ...connection, provider, integrationID: integration.id });
    }
  }
  for (const cred of arr(credentials)) {
    const provider = providerFor(cred?.integrationID);
    if (!provider || !string(cred?.id)) continue;
    selected.set(`${cred.integrationID}:${cred.id}`, cred);
  }
  const results = [];
  const used = new Set();
  for (const [key, conn] of connIndex) {
    const cred = selected.get(key);
    const apiKey=keyFor(cred,conn,env,conn.provider);
    // A provider catalog entry is not an authenticated account. Never report
    // an unconfigured connection as a signed-in account.
    if (conn.status?.status === 'needs_auth' && !cred) continue;
    if (conn.type === 'credential' && !cred) continue; // Catalog status alone is not a stored login.
    if (conn.type === 'env' && !apiKey) continue; // An env slot is not a connection without a real key.
    if (conn.type === 'credential') used.add(key);
    results.push({ id: key, provider: conn.provider, kind: classify(conn, cred),
      label: safeLabel(conn.label || cred?.label, `${DISPLAY[conn.provider]} account`),
      source: 'OpenCode', active: cred?.active === true, needsAuth: conn.status?.status === 'needs_auth',
      access: cred?.value?.type === 'oauth' ? string(cred.value.access) : null, apiKey,
      expires: timestamp(cred?.value?.expires), integrationID:conn.integrationID, account: accountIdMeta(cred?.value?.metadata),
      tokenMethod: cred?.value?.type || conn.method || conn.type,
      ...(conn.provider==='opencode'?consoleMetadata(cred):{}),
      oauthMethod: string(cred?.value?.methodID),
      directSharing: Array.isArray(cred?.value?.metadata?.scopes) && cred.value.metadata.scopes.includes('chatgpt.tokens.use.direct'),
      externalMethod: string(cred?.value?.methodID),
    });
  }
  // Fallback for a V2 server that exposes credentials but not integrations.
  for (const [key, cred] of selected) {
    if (used.has(key)) continue;
    const provider = providerFor(cred.integrationID);
    results.push({ id: key, provider, kind: classify({}, cred),
      label: safeLabel(cred.label, `${DISPLAY[provider]} account`),
      source: 'OpenCode', active: cred.active === true, needsAuth: false,
      access: cred.value?.type === 'oauth' ? string(cred.value.access) : null, apiKey:keyFor(cred,null,env,provider),
      expires: timestamp(cred.value?.expires), integrationID:cred.integrationID, account: accountIdMeta(cred.value?.metadata),
      tokenMethod: cred.value?.type || 'unknown',
      ...(provider==='opencode'?consoleMetadata(cred):{}),
      oauthMethod: string(cred.value?.methodID),
      directSharing: Array.isArray(cred?.value?.metadata?.scopes) && cred.value.metadata.scopes.includes('chatgpt.tokens.use.direct'),
      externalMethod: string(cred.value?.methodID),
    });
  }
  // Dedupe only genuine repeated credential IDs, never accounts with distinct labels.
  return [...new Map(results.map(item => [item.id, item])).values()].slice(0, MAX_ACCOUNTS);
}

async function readLocalCli(home = os.homedir(), env = process.env, loader = fs.readFile, providers = ['codex','claude']) {
  const results = [];
  if (providers.includes('codex')) {
  const codexDir = path.isAbsolute(env.CODEX_HOME || '') ? env.CODEX_HOME : path.join(home, '.codex');
  try {
    const raw = JSON.parse(await loader(path.join(codexDir, 'auth.json'), 'utf8'));
    const parsed = base.parseCredential(raw, 'Codex CLI');
    if (parsed?.access) results.push({ id: 'cli:codex', provider: 'codex', kind: 'subscription', label: 'Codex CLI',
      source: 'Codex CLI', active: false, needsAuth: false, access: parsed.access,
      expires: parsed.expires, account: parsed.account, tokenMethod: 'oauth' });
  } catch { /* absent or invalid means not connected */ }
  }
  if (providers.includes('claude')) {
  const claudeDir = path.isAbsolute(env.CLAUDE_CONFIG_DIR || '') ? env.CLAUDE_CONFIG_DIR : path.join(home, '.claude');
  try {
    const raw = JSON.parse(await loader(path.join(claudeDir, '.credentials.json'), 'utf8'));
    const oauth = object(raw?.claudeAiOauth);
    const access = string(oauth?.accessToken);
    if (access) results.push({ id: 'cli:claude', provider: 'claude', kind: 'subscription', label: 'Claude Code CLI',
      source: 'Claude Code CLI', active: false, needsAuth: false, access,
      expires: timestamp(oauth.expiresAt), account: null, tokenMethod: 'oauth' });
  } catch { /* no Claude CLI installation */ }
  }
  return results;
}
function parseClaudeUsage(body) {
  const doc = object(body);
  if (!doc) throw new Error('invalid_payload');
  const windows = [];
  const specs = [['five_hour','5-hour'],['seven_day','Weekly'],['seven_day_sonnet','Weekly · Sonnet'],['seven_day_opus','Weekly · Opus']];
  for (const [key,label] of specs) {
    const item = object(doc[key]);
    const used = number(item?.utilization);
    if (used === null || used < 0 || used > 100) continue;
    windows.push({ label, usedPercent: used, remainingPercent: 100 - used, resetsAt: timestamp(item?.resets_at) });
  }
  if (!windows.length) throw new Error('missing_windows');
  return { windows, credits: null };
}
async function fetchSafe(url, headers, fetcher) {
  const response = await fetcher(url, { method:'GET', headers, redirect:'error', cache:'no-store', signal:AbortSignal.timeout(12000) });
  if (!response.ok) {
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    if (response.status === 429) throw new Error('rate_limited');
    throw new Error('request_failed');
  }
  return response.json();
}
function errorReason(e) { return ['unauthorized','forbidden','rate_limited','missing_windows','missing_rate_limits','invalid_balance','invalid_payload'].includes(e?.message) ? e.message : 'request_failed'; }

function validBalance(value,currency,kind='balance') {
  const n=number(value);
  if(n===null || !Number.isFinite(n) || Math.abs(n)>1e12 || !['USD','CNY'].includes(currency))
    throw new Error('invalid_balance');
  return {amount:n,currency,kind};
}
function parseDeepSeekBalances(body) {
  if(typeof body?.is_available!=='boolean' || !Array.isArray(body?.balance_infos)) throw new Error('invalid_payload');
  const found=[];
  for(const value of body.balance_infos){
    if(!['USD','CNY'].includes(value?.currency))continue;
    const parsed=validBalance(value.total_balance,value.currency);
    if(found.some(x=>x.currency===parsed.currency))throw new Error('invalid_payload');
    found.push(parsed);
  }
  if(!found.length)throw new Error('invalid_payload');
  return found.sort((a,b)=>Number(b.currency==='USD')-Number(a.currency==='USD'));
}
function parseDeepSeekBalance(body){return parseDeepSeekBalances(body)[0];}
function deepSeekDetails(body){
  const rows=[];
  for(const v of body.balance_infos){
    if(!['USD','CNY'].includes(v?.currency))continue;
    for(const [field,code] of [['topped_up_balance','topped_up'],['granted_balance','granted']]){
      const m=metrics.metric(code,v[field],{currency:v.currency});if(m)rows.push(m);
    }
  }
  return {metrics:rows,notices:[{group:'budget',status:'unsupported'},{group:'usage',status:'unsupported'},
    ...(rows.length<2*body.balance_infos.filter(v=>['USD','CNY'].includes(v?.currency)).length?[{group:'breakdown',status:'not_returned'}]:[]),
    ...(body.is_available===false?[{group:'balance',status:'insufficient_balance'}]:[])]};
}
function parseKimiBalance(body,currency='USD') {
  // Moonshot v1 returns a business success indicator and may include a numeric
  // 'code' field. 0 is required when it is present; some older versions omit it.
  if(body?.status!==true || (body.code!==undefined && body.code!==0)) throw new Error('invalid_payload');
  return validBalance(body?.data?.available_balance,currency);
}
function kimiDetails(body,currency){
  const rows=[metrics.metric('cash',body?.data?.cash_balance,{currency}),metrics.metric('voucher',body?.data?.voucher_balance,{currency})].filter(Boolean);
  return {metrics:rows,notices:[{group:'budget',status:'unsupported'},{group:'usage',status:'unsupported'},
    ...(rows.length<2?[{group:'breakdown',status:'not_returned'}]:[])]};
}
// The current-key API also exposes organization/guardrail budget policies.
// Keep each one separate and trust only the provider's effective budget.
function parseRouterPolicy(v){
  if(!object(v)||typeof v.remaining_usd!=='number'||!Number.isFinite(v.remaining_usd)||Math.abs(v.remaining_usd)>1e12)return null;
  const period=v.reset_interval===null?'none':v.reset_interval;
  const resetsAt=v.resets_at===null?null:typeof v.resets_at==='string'?Date.parse(v.resets_at):NaN;
  return metrics.cleanRouterPolicy({scope:v.scope,limit:v.limit_usd,spent:v.spend_usd,
    remaining:Math.max(0,v.remaining_usd),period,resetsAt,includeByok:v.include_byok});
}
function parseOpenRouterKey(body,now=Date.now()) {
  const v=object(body?.data);
  if(!v) throw new Error('invalid_payload');
  const remaining=metrics.num(v.limit_remaining),limit=metrics.nonnegative(v.limit);
  const left=remaining!==null&&Math.abs(remaining)<=1e12?Math.max(0,remaining):null;
  const period=['daily','weekly','monthly'].includes(v.limit_reset)?v.limit_reset:v.limit_reset===null?'none':null;
  let resetsAt=null;
  if(period&&period!=='none'){
    const d=new Date(now),today=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
    if(period==='daily')resetsAt=today+86400000;
    if(period==='weekly')resetsAt=today+(7-(d.getUTCDay()+6)%7)*86400000;
    if(period==='monthly')resetsAt=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  }
  const expiresAt=typeof v.expires_at==='string'?Date.parse(v.expires_at):null;
  const hasPolicies=Object.hasOwn(v,'budgets'),hasEffective=Object.hasOwn(v,'effective_budget');
  const policyList=Array.isArray(v.budgets)&&v.budgets.length<=100?v.budgets.map(parseRouterPolicy):null;
  const policies=policyList?.filter(Boolean)||[];
  const effective=parseRouterPolicy(v.effective_budget);
  const rawFree=v.free_model_daily_requests;
  const date=new Date(now),dayEnd=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1);
  const freeDaily=metrics.cleanFreeDaily({used:rawFree?.used,limit:rawFree?.limit,remaining:rawFree?.remaining,resetsAt:dayEnd});
  const policyMatches=(x,y)=>['scope','limit','spent','remaining','period','resetsAt','includeByok'].every(k=>x[k]===y[k]);
  const malformed=(hasPolicies&&(!policyList||policyList.some(x=>!x)))||
    (hasEffective&&v.effective_budget!==null&&!effective)||
    (policyList&&effective&&!policies.some(x=>policyMatches(x,effective)))||
    (policyList&&policies.length>0&&hasEffective&&v.effective_budget===null)||
    (policyList&&policies.length===0&&limit!==null);
  const policyState=malformed?'invalid':hasPolicies&&hasEffective?'complete':hasPolicies||hasEffective?'partial':'legacy';
  const keyBudget=metrics.cleanKeyBudget({limit,remaining:limit===null?null:left,period,resetsAt,expiresAt,includeByok:v.include_byok_in_limit,freeTier:v.is_free_tier,
    policies,effective:malformed?null:effective,freeDaily,policyState});
  const budgetNotices=[];
  if(malformed)budgetNotices.push({group:'budget',status:'invalid_payload'});
  else if(!policies.length&&!effective){
    if(limit!==null&&left===null)budgetNotices.push({group:'budget',status:'not_returned'});
    else if(limit===null){
      const status=policyState==='complete'&&v.limit===null&&v.limit_remaining===null?'no_applicable_budgets':
        v.limit===null?'no_key_limit':'not_returned';
      budgetNotices.push({group:'budget',status});
    }
  }else if(!effective)budgetNotices.push({group:'budget',status:'not_returned'});
  if(!freeDaily&&Object.hasOwn(v,'free_model_daily_requests'))budgetNotices.push({group:'quota',status:'invalid_payload'});
  else if(!freeDaily)budgetNotices.push({group:'quota',status:'not_returned'});
  const rows=[];
  for(const [field,code] of [['usage_daily','key_daily'],['usage_weekly','key_weekly'],['usage_monthly','key_monthly'],['usage','key_total'],
    ['byok_usage_daily','byok_daily'],['byok_usage_weekly','byok_weekly'],['byok_usage_monthly','byok_monthly'],['byok_usage','byok_total']]){
    const m=metrics.metric(code,v[field],{currency:'USD'});if(m)rows.push(m);
  }
  return {management:v.is_management_key===true,keyBudget,metrics:rows,budgetNotices,
    limit:left!==null&&limit!==null?validBalance(left,'USD','key_limit'):null};
}
function parseOpenRouterCredits(body) {
  const v=object(body?.data),credits=number(v?.total_credits),spent=number(v?.total_usage);
  if(credits===null || spent===null || credits<0 || spent<0) throw new Error('invalid_payload');
  return validBalance(credits-spent,'USD');
}
const measuredWindow=(label,limit,remaining,resetsAt)=>{
  const total=number(limit),left=number(remaining);
  if(total===null||left===null||total<=0||left<0||left>total)return null;
  const pct=Math.max(0,Math.min(100,100*left/total));
  return {label,usedPercent:100-pct,remainingPercent:pct,resetsAt:timestamp(resetsAt)};
};
function parseKimiCoding(body) {
  if(!object(body)||body.code!==undefined&&body.code!==0||body?.data?.kind==='error')throw Error('invalid_payload');
  const windows=[];
  const counter=(label,item)=>{
    const limit=number(item?.limit),used=number(item?.used);
    const left=number(item?.remaining)??(limit!==null&&used!==null&&used>=0?Math.max(0,limit-used):null);
    return measuredWindow(label,limit,left,item?.resetTime);
  };
  const total=counter('Weekly',body?.usage);
  if(total)windows.push(total);
  for(const item of Array.isArray(body?.limits)?body.limits:[]){
    const w=item?.window||{};
    const duration=number(w.duration);
    if(!((w.timeUnit==='TIME_UNIT_MINUTE'&&duration===300)||(w.timeUnit==='TIME_UNIT_HOUR'&&duration===5)))continue;
    const win=counter('5-hour',item?.detail);
    if(win)windows.push(win);
  }
  const extended=kimiExtras.parseExtras(body,windows,timestamp);
  if(!extended.windows.length&&!extended.metrics.length)throw new Error('missing_windows');
  return {credits:null,...extended};
}
function parseZaiQuota(body){
  if(body?.success===false||!Array.isArray(body?.data?.limits)) throw new Error('missing_windows');
  const windows=[];
  for(const item of body.data.limits){
    if(!['TOKENS_LIMIT','CREDIT_LIMIT','TIME_LIMIT'].includes(item?.type))continue;
    const unit=number(item.unit),duration=number(item.number);
    let label;
    if(item.type==='TIME_LIMIT'&&unit===5&&duration===1)label='Monthly · MCP';
    if(item.type!=='TIME_LIMIT'&&unit===3&&duration===5)label='5-hour';
    if(item.type!=='TIME_LIMIT'&&unit===6&&duration===1)label='Weekly';
    if(!label)continue;
    // The field 'usage' denotes total available credits, not usage consumed.
    const total=number(item.usage),current=number(item.currentValue);
    const left=number(item.remaining)??(total!==null&&current!==null&&current>=0?Math.max(0,total-current):null);
    let win=measuredWindow(label,total,left,item.nextResetTime);
    if(!win&&total!==0){
      const used=number(item.percentage);
      if(used!==null&&used>=0&&used<=100)win={label,usedPercent:used,remainingPercent:100-used,resetsAt:timestamp(item.nextResetTime)};
    }
    if(win)windows.push(win);
  }
  if(!windows.length)throw new Error('missing_windows');
  return {windows,credits:null};
}
function parseMiniMaxQuota(body){return minimaxApi.parse(body,timestamp,measuredWindow);}
function parseOpenCodeGoUsage(body) {
  const windows = [];
  for (const [key,label] of [['rolling','5-hour'],['weekly','Weekly'],['monthly','Monthly']]) {
    const item = object(body?.usage?.[key]);
    const used = item?.percent;
    // Percent is consumed allowance, not remaining dollars or tokens.
    if (!['ok','rate-limited'].includes(item?.status)
      || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue;
    const resetsAt = typeof item.resetsAt === 'string' ? Date.parse(item.resetsAt) : NaN;
    windows.push({label,usedPercent:used,remainingPercent:100-used,
      resetsAt:Number.isFinite(resetsAt)?resetsAt:null});
  }
  if (!windows.length) throw new Error('missing_windows');
  return {windows,credits:null};
}
// Experimental Console endpoints. The current-budgets contract is used by
// OpenCode core's usage-limits service (packages/core/src/usage-limits.ts).
// Keep separate budget policies rather than adding overlapping allowances.
const isUsd=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e10;
function parseOpenCodeBudgets(body){
  if(!Array.isArray(body)||body.length>100)throw new Error('invalid_payload');
  const rows=[],seen=new Set();
  for(const item of body){
    if(!object(item)||typeof item.ruleID!=='string'||!item.ruleID||item.ruleID.length>160||
      seen.has(item.ruleID)||!isUsd(item.limitDollars)||!isUsd(item.spentDollars)||
      !['each','combined'].includes(item.scope)||!['set','model'].includes(item.per)||
      !['all','models'].includes(item.coverage)||typeof item.shared!=='boolean'||
      !Array.isArray(item.models)||item.models.length>2000||!Array.isArray(item.vendors)||
      typeof item.resetsAt!=='string')throw new Error('invalid_payload');
    const resetsAt=Date.parse(item.resetsAt);
    if(!Number.isFinite(resetsAt)||resetsAt<=0)throw new Error('invalid_payload');
    seen.add(item.ruleID);
    let spent=item.spentDollars;
    // Without a current model, report the most constrained explicitly
    // reported model counter. Never fill in missing model spend as zero.
    // An incomplete per-model policy is not an all-spend allowance.
    if(item.per==='model'){
      const observed=item.models.map(model=>model?.spentDollars);
      if(!observed.length||observed.some(v=>!isUsd(v)))spent=null;
      else spent=Math.max(...observed);
    }
    rows.push({limitUsd:item.limitDollars,spentUsd:spent,
      remainingUsd:spent===null?null:Math.max(0,item.limitDollars-spent),
      resetsAt,scope:item.scope,coverage:item.coverage,per:item.per,shared:item.shared});
  }
  return rows.sort((a,b)=>(a.remainingUsd??Infinity)-(b.remainingUsd??Infinity));
}
function parseOpenCodeCreditBalance(body){
  // Microcents are decimal strings in the observed Console response.
  // Invoiced credit lines and credit limits are not prepaid wallet money.
  if(!object(body)||typeof body.billingMode!=='string')throw new Error('invalid_payload');
  if(body.billingMode!=='prepaid')return null;
  const raw=body.balanceMicroCents;
  const micros=typeof raw==='string'&&/^\d{1,16}$/.test(raw)?Number(raw):raw;
  if(!Number.isSafeInteger(micros)||micros<0)throw new Error('invalid_balance');
  return validBalance(micros/100000000,'USD');
}
function openCodeConsoleHeaders(entry){
  const server=entry.consoleServer;
  // Legacy Console metadata maps path-for-path to the current official host.
  // Never forward credentials to a self-hosted Console, gateway or redirect.
  if(server!==null&&server!==undefined&&
    !['https://opencode.ai/console','https://opencode.ai/console/','https://console.opencode.ai','https://console.opencode.ai/'].includes(server))
    throw new Error('unsupported_console');
  const oauth=entry.tokenMethod==='oauth';
  const token=oauth?entry.access:entry.apiKey;
  if(!token)throw new Error('credential_not_readable');
  if(oauth&&entry.expires&&entry.expires<=Date.now()+10000)throw new Error('login_expired');
  const org=entry.consoleOrg;
  if(org!==null&&org!==undefined&&!/^(?:org|wrk)_[A-Za-z0-9_-]{1,120}$/.test(org))
    throw new Error('workspace_required');
  if(oauth&&!org)throw new Error('workspace_required');
  return {Authorization:'Bearer '+token,Accept:'application/json',...(org?{'x-org-id':org}:{})};
}
async function queryOpenCodeConsole(entry,fetcher){
  let headers;
  try{headers=openCodeConsoleHeaders(entry);}
  catch(e){return {state:'unavailable',message:e.message,budgetMessage:e.message,budgets:[]};}
  // Independent reads: lack of Billing permission must not hide budgets,
  // and lack of Budgets permission must not hide an actual prepaid balance.
  const [budgets,billing]=await Promise.allSettled([
    fetchSafe(OPENCODE_CONSOLE+'/api/policies/current-budgets',headers,fetcher).then(parseOpenCodeBudgets),
    fetchSafe(OPENCODE_CONSOLE+'/api/billing/status',headers,fetcher).then(parseOpenCodeCreditBalance)
  ]);
  const rows=budgets.status==='fulfilled'?budgets.value:[];
  const balance=billing.status==='fulfilled'?billing.value:null;
  const budgetMessage=budgets.status==='fulfilled'?(rows.length?'experimental_budget':'no_budgets'):errorReason(budgets.reason);
  const message=billing.status==='fulfilled'?(balance?'experimental_balance':'no_prepaid_balance'):errorReason(billing.reason);
  return {state:budgets.status==='fulfilled'||billing.status==='fulfilled'?'ok':'error',
    message,budgetMessage,budgets:rows,balance};
}
// Never send a stored provider token to user-supplied URLs, gateways, mirrors or
// a different provider's hostname. The mapping here is deliberately fixed.
async function queryAdditional(entry,fetcher,time=nowMs()){
  if(entry.provider==='opencode')return queryOpenCodeConsole(entry,fetcher);
  if(['gemini','qwen'].includes(entry.provider))
    return {state:'unavailable',message:'no_usage_endpoint',notices:['balance','budget','usage'].map(group=>({group,status:'unsupported'}))};
  const key=entry.apiKey || entry.access;
  if(!key)return {state:'unavailable',message:'credential_not_readable'};
  const headers={Authorization:`Bearer ${key}`,Accept:'application/json'};
  if(entry.provider==='opencode-go'){
    // Official Go usage API; use only the credential for this integration.
    const value=await fetchSafe('https://opencode.ai/inference/go/v1/usage',headers,fetcher);
    return {state:'ok',message:'ok',kind:'subscription',...parseOpenCodeGoUsage(value)};
  }
  if(entry.provider==='deepseek'){
    const value=await fetchSafe('https://api.deepseek.com/user/balance',headers,fetcher);
    const balances=parseDeepSeekBalances(value);
    return {state:'ok',message:'ok',balance:balances[0],balances,...deepSeekDetails(value)};
  }
  if(entry.provider==='kimi'){
    if(isCodingPlan(entry.integrationID)){
      const value=await fetchSafe('https://api.kimi.com/coding/v1/usages',headers,fetcher);
      return {state:'ok',message:'ok',kind:'subscription',...parseKimiCoding(value)};
    }
    const cn=/(?:-cn)$/.test(entry.integrationID);
    const value=await fetchSafe(cn?'https://api.moonshot.cn/v1/users/me/balance':'https://api.moonshot.ai/v1/users/me/balance',headers,fetcher);
    const currency=cn?'CNY':'USD';
    return {state:'ok',message:'ok',balance:parseKimiBalance(value,currency),...kimiDetails(value,currency)};
  }
  if(entry.provider==='openrouter'){
    const info=parseOpenRouterKey(await fetchSafe('https://openrouter.ai/api/v1/key',headers,fetcher),time);
    const rows=[...info.metrics],notices=[...info.budgetNotices];
    let wallet=null;
    if(info.management){
      try{
        const value=await fetchSafe('https://openrouter.ai/api/v1/credits',headers,fetcher);
        wallet=parseOpenRouterCredits(value);
        for(const [field,code] of [['total_credits','wallet_total_credits'],['total_usage','wallet_total_usage']]){
          const m=metrics.metric(code,value?.data?.[field],{currency:'USD'});if(m)rows.push(m);
        }
      }catch(e){notices.push({group:'balance',status:metrics.reason(e)});}
    }else notices.push({group:'balance',status:'no_balance_access'});
    if(!info.metrics.length)notices.push({group:'usage',status:'not_returned'});
    return {state:'ok',message:wallet?'ok':info.limit?'key_limit_only':'no_balance_access',
      balance:wallet||info.limit,keyBudget:info.keyBudget,metrics:rows,notices};
  }
  if(entry.provider==='minimax'){
    // Some MiniMax Subscription Keys are connected under the general MiniMax ID.
    // Only a recognisable subscription key may use the Token Plan endpoint.
    if(!isCodingPlan(entry.integrationID) && !String(entry.apiKey||'').startsWith('sk-cp-'))
      return {state:'unavailable',message:'no_usage_endpoint',notices:['balance','budget','usage'].map(group=>({group,status:'unsupported'}))};
    const cn=/(?:-cn)(?:-|$)/.test(entry.integrationID);
    const value=await fetchSafe(cn?'https://www.minimaxi.com/v1/token_plan/remains':'https://www.minimax.io/v1/token_plan/remains',headers,fetcher);
    return {state:'ok',message:'ok',kind:'subscription',...parseMiniMaxQuota(value)};
  }
  if(entry.provider==='zai')return zaiApi.query(entry,fetchSafe,fetcher,time,parseZaiQuota);
  return {state:'unavailable',message:'no_usage_endpoint',notices:['balance','budget','usage'].map(group=>({group,status:'unsupported'}))};
}
async function queryQuota(entry, fetcher = fetch, time = nowMs()) {
  const safe = { id: entry.id, provider: entry.provider, kind: entry.kind, label: entry.label,
    source: entry.source, active: entry.active, state:'unavailable', message:'quota_unavailable',
    windows:[], credits:null, balance:null, balances:[], budgets:[],budgetMessage:null,
    metrics:[],notices:[],keyBudget:null,modelWindows:[],checkedAt:time };
  if (!['codex','claude'].includes(entry.provider)) {
    if (entry.needsAuth) return {...safe,message:'login_required',budgetMessage:entry.provider==='opencode'?'login_required':null};
    if(entry.tokenMethod==='oauth'&&entry.expires&&entry.expires<time+10000)
      return {...safe,message:'login_expired'};
    try{return {...safe,...await queryAdditional(entry,fetcher,time)};}
    catch(e){return {...safe,state:'error',message:errorReason(e)};}
  }
  if (entry.needsAuth) return { ...safe, message:'login_required' };
  if (entry.kind !== 'subscription'){
    if(entry.provider==='claude')return {...safe,...await claudeApi.query(entry,fetchSafe,fetcher,time)};
    return {...safe,message:'no_usage_endpoint',notices:[{group:'balance',status:'unsupported'},{group:'budget',status:'unsupported'},{group:'usage',status:'unsupported'}]};
  }
  if (!entry.access) return { ...safe, message:'oauth_not_readable' };
  // The current 'Sign in with ChatGPT' token-sharing credential is scoped to
  // api.openai.com/v1, not the Codex wham/usage endpoint. A request to wham
  // typically returns 401 invalid_jwt. This is NOT an exhausted allowance.
  // Only older Codex-browser style credentials can be queried here.
  if (entry.provider === 'codex' && (entry.oauthMethod === 'chatgpt-token-sharing' || entry.directSharing))
    return { ...safe, message:'sharing_no_usage_api' };
  if (entry.expires && entry.expires < time + 10000) return { ...safe, message:'login_expired' };
  try {
    const headers = { Authorization:`Bearer ${entry.access}`, Accept:'application/json' };
    if (entry.provider === 'codex' && entry.account) headers['ChatGPT-Account-Id'] = entry.account;
    if (entry.provider === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20';
    const url = entry.provider === 'codex' ? CODEX_URL : CLAUDE_URL;
    const payload = await fetchSafe(url, headers, fetcher);
    const value = entry.provider === 'codex' ? base.parseCodexUsage(payload, time) : parseClaudeUsage(payload);
    return { ...safe, state:'ok', message:'ok', ...value };
  } catch (e) { return { ...safe, state:'error', message:errorReason(e) }; }
}
// The OpenCode Desktop GUI SDK supplies the app's sidecar client. If a build
// cannot read credentials through that client, use only the authenticated LOCAL
// sidecar endpoint exposed by the host. Never read or mutate the SQLite DB.
function localSidecar(endpoint) {
  const entry = typeof endpoint === 'function' ? endpoint() : endpoint;
  try {
    const url = new URL(entry?.url);
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return null;
    return { origin:url.origin, headers: object(entry.headers) || {} };
  } catch { return null; }
}
async function sidecarList(endpoint, fetcher, pathname) {
  const sidecar = localSidecar(endpoint);
  if (!sidecar) throw new Error('sidecar_unavailable');
  const response = await fetcher(`${sidecar.origin}${pathname}`, {
    method:'GET',headers:{...sidecar.headers,Accept:'application/json'},
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('sidecar_request_failed');
  return response.json();
}
async function readAllAccounts({ client, endpoint, env = process.env, home = os.homedir(), loader = fs.readFile, fetcher = fetch, time = nowMs() } = {}) {
  const live = typeof client === 'function' ? client() : client;
  let integrations = [], credentials = [];
  let integrationOK = false, credentialOK = false;
  try {
    integrations = arr(await live.integration.list());
    integrationOK = true;
  } catch { /* Retry with the authenticated local sidecar below. */ }
  try {
    credentials = arr(await live.credential.list());
    credentialOK = true;
  } catch { /* Retry with the authenticated local sidecar below. */ }
  // Distinguish an empty SDK response at startup from a genuinely empty account
  // inventory; both can be checked against the same local sidecar route.
  if (!credentialOK || !credentials.length) {
    try { const fallback = arr(await sidecarList(endpoint, fetcher, '/api/credential'));
      if (fallback.length || !credentialOK) { credentials = fallback; credentialOK = true; }
    } catch { /* Keep successful SDK results, if any. */ }
  }
  if (!integrationOK || !integrations.length) {
    try { const fallback = arr(await sidecarList(endpoint, fetcher, '/api/integration'));
      if (fallback.length || !integrationOK) { integrations = fallback; integrationOK = true; }
    } catch { /* Credentials alone still provide the account inventory. */ }
  }
  const entries = collectAccounts(integrations, credentials, env);

  // The existence of ~/.codex/auth.json does NOT mean that "Codex CLI" was
  // connected to OpenCode. Never add a free-standing CLI account. Only resolve
  // a Claude Code external credential explicitly saved in OpenCode, preserving
  // its real OpenCode label; do not substitute a CLI token for any other account.
  if (entries.some(entry => entry.provider === 'claude' && entry.kind === 'subscription'
    && entry.tokenMethod === 'external' && entry.externalMethod === 'claude-login' && !entry.access)) {
    const cli = await readLocalCli(home, env, loader, ['claude']);
    const linked = cli.find(entry => entry.provider === 'claude');
    if (linked) for (const entry of entries) {
      if (entry.provider !== 'claude' || entry.tokenMethod !== 'external'
        || entry.externalMethod !== 'claude-login' || entry.access) continue;
      entry.access = linked.access;
      entry.expires = linked.expires;
      entry.account = linked.account;
    }
  }
  const evaluated = [];
  for (let i = 0; i < entries.length; i += 4) {
    const page = await Promise.all(entries.slice(i, i + 4).map(a => queryQuota(a, fetcher, time)));
    evaluated.push(...page);
  }
  // This is an inventory check, not a statement about authorization or usage.
  // A temporarily empty credential response is not an empty account inventory
  // if the integration endpoint still reports a connected stored credential.
  const hasConnectedCredential=integrations.some(integration=>providerFor(integration?.id)&&
    arr(integration?.connections).some(conn=>conn?.type==='credential'&&
      typeof conn.id==='string'&&conn.status?.status!=='needs_auth'));
  const warning = !credentialOK || (!credentials.length&&hasConnectedCredential)
    ? 'credentials_unavailable' : !entries.length ? 'no_connected_accounts' : null;
  return { accounts:evaluated, checkedAt:time, inventoryWarning:warning };
}

function parseOrgConfigs(env = process.env) {
  const all = [];
  for (const [provider,keyVar,budgetVar] of [
    ['codex','OPENAI_ADMIN_KEY','OPENAI_API_MONTHLY_BUDGET_USD'],
    ['claude','ANTHROPIC_ADMIN_KEY','ANTHROPIC_API_MONTHLY_BUDGET_USD'],
  ]) {
    const key = string(env[keyVar]);
    if (key) all.push({ provider, label:provider === 'codex' ? 'OpenAI organization' : 'Claude organization', key, budget:number(env[budgetVar]) });
  }
  // Additional organizations, without persisting admin keys in OpenCode config.
  // Environment syntax: PV_USAGE_API_ORGS_JSON='[{"provider":"claude","label":"Work","key":"..."}]'
  try {
    const items = JSON.parse(env.PV_USAGE_API_ORGS_JSON || '[]');
    if (Array.isArray(items)) for (const item of items.slice(0, MAX_ORGS)) {
      const provider = providerFor(item?.provider);
      const key = string(item?.key);
      // Only these providers have organization-cost integrations below.
      if (['codex','claude'].includes(provider) && key) all.push({ provider, key, label:safeLabel(item.label, 'Organization'), budget:number(item.monthlyBudgetUsd) });
    }
  } catch { /* invalid env is ignored, not logged */ }
  const seen = new Set();
  return all.filter(item => {
    const signature = `${item.provider}:${fingerprint(item.key)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).slice(0, MAX_ORGS);
}
function monthString(now) { return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`; }
function amount(value) { const n=number(value); return n !== null && n >= 0 ? n : null; }
function parseClaudeCostsPage(body) {
  if (!object(body) || !Array.isArray(body.data)) throw new Error('invalid_payload');
  let totalCents = 0;
  for (const item of body.data) {
    if (item?.cost?.currency !== 'USD') continue;
    const cents = amount(item.cost.amount);
    if (cents !== null) totalCents += cents;
  }
  return { usd:totalCents/100, hasMore:body.has_more === true, nextPage:string(body.next_page) };
}
async function queryOrg(org, {fetcher=fetch,now=new Date()}={}) {
  const month = monthString(now);
  let budget = org.budget !== null && org.budget >= 0 ? org.budget : null;
  let limitType = 'custom';
  const safe = { id:`${org.provider}:${fingerprint(org.key).slice(0,12)}`, provider:org.provider,
    label:org.label, month, state:'unavailable', message:'admin_key_required',
    usdSpent:null, monthlyBudgetUsd:budget, usdRemainingBudget:null, limitType, checkedAt:now.getTime() };
  if (!['codex','claude'].includes(org.provider)) return {...safe,message:'no_usage_endpoint'};
  let total = 0;
  const start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const end = new Date(Math.max(now.getTime(), start.getTime() + 1000));
  const seen = new Set();
  let page = null;
  // OpenAI's read-only Admin API can report an *enforced organization spend cap*.
  // This is not a prepaid-credit balance. A missing/forbidden hard-cap response
  // must not block the otherwise valid Costs API request.
  if (org.provider === 'codex') {
    try {
      const cap = await fetchSafe(OPENAI_SPEND_LIMIT_URL,
        { Authorization:`Bearer ${org.key}`, Accept:'application/json' }, fetcher);
      const threshold = number(cap?.threshold_amount);
      if (cap?.currency === 'USD' && cap?.interval === 'month'
        && cap?.enforcement?.status === 'enforcing' && Number.isInteger(threshold) && threshold >= 0) {
        budget = threshold / 100;
        limitType = 'hard';
      }
    } catch { /* Unsupported permission or no configured cap. Costs still work. */ }
  }
  try {
    for (let i=0;i<MAX_PAGES;i++) {
      const endpoint = org.provider === 'codex' ? OPENAI_COSTS_URL : ANTHROPIC_COSTS_URL;
      const url = new URL(endpoint);
      const headers = { Accept:'application/json' };
      if (org.provider === 'codex') {
        headers.Authorization = `Bearer ${org.key}`;
        url.searchParams.set('start_time',String(Math.floor(start.getTime()/1000)));
        url.searchParams.set('end_time',String(Math.floor(end.getTime()/1000)));
        url.searchParams.set('bucket_width','1d'); url.searchParams.set('limit','31');
      } else {
        headers['x-api-key'] = org.key;
        headers['anthropic-version'] = '2026-10-21';
        headers['anthropic-beta'] = 'analytics-usage-cost-2026-08-24';
        url.searchParams.set('starting_at',start.toISOString());
        url.searchParams.set('ending_at',end.toISOString());
        url.searchParams.set('limit','100');
      }
      if (page) url.searchParams.set('page',page);
      const raw = await fetchSafe(url.toString(), headers, fetcher);
      const parsed = org.provider === 'codex' ? (() => {
        const p=base.parseCostsPage(raw);
        return {usd:p.totalUsd,hasMore:p.hasMore,nextPage:p.nextPage};
      })() : parseClaudeCostsPage(raw);
      total += parsed.usd;
      if (!parsed.hasMore) {
        const spent = Math.round(total*10000)/10000;
        return { ...safe, state:'ok', message:'ok', usdSpent:spent,
          monthlyBudgetUsd:budget, limitType,
          usdRemainingBudget:budget === null ? null : Math.round((budget-spent)*100)/100 };
      }
      if (!parsed.nextPage || seen.has(parsed.nextPage)) throw new Error('pagination_error');
      seen.add(parsed.nextPage); page=parsed.nextPage;
    }
    throw new Error('pagination_limit');
  } catch(e) { return {...safe,state:'error',message:errorReason(e)}; }
}
async function readAllOrganizations({env=process.env,fetcher=fetch,now=new Date()}={}) {
  const orgs = parseOrgConfigs(env);
  const entries=[];
  for (let i=0;i<orgs.length;i+=4) {
    entries.push(...await Promise.all(orgs.slice(i,i+4).map(org=>queryOrg(org,{fetcher,now}))));
  }
  return { organizations:entries, checkedAt:now.getTime() };
}
function makeDashboardMonitor({ client, endpoint, env = process.env, home = os.homedir(), loader=fs.readFile, fetcher=fetch, clock=nowMs }={}) {
  const cache = { accounts:null, orgs:null };
  const pending = { accounts:null, orgs:null };
  async function load(which, force) {
    const prev=cache[which];
    const ttl=which==='accounts'?60000:300000;
    if (!force && prev && clock()-prev.at<ttl) return prev.value;
    if (pending[which]) return pending[which];
    pending[which]=(async()=>{
      try {
        const result=which==='accounts'
          ? await readAllAccounts({client,endpoint,env,home,loader,fetcher,time:clock()})
          : await readAllOrganizations({env,fetcher,now:new Date(clock())});
        cache[which]={at:clock(),value:result}; return result;
      } catch {
        if (prev) return { ...prev.value, inventoryWarning:'last_known_values' };
        return which==='accounts' ? {accounts:[],checkedAt:clock(),inventoryWarning:'connections_unavailable'} : {organizations:[],checkedAt:clock()};
      } finally { pending[which]=null; }
    })();
    return pending[which];
  }
  return {async get(force=false) {
    const [accounts,orgs,usage]=await Promise.all([load('accounts',force),load('orgs',force),localUsage.readLocalUsage(client,providerFor,clock())]);
    return {accounts:accounts.accounts,organizations:orgs.organizations,localUsage:usage,
      inventoryWarning:accounts.inventoryWarning || null,checkedAt:Math.max(accounts.checkedAt,orgs.checkedAt)};
  }};
}
// Switch only a credential already connected to OpenCode. The account ID is a
// non-secret inventory key (`integrationID:credentialID`), not an OAuth token.
// Only the built-in credential.activate endpoint changes the active account.
async function activateConnectedAccount({client,id,snapshot,force=false}={}) {
  const item=(snapshot?.accounts||[]).find(a=>a.id===id);
  if(!item || !Object.keys(PROVIDER_IDS).includes(item.provider) || item.source!=='OpenCode')
    throw new Error('account_not_connected');
  const sep=id.indexOf(':');
  if(sep<=0 || sep===id.length-1) throw new Error('account_not_switchable');
  const integrationID=id.slice(0,sep),credentialID=id.slice(sep+1);
  if(providerFor(integrationID)!==item.provider || !client?.credential?.activate || !client?.credential?.list)
    throw new Error('account_switch_unavailable');
  let credentials;
  try { credentials=arr(await client.credential.list()); }
  catch { throw new Error('account_switch_unavailable'); }
  const credential=credentials.find(c=>c.id===credentialID && c.integrationID===integrationID);
  if(!credential || !credential.value || !['oauth','key','external'].includes(credential.value.type))
    throw new Error('account_not_connected');
  // A previous queued activation may have changed the provider while the
  // credential list still reports old active flags. Queued switches must
  // always reach OpenCode, even when its account inventory looks unchanged.
  if(credential.active===true && !force) return {id,provider:item.provider,unchanged:true};
  try { await client.credential.activate({credentialID}); }
  catch { throw new Error('account_switch_failed'); }
  return {id,provider:item.provider,unchanged:false};
}

module.exports={providerFor,parseDeepSeekBalance,parseDeepSeekBalances,parseKimiBalance,parseKimiCoding,parseOpenRouterKey,parseOpenRouterCredits,parseZaiQuota,parseMiniMaxQuota,parseOpenCodeGoUsage,parseOpenCodeBudgets,parseOpenCodeCreditBalance,queryOpenCodeConsole,queryAdditional,parseClaudeUsage,parseClaudeCostsPage,collectAccounts,readLocalCli,readAllAccounts,localSidecar,sidecarList,
  readAllOrganizations,parseOrgConfigs,queryQuota,queryOrg,makeDashboardMonitor,activateConnectedAccount};
