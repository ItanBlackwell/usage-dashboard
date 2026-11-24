/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// The GUI entry runs in the renderer AND Electron main. Only main sees secrets.
// The indicator placement adapter is intentionally isolated: OpenCode GUI SDK
// currently has no public left-bottom indicator slot.
const { Plugin, Ipc, Panel, Command, MenuItem } = require('@opencode/plugin/gui');
const { Schema } = require('effect');
const { onCleanup, createEffect, createRoot } = require('solid-js');
const core = require('./accounts.cjs');
const presentation = require('./presentation.cjs');
const cache = require('./cache.cjs');
const switchQueue = require('./switch-queue.cjs');
const nativeUpdate = require('./native-update-layout.cjs');

const ProviderBalanceSchema = Schema.Struct({amount:Schema.Number,currency:Schema.String,kind:Schema.String});
const WindowSchema = Schema.Struct({ label:Schema.String, usedPercent:Schema.Number,
  remainingPercent:Schema.Number, resetsAt:Schema.NullOr(Schema.Number) });
const BudgetSchema = Schema.Struct({limitUsd:Schema.Number,spentUsd:Schema.NullOr(Schema.Number),remainingUsd:Schema.NullOr(Schema.Number),
  resetsAt:Schema.Number,scope:Schema.String,coverage:Schema.String,per:Schema.String,shared:Schema.Boolean});
const DetailSchema=Schema.Struct({code:Schema.String,value:Schema.Number,currency:Schema.NullOr(Schema.String),model:Schema.NullOr(Schema.String),at:Schema.NullOr(Schema.Number)});
const NoticeSchema=Schema.Struct({group:Schema.String,status:Schema.String});
const RouterPolicySchema=Schema.Struct({scope:Schema.String,limit:Schema.Number,spent:Schema.Number,remaining:Schema.Number,period:Schema.String,resetsAt:Schema.NullOr(Schema.Number),includeByok:Schema.Boolean});
const FreeDailySchema=Schema.Struct({used:Schema.Number,limit:Schema.Number,remaining:Schema.Number,resetsAt:Schema.Number});
const KeyBudgetSchema=Schema.Struct({limit:Schema.NullOr(Schema.Number),remaining:Schema.NullOr(Schema.Number),period:Schema.NullOr(Schema.String),resetsAt:Schema.NullOr(Schema.Number),expiresAt:Schema.NullOr(Schema.Number),includeByok:Schema.NullOr(Schema.Boolean),freeTier:Schema.NullOr(Schema.Boolean),
  policies:Schema.Array(RouterPolicySchema),effective:Schema.NullOr(RouterPolicySchema),freeDaily:Schema.NullOr(FreeDailySchema),policyState:Schema.String});
const ModelWindowSchema=Schema.Struct({label:Schema.String,model:Schema.String,usedPercent:Schema.Number,remainingPercent:Schema.Number,resetsAt:Schema.NullOr(Schema.Number)});
const AccountSchema = Schema.Struct({ id:Schema.String,provider:Schema.String,kind:Schema.String,
  label:Schema.String,source:Schema.String,active:Schema.Boolean,state:Schema.String,message:Schema.String,
  windows:Schema.Array(WindowSchema),credits:Schema.NullOr(Schema.Number),balance:Schema.NullOr(ProviderBalanceSchema),balances:Schema.Array(ProviderBalanceSchema),
  budgets:Schema.Array(BudgetSchema),budgetMessage:Schema.NullOr(Schema.String),
  metrics:Schema.Array(DetailSchema),notices:Schema.Array(NoticeSchema),keyBudget:Schema.NullOr(KeyBudgetSchema),modelWindows:Schema.Array(ModelWindowSchema),checkedAt:Schema.Number });
const OrgSchema = Schema.Struct({ id:Schema.String,provider:Schema.String,label:Schema.String,
  month:Schema.String,state:Schema.String,message:Schema.String,usdSpent:Schema.NullOr(Schema.Number),
  monthlyBudgetUsd:Schema.NullOr(Schema.Number),usdRemainingBudget:Schema.NullOr(Schema.Number),
  limitType:Schema.String,checkedAt:Schema.Number });
const LocalUsageRowSchema=Schema.Struct({provider:Schema.String,cost:Schema.NullOr(Schema.Number),tokens:Schema.NullOr(Schema.Number),steps:Schema.NullOr(Schema.Number)});
const LocalUsagePeriodSchema=Schema.Struct({from:Schema.Number,to:Schema.Number,rows:Schema.Array(LocalUsageRowSchema)});
const LocalUsageSchema=Schema.Struct({today:Schema.NullOr(LocalUsagePeriodSchema),month:Schema.NullOr(LocalUsagePeriodSchema)});
const SnapshotSchema = Schema.Struct({ accounts:Schema.Array(AccountSchema),organizations:Schema.Array(OrgSchema),
  localUsage:LocalUsageSchema,inventoryWarning:Schema.NullOr(Schema.String),checkedAt:Schema.Number });
const Metrics = Ipc.define({id:'usage-dashboard.metrics.v7',state:SnapshotSchema,methods:{get:{output:SnapshotSchema},refresh:{output:SnapshotSchema},activate:{input:Schema.Struct({id:Schema.String}),output:SnapshotSchema}}});

const palette = {
  text:'var(--text-strong, var(--v2-text-text-base, #e3e6ed))',
  muted:'var(--text-muted, var(--v2-text-text-muted, #9ea7b6))',
  border:'var(--border, var(--v2-border-border-muted, rgba(130,141,166,.26)))',
  card:'var(--surface-raised, var(--v2-background-bg-layer-02, rgba(125,135,155,.07)))',
  track:'rgba(142,153,171,.24)',success:'#45bf8d',warning:'#e4ad59',danger:'#de5d5d',
  fiveHour:'#4ba9ee',weekly:'#e6ac58',
};
const $ = (tag, style='', text='') => { const e=document.createElement(tag); e.style.cssText=style; if(text)e.textContent=text; return e; };
const add = (parent, el) => { parent.appendChild(el); return el; };
const empty = parent => parent.replaceChildren();
const pct = value => `${Math.round(value)}%`;
const currencyAmount = presentation.formatCurrency;
const money = value => currencyAmount(value,'USD');
const snapshotListeners = new Set();
// Per-desktop-window first-seen order survives closing and reopening the popup.
const stableAccountOrder = new Map();
const expandedAccountDetails=new Set();
// Only an unconfirmed request may override active flags received from main.
const visualIntents = new Map();
let latestSelectedID=null;
// Retain the last authoritative main-process snapshot across popup lifetimes.
let latestVerifiedSnapshot=null;
function notifySnapshot(snapshot){for(const listener of snapshotListeners){try{listener(snapshot);}catch{}}}
// All user-facing generic text uses OpenCode's own translations. The host
// supplies these keys in ALL supported Desktop languages and updates them as
// soon as the user changes the interface language.
const fallback = {
  'usage.title':'Usage', 'usage.retry':'Try again', 'usage.go.weekly':'Weekly', 'usage.go.monthly':'Monthly',
  'usage.error':"Usage limits couldn't be loaded.",
  'usage.duration.days':'{{days}}d {{hours}}h',
  'usage.duration.hours':'{{hours}}h {{minutes}}m',
  'usage.duration.minutes':'{{minutes}}m',
  'usage.go.resetsIn':'Resets in {{duration}}',
  'usage.budget.left':'{{amount}} left', 'usage.budget.of':'of {{limit}}',
  'command.usage.view':'View usage',
  'dialog.model.hint.select':'Select',
  'settings.providers.account.switched.description':'Now using {{account}}.',
};
const t = (ctx,key,params) => {
  let value; try { value=ctx.t(key,params); } catch {}
  if (typeof value!=='string' || value===key) value=fallback[key]||key;
  return value.replace(/\{\{(\w+)\}\}/g,(_,name)=>params?.[name]??'');
};
function duration(ctx,ts) {
  if(ts===null || !Number.isFinite(ts)) return '';
  const minutes=Math.max(0,Math.ceil((ts-Date.now())/60000));
  const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
  const value = d ? t(ctx,'usage.duration.days',{days:d,hours:h})
    : h ? t(ctx,'usage.duration.hours',{hours:h,minutes:m})
    : t(ctx,'usage.duration.minutes',{minutes:m});
  return t(ctx,'usage.go.resetsIn',{duration:value});
}
const displayWindow=(ctx,name)=> name==='Weekly'?t(ctx,'usage.go.weekly'):
  name?.startsWith('Weekly ·')?`${t(ctx,'usage.go.weekly')} ·${name.slice(6)}`:
  name==='Monthly'?t(ctx,'usage.go.monthly'):
  name==='5-hour'?'5 h':name;
function setRefreshSpinning(button,on){
  if(!button)return;
  // Animate only the glyph, not the button (which must remain in place).
  const glyph=button.firstChild;
  if(glyph?.style)glyph.style.animation=on?'pvUsageSpin 0.9s linear infinite':'';
  button.setAttribute('data-pv-refreshing',on?'true':'false');
  // Failure to install a CSS rule must not prevent reading limits.
  try {
    if(typeof document==='undefined'||!document.head||document.getElementById?.('usage-dashboard-spin-style'))return;
    const style=document.createElement('style');
    style.id='usage-dashboard-spin-style';
    style.textContent='@keyframes pvUsageSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }catch{}
}
function note(text){return $('div',`color:${palette.muted};font-size:11px;line-height:1.35`,text);}
// Compact two-column quota tiles. Reset times remain visible and readable, but
// no longer occupy a separate full-width row per limit.
function compactReset(ctx,ts){
  if(ts===null || !Number.isFinite(ts))return '';
  const minutes=Math.max(0,Math.ceil((ts-Date.now())/60000));
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;
  return days?t(ctx,'usage.duration.days',{days,hours}):hours?
    t(ctx,'usage.duration.hours',{hours,minutes:mins}):t(ctx,'usage.duration.minutes',{minutes:mins});
}
function progress(ctx,parent,win,mode='single'){
  const kind=presentation.classifyWindow(win.label);
  const five=kind==='fiveHour',weekly=kind==='weekly';
  const color=weekly&&win.remainingPercent<=0?palette.danger:
    five?palette.success:weekly?palette.fiveHour:palette.warning;
  const main=mode!=='dual'||five;
  const tile=add(parent,$('div',`box-sizing:border-box;min-width:0;padding:5px 6px 4px;border-radius:6px;background:rgba(125,135,155,.055)`));
  tile.setAttribute('data-pv-limit-tile',kind);
  const header=add(tile,$('div','display:flex;align-items:baseline;justify-content:space-between;gap:4px;min-width:0;line-height:1.2'));
  const label=add(header,$('span',`font-size:10px;color:${palette.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0`,displayWindow(ctx,win.label)));
  label.title=displayWindow(ctx,win.label);
  const numeric=add(header,$('strong',`font-variant-numeric:tabular-nums;white-space:nowrap;font-size:${main?12:11}px;color:${color}`,t(ctx,'usage.budget.left',{amount:pct(win.remainingPercent)})));
  numeric.setAttribute('data-pv-limit-number',kind);
  const track=add(tile,$('div',`margin-top:4px;height:3px;border-radius:999px;background:${palette.track};overflow:hidden`));
  const fill=add(track,$('div',`width:${Math.max(0,Math.min(100,win.remainingPercent))}%;height:100%;border-radius:999px;background:${color}`));
  fill.setAttribute('data-pv-limit-bar',kind);
  fill.setAttribute('role','progressbar');fill.setAttribute('aria-label',displayWindow(ctx,win.label));
  fill.setAttribute('aria-valuenow',String(win.remainingPercent));
  fill.setAttribute('aria-valuemin','0');fill.setAttribute('aria-valuemax','100');
  const reset=duration(ctx,win.resetsAt);
  if(reset){
    const label=add(tile,$('div',`font-size:10px;color:${palette.muted};line-height:1.15;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`,`↻ ${compactReset(ctx,win.resetsAt)}`));
    label.title=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(win.resetsAt));
  }
}
const PROVIDER_NAMES={codex:'OpenAI',claude:'Claude',gemini:'Gemini',deepseek:'DeepSeek',kimi:'Kimi',qwen:'Qwen',zai:'Z.AI',openrouter:'OpenRouter',minimax:'MiniMax',opencode:'OpenCode','opencode-go':'OpenCode Go'};
const providerLabel = provider => PROVIDER_NAMES[provider]||provider;

function compactCard(parent,active=false){
  const color=active?'rgba(69,191,141,.13)':palette.border;
  const bg=active?'rgba(69,191,141,.045)':'rgba(125,135,155,.035)';
  const card=add(parent,$('div',`box-sizing:border-box;min-width:0;padding:6px 7px;border:1px solid ${color};border-radius:8px;background:${bg}`));
  card.setAttribute('data-pv-account-card','true');
  return card;
}
function accountHeader(ctx,card,account,onSwitch,switchingID,api=false,summary=null,observedAt=null){
  const header=add(card,$('div','display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:20px;min-width:0'));
  const name=add(header,$('div','display:flex;align-items:center;min-width:0;gap:5px;flex:1'));
  const label=add(name,$('strong',`font-size:11.5px;line-height:1.25;font-weight:600;color:${palette.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0`,account.label));
  label.title=account.label;
  const provider=providerLabel(account.provider)+(api?' API':'');
  add(name,$('span',`font-size:10px;color:${palette.muted};white-space:nowrap;flex-shrink:0;padding:1px 4px;border-radius:4px;background:rgba(125,135,155,.08)`,provider));
  if(summary!==null){
    const amount=add(header,$('strong',`font-size:12px;color:${palette.text};font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0`,summary));
    amount.setAttribute('data-pv-api-amount','true');
    if(Number.isFinite(observedAt)){
      const raw=ctx.locale?.locale?.()||'en';
      const language=({zht:'zh-Hant',zh:'zh-Hans',br:'pt-BR',no:'nb-NO',pa:'pa-Arab-PK'})[raw]||raw;
      try{amount.title=new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short'}).format(new Date(observedAt));}catch{}
    }
  }
  if(account.active){
    const badge=add(header,$('span',`font-size:12px;color:${palette.success};flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px`,'✓'));
    badge.setAttribute('aria-label',t(ctx,'settings.providers.account.switched.description',{account:account.label}));
    badge.title=t(ctx,'settings.providers.account.switched.description',{account:account.label});
  }else if(onSwitch && account.message!=='plugin_ipc_unavailable' && account.id.includes(':') && !account.id.includes(':env:')){
    const b=add(header,$('button',`border:1px solid ${palette.border};border-radius:5px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;color:${palette.text};cursor:pointer;flex-shrink:0;padding:0`));
    b.type='button';b.dataset && (b.dataset.accountId=account.id);
    b.setAttribute('data-pv-switch-account',account.id);
    b.setAttribute('aria-label',`${t(ctx,'dialog.model.hint.select')}: ${account.label}`);
    b.title=`${t(ctx,'dialog.model.hint.select')}: ${account.label}`;
    const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrow.setAttribute('width','13');arrow.setAttribute('height','13');arrow.setAttribute('viewBox','0 0 24 24');
    arrow.setAttribute('fill','none');arrow.setAttribute('stroke','currentColor');arrow.setAttribute('stroke-width','1.8');
    arrow.setAttribute('stroke-linecap','round');arrow.setAttribute('stroke-linejoin','round');
    arrow.setAttribute('aria-hidden','true');
    for(const d of ['M4 7h16m-5-5 5 5-5 5','M20 17H4m5-5-5 5 5 5']){
      const line=document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d',d);arrow.appendChild(line);
    }
    b.appendChild(arrow);
    // Keep switches clickable while another activation is in flight.
    // Unstarted selections will be replaced by the latest one in the queue.
    b.disabled=false;
    b.addEventListener('click',()=>onSwitch(account.id));
  }
}
function renderProviderDetails(ctx,card,account,consoleRenderer=null){
  const ru=String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru'),tr=(en,rus)=>ru?rus:en;
  const labels={
    topped_up:tr('Top-up funds','Пополнения'),granted:tr('Granted funds','Бонусы'),cash:tr('Cash balance','Денежные средства'),voucher:tr('Vouchers','Ваучеры'),
    key_daily:tr('Key spend · today','Расход ключа · сегодня'),key_weekly:tr('Key spend · week','Расход ключа · неделя'),
    key_monthly:tr('Key spend · month','Расход ключа · месяц'),key_total:tr('Key spend · total','Расход ключа · всего'),
    byok_daily:tr('BYOK · today','BYOK · сегодня'),byok_weekly:tr('BYOK · week','BYOK · неделя'),byok_monthly:tr('BYOK · month','BYOK · месяц'),byok_total:tr('BYOK · total','BYOK · всего'),
    wallet_total_credits:tr('Wallet credits · total','Кредиты кошелька · всего'),wallet_total_usage:tr('Wallet spend · total','Расход кошелька · всего'),
    org_month_cost:tr('Organization spend · month (UTC)','Расход организации · месяц (UTC)'),org_model_cost:tr('Organization cost','Расход организации'),
    org_month_tokens:tr('Organization tokens · month (UTC)','Токены организации · месяц (UTC)'),org_month_requests:tr('Organization requests · month (UTC)','Запросы организации · месяц (UTC)'),
    org_model_tokens:tr('Organization tokens','Токены организации'),org_model_requests:tr('Organization requests','Запросы организации'),
    extra_balance:tr('Extra Usage balance','Остаток Extra Usage'),extra_total:tr('Extra Usage total','Extra Usage · всего'),
    extra_month_used:tr('Extra Usage spend · month','Extra Usage · расход за месяц'),extra_month_limit:tr('Extra Usage monthly cap','Extra Usage · месячный лимит'),
    tokens_24h:tr('Tokens · 24h (monitor)','Токены · 24 ч (мониторинг)'),requests_24h:tr('Requests · 24h','Запросы · 24 ч'),
    model_tokens_24h:tr('Tokens · 24h','Токены · 24 ч'),model_requests_24h:tr('Requests · 24h','Запросы · 24 ч'),
    search_24h:tr('Web searches · 24h','Веб-поиск · 24 ч'),web_read_24h:tr('Web reads · 24h','Чтение веб · 24 ч'),zread_24h:tr('ZRead · 24h','ZRead · 24 ч'),
    tool_calls_24h:tr('Search MCP · 24h','Поиск MCP · 24 ч'),grant_remaining:tr('Grant remaining','Остаток выделенных кредитов'),grant_used:tr('Grant used','Использовано кредитов'),plan_parallel:tr('Parallel requests','Параллельные запросы')
  };
  const groups={balance:tr('Balance','Баланс'),budget:tr('Budget','Бюджет'),usage:tr('Usage','Статистика'),cost:tr('Cost','Расходы'),tokens:tr('Tokens','Токены'),
    extra:'Extra Usage',tools:tr('Tools','Инструменты'),grants:tr('Credit grants','Выделенные кредиты'),breakdown:tr('Breakdown','Детализация'),quota:tr('Quota','Лимиты')};
  const reasons={
    unsupported:tr('not supported with existing connection','не поддерживается с текущим подключением'),
    no_usage_endpoint:tr('no supported endpoint','нет поддерживаемого API'),
    no_balance_access:tr('wallet requires a management key','кошелёк недоступен обычному API-ключу'),
    no_prepaid_balance:tr('no prepaid wallet','нет предоплаченного кошелька'),
    no_limit:tr('no configured cap returned','лимит не задан или не возвращён'),
    no_key_limit:tr('no individual key cap; other budgets not reported','лимит ключа не задан; другие бюджеты не возвращены'),
    no_applicable_budgets:tr('no applicable spending caps configured','нет настроенных лимитов расходов'),
    no_budgets:tr('no applicable budgets returned','нет доступных бюджетов'),
    not_returned:tr('not returned by provider','не возвращается провайдером'),
    unauthorized:tr('authorization rejected (401)','авторизация отклонена (401)'),
    forbidden:tr('access denied (403)','нет прав доступа (403)'),
    rate_limited:tr('request rate limited (429)','ограничена частота (429)'),
    request_failed:tr('request failed or timed out','ошибка или таймаут запроса'),
    invalid_payload:tr('unsupported response format','неподдерживаемый формат ответа'),
    invalid_balance:tr('invalid balance response','некорректный баланс'),
    missing_windows:tr('no usable quota returned','нет доступных лимитов'),
    missing_rate_limits:tr('no usable quota returned','нет доступных лимитов'),
    quota_unavailable:tr('unavailable','недоступны'),
    sharing_no_usage_api:tr('this sign-in method does not expose quotas','этот способ входа не предоставляет лимиты'),
    oauth_not_readable:tr('credential unavailable','учётные данные недоступны'),
    credential_not_readable:tr('credential unavailable','учётные данные недоступны'),
    login_expired:tr('login expired','срок входа истёк'),
    workspace_required:tr('workspace missing','workspace не указан'),
    unsupported_console:tr('unsupported Console origin','неподдерживаемый адрес Console'),
    plugin_ipc_unavailable:tr('plugin service unavailable','служба плагина недоступна'),
    insufficient_balance:tr('provider reports insufficient funds','провайдер сообщает о недостатке средств'),
    experimental:tr('experimental','экспериментально'),
    stale:tr('last known reading','последние известные данные')
  };
  const rows=account.metrics||[],notices=[...(account.notices||[])];
  const hasBalance=account.balance?.kind==='balance'&&Number.isFinite(account.balance.amount);
  const hasKey=account.keyBudget&&(Number.isFinite(account.keyBudget.limit)||account.keyBudget.effective||account.keyBudget.policies?.length);
  if(account.kind==='api'){
    if(!hasBalance&&!notices.some(n=>n.group==='balance'))notices.push({group:'balance',status:account.message==='no_usage_endpoint'||account.message==='api_key_connected'?'unsupported':account.message==='key_limit_only'?'no_balance_access':account.message});
    if(account.provider!=='opencode'&&!hasKey&&!notices.some(n=>n.group==='budget')){
      const status=account.provider==='openrouter'&&account.state!=='ok'?account.message:'unsupported';
      notices.push({group:'budget',status});
    }
    if(!rows.length&&!['opencode','claude','deepseek','kimi','openrouter','zai'].includes(account.provider)&&!notices.some(n=>n.group==='usage'))notices.push({group:'usage',status:'unsupported'});
  }else if(!account.windows?.length&&!account.modelWindows?.length&&!notices.some(n=>n.group==='quota'))notices.push({group:'quota',status:account.message});
  if(account.state==='stale')notices.unshift({group:'usage',status:'stale'});
  const style='font-size:9.5px;line-height:1.25;color:'+palette.muted;
  const list=add(card,$('div','display:flex;flex-direction:column;gap:2px;min-width:0;margin-top:3px'));
  const box=$('div','display:flex;flex-direction:column;gap:2px;padding-top:3px;min-width:0');
  // A wallet is the primary monetary metric. Only known limits can replace
  // it in the compact view; detailed spending and diagnostics stay collapsed.
  const validConsoleBudgets=(account.budgets||[]).filter(b=>Number.isFinite(b.remainingUsd)&&b.resetsAt>Date.now());
  if(account.kind==='api'&&account.state==='stale')add(list,$('span',style,tr('Last known reading','Последние известные данные')));
  const row=(parent,label,value,tip='')=>{
    const r=add(parent,$('div','display:flex;align-items:baseline;justify-content:space-between;gap:5px;min-width:0;'+style));
    const name=add(r,$('span','min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',label));
    add(r,$('span','flex-shrink:0;white-space:nowrap;font-variant-numeric:tabular-nums',value));r.title=tip||label;name.title=r.title;
    return r;
  };
  const limitBar=(parent,label,remaining,limit)=>{
    if(!Number.isFinite(remaining)||!Number.isFinite(limit)||remaining<0||limit<0||remaining>limit)return;
    const percent=limit>0?100*remaining/limit:0;
    const track=add(parent,$('div','height:3px;border-radius:2px;background:'+palette.track+';overflow:hidden'));
    const fill=add(track,$('div','height:100%;width:'+percent+'%;background:'+(remaining>0?palette.success:palette.danger)));
    fill.setAttribute('data-pv-remaining-bar','true');
    fill.setAttribute('role','progressbar');fill.setAttribute('aria-label',label);
    fill.setAttribute('aria-valuemin','0');fill.setAttribute('aria-valuemax','100');fill.setAttribute('aria-valuenow',String(percent));
  };
  const date=v=>{try{return Number.isFinite(v)?new Intl.DateTimeFormat(ru?'ru-RU':undefined,{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';}catch{return '—';}};
  if(account.keyBudget){
    const k=account.keyBudget,now=Date.now(),expired=k.expiresAt&&k.expiresAt<=now,reset=k.resetsAt&&k.resetsAt<=now;
    const scopes={workspace_default_member:tr('Default member cap','Бюджет участника по умолчанию'),
      workspace_default_key:tr('Default key cap','Бюджет ключа по умолчанию'),
      member:tr('Member budget','Бюджет участника'),api_key:tr('Key policy','Политика ключа'),
      workspace:tr('Shared workspace budget','Общий бюджет workspace'),key_limit:tr('Individual key cap','Индивидуальный лимит ключа')};
    const periods={daily:tr('daily','день'),weekly:tr('weekly','неделя'),monthly:tr('monthly','месяц'),none:tr('no reset','без сброса')};
    const showPolicy=(policy,isEffective=false)=>{
      const remaining=expired||policy.resetsAt&&policy.resetsAt<=now?null:policy.remaining;
      const title=scopes[policy.scope]||tr('Budget','Бюджет');
      row(box,(isEffective?tr('Effective: ','Основной: '):'')+title,money(remaining)+' / '+money(policy.limit),
        title+' · '+(periods[policy.period]||'—')+'\n'+tr('Spent: ','Расход: ')+money(remaining===null?null:policy.spent)+'\n'+tr('Resets: ','Сброс: ')+date(policy.resetsAt)+'\n'+tr('BYOK included: ','BYOK учитывается: ')+(policy.includeByok?tr('Yes','Да'):tr('No','Нет')));
    };
    if(k.effective)showPolicy(k.effective,true);
    let skippedEffective=false;
    for(const policy of k.policies||[]){
      if(!skippedEffective&&k.effective&&['scope','limit','spent','remaining','period','resetsAt','includeByok'].every(field=>policy[field]===k.effective[field])){
        skippedEffective=true;continue;
      }
      showPolicy(policy);
    }
    if(Number.isFinite(k.limit)&&!(k.policies||[]).some(b=>b.scope==='key_limit')&&k.effective?.scope!=='key_limit'){
      const period={daily:tr('daily','день'),weekly:tr('weekly','неделя'),monthly:tr('monthly','месяц'),none:tr('no reset','без сброса')}[k.period]||'—';
      row(box,tr('Key cap','Бюджет ключа')+' · '+period,money(expired||reset?null:k.remaining)+' / '+money(k.limit),
        tr('Key spending cap, not wallet money','Лимит расходов ключа, не баланс')+'\n'+tr('Resets: ','Сброс: ')+date(k.resetsAt));
    }
    const effective=presentation.openRouterBudget(account,now);
    if(!hasBalance&&effective){
      const label=scopes[effective.scope]||tr('Spending cap','Бюджет расходов');
      row(list,label,money(effective.remaining)+' / '+money(effective.limit),tr('Spending budget remaining, not wallet balance','Остаток бюджета расходов, не баланс')+'\n'+tr('Resets: ','Сброс: ')+date(effective.resetsAt));
      limitBar(list,label,effective.remaining,effective.limit);
    }
    if(Number.isFinite(k.expiresAt))row(box,tr('Key expires','Ключ истекает'),date(k.expiresAt));
    if(k.freeDaily){
      const q=k.freeDaily,remaining=expired||q.resetsAt<=now?null:q.remaining;
      const parent=remaining===null?box:list,label=tr('Free models · daily','Бесплатные модели · день');
      row(parent,label,(remaining===null?'—':remaining.toLocaleString(ru?'ru-RU':'en-US'))+' / '+q.limit.toLocaleString(ru?'ru-RU':'en-US'),
        tr('Daily free-model counter; exemptions and BYOK may not be subject to this ceiling.','Дневной счётчик бесплатных моделей; исключения и BYOK могут не ограничиваться этой квотой.')+'\n'+tr('Used: ','Использовано: ')+(remaining===null?'—':q.used)+'\n'+tr('Resets: ','Сброс: ')+date(q.resetsAt));
      if(remaining!==null)limitBar(parent,label,remaining,q.limit);
    }
  }
  const renderMetric=(parent,m)=>{
    const label=labels[m.code];if(!label)return;
    const expired=m.code.startsWith('grant_')&&m.at&&m.at<=Date.now();
    const spending=/^(?:key_|byok_|org_.*cost$|wallet_total_usage$|extra_month_used$|grant_used$)/.test(m.code);
    const amount=expired?'—':m.currency?(spending?presentation.formatSpend(m.value,m.currency):currencyAmount(m.value,m.currency)):Number(m.value).toLocaleString(ru?'ru-RU':'en-US');
    const timeLabel=m.code.startsWith('org_')?tr('Data refreshed: ','Данные обновлены: '):tr('Expires: ','Истекает: ');
    row(parent,label+(m.model?' · '+m.model:''),amount,m.at?timeLabel+date(m.at):'');
  };
  if(account.provider==='opencode'&&consoleRenderer){
    if(!hasBalance&&validConsoleBudgets.length){
      consoleRenderer(ctx,list,{...account,budgets:validConsoleBudgets},box);
      const other=(account.budgets||[]).filter(b=>!validConsoleBudgets.includes(b));
      if(other.length)consoleRenderer(ctx,box,{...account,budgets:other},box);
    }else consoleRenderer(ctx,box,account,box);
  }
  if(typeof account.keyBudget?.includeByok==='boolean')row(box,tr('BYOK included in cap','BYOK учитывается в лимите'),account.keyBudget.includeByok?tr('Yes','Да'):tr('No','Нет'));
  if(typeof account.keyBudget?.freeTier==='boolean')row(box,tr('Free tier','Бесплатный тариф'),account.keyBudget.freeTier?tr('Yes','Да'):tr('No','Нет'));
  for(const m of rows)renderMetric(box,m);
  for(const w of account.modelWindows||[])row(box,w.model+' · '+displayWindow(ctx,w.label),pct(w.remainingPercent),tr('Resets: ','Сброс: ')+date(w.resetsAt));
  // Keep the precise availability reasons accessible without filling the card
  // with repeated unsupported-metric messages.
  const grouped=new Map();
  for(const n of notices){
    if(!groups[n.group]||!reasons[n.status])continue;
    const names=grouped.get(n.status)||new Set();names.add(groups[n.group]);grouped.set(n.status,names);
  }
  for(const [status,names] of grouped){
    const line=add(box,$('span',style,[...names].join(' / ')+': '+reasons[status]));
    line.setAttribute('data-pv-metric-notice',status);
  }
  if(box.childNodes.length){
    const details=add(list,$('details','min-width:0;'+style));
    details.setAttribute('data-pv-account-details','true');
    details.open=expandedAccountDetails.has(account.id);
    add(details,$('summary','cursor:pointer;white-space:nowrap',tr('Statistics & details','Статистика и подробности')));
    details.addEventListener('toggle',()=>{if(details.open)expandedAccountDetails.add(account.id);else expandedAccountDetails.delete(account.id);});
    add(details,box);
  }
  if(!list.childNodes.length)list.remove();
}
function renderConsoleBudgets(ctx,card,account,statisticsParent=card){
  if(account.provider!=='opencode')return;
  const ru=String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru');
  const tr=(en,rus)=>ru?rus:en;
  const rows=Array.isArray(account.budgets)?account.budgets:[];
  const list=add(card,$('div','display:flex;flex-direction:column;gap:3px;margin-top:4px;min-width:0'));
  list.setAttribute('data-pv-console-budgets','true');
  const messages={
    no_budgets:tr('No applicable budgets returned','Нет доступных бюджетов'),
    forbidden:tr('Budget access denied (403)','Нет прав на чтение бюджета (403)'),
    unauthorized:tr('Budget authorization rejected (401)','Авторизация бюджета отклонена (401)'),
    workspace_required:tr('Workspace missing in connection','В подключении отсутствует workspace'),
    unsupported_console:tr('Unsupported Console origin','Неподдерживаемый адрес Console'),
    login_expired:tr('OpenCode login expired','Срок входа в OpenCode истёк'),
    credential_not_readable:tr('Credential unavailable','Учётные данные недоступны'),
    rate_limited:tr('Budget request rate limited','Ограничена частота запросов бюджета'),
    invalid_payload:tr('Unsupported budget response','Неподдерживаемый ответ бюджета'),
    plugin_ipc_unavailable:tr('Last known budgets','Последние известные бюджеты')
  };
  if(!rows.length){
    add(list,$('span','font-size:9.5px;color:'+palette.muted,messages[account.budgetMessage]||tr('Budget unavailable','Бюджет недоступен')));
    return;
  }
  if(account.state==='stale')add(list,$('span','font-size:9.5px;color:'+palette.muted,tr('Last known budgets','Последние известные бюджеты')));
  for(const budget of rows){
    const expired=budget.resetsAt<=Date.now();
    const remaining=expired?null:budget.remainingUsd;
    const label=budget.per==='model'?tr('Per-model budget · lowest','Бюджет на модель · мин. остаток'):
      budget.coverage==='all'?tr('All-spend budget','Общий бюджет расходов'):tr('Model-set budget','Бюджет группы моделей');
    const scope=budget.scope==='each'?tr('Individual','Личный'):budget.shared?tr('Shared workspace','Общий workspace'):tr('Shared group','Общая группа');
    const row=add(list,$('div','display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0;font-size:10px;color:'+palette.muted));
    const name=add(row,$('span','min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',label));
    const amount=add(row,$('span','flex-shrink:0;font-variant-numeric:tabular-nums;white-space:nowrap',money(remaining)+' / '+money(budget.limitUsd)));
    let reset='';
    try{reset=new Intl.DateTimeFormat(ru?'ru-RU':undefined,{dateStyle:'short',timeStyle:'short'}).format(new Date(budget.resetsAt));}catch{}
    row.title=[label,scope,tr('Spent: ','Расход: ')+money(expired?null:budget.spentUsd),tr('Resets: ','Сброс: ')+reset].join('\n');
    name.title=row.title;amount.title=row.title;
    if(!expired&&Number.isFinite(budget.spentUsd)){
      const spend=add(statisticsParent,$('div','font-size:9.5px;color:'+palette.muted,
        label+' · '+tr('Spent: ','Расход: ')+presentation.formatSpend(budget.spentUsd,'USD')));
      spend.title=row.title;
    }
    if(Number.isFinite(remaining)){
      const track=add(list,$('div','height:3px;border-radius:2px;background:'+palette.track+';overflow:hidden'));
      const fraction=budget.limitUsd>0?Math.min(1,Math.max(0,remaining/budget.limitUsd)):0;
      add(track,$('div','height:100%;width:'+(fraction*100)+'%;background:'+(remaining>0?palette.success:palette.danger)));
    }
  }
}
// Keep local provider history separate from individual account cards.
function renderLocalUsage(ctx,parent,data,accounts){
  const now=Date.now(),providers=[...new Set(accounts.filter(a=>presentation.needsLocalUsage(a,now)).map(a=>a.provider))];
  if(!providers.length)return;
  const ru=String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru'),tr=(en,rus)=>ru?rus:en;
  const wrapper=compactCard(parent);
  wrapper.setAttribute('data-pv-local-usage','true');
  const details=add(wrapper,$('details','min-width:0;font-size:10px;color:'+palette.muted));
  const expansionKey='local-usage'; // Account IDs contain a provider separator.
  details.open=expandedAccountDetails.has(expansionKey);
  add(details,$('summary','cursor:pointer;font-size:11px;color:'+palette.text,tr('OpenCode usage estimate','Оценка расхода OpenCode')));
  details.addEventListener('toggle',()=>{if(details.open)expandedAccountDetails.add(expansionKey);else expandedAccountDetails.delete(expansionKey);});
  const card=add(details,$('div','min-width:0;padding-top:3px'));
  add(card,$('div','font-size:9.5px;line-height:1.25;color:'+palette.muted,
    tr('All local accounts · UTC · not provider charges','Все локальные аккаунты · UTC · не списания')));
  const periods=['today','month'].map(period=>[period,presentation.localUsagePeriod(data,period,now)]);
  if(!periods.some(([,v])=>v)){
    add(card,note(tr('Local statistics unavailable','Локальная статистика недоступна')));
    return;
  }
  const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat(ru?'ru-RU':'en-US',{notation:'compact',maximumFractionDigits:2}).format(n):'—';
  for(const provider of providers){
    const group=add(card,$('div','margin-top:4px;padding-top:4px;border-top:1px solid '+palette.border));
    add(group,$('strong','font-size:10px;color:'+palette.text,providerLabel(provider)));
    const grid=add(group,$('div','display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:2px'));
    for(const [period,value] of periods){
      const row=value?.rows.find(r=>r.provider===provider);
      const cell=add(grid,$('div','min-width:0;line-height:1.25'));
      add(cell,$('div','font-size:9.5px;color:'+palette.muted,period==='today'?tr('Today','Сегодня'):tr('Month','Месяц')));
      add(cell,$('strong','font-size:12px;color:'+palette.text+';font-variant-numeric:tabular-nums;white-space:nowrap',
        Number.isFinite(row?.cost)?'≈ '+presentation.formatSpend(row.cost,'USD'):'—'));
      const counts=Number.isFinite(row?.tokens)?fmt(row.tokens)+' '+tr('tokens','ток.')+
        (Number.isFinite(row.steps)?' · '+fmt(row.steps)+' '+tr('steps','шаг.'):''):
        Number.isFinite(row?.steps)?fmt(row.steps)+' '+tr('steps','шаг.'):
        row?tr('Counters unavailable','Счётчики недоступны'):tr('No recorded data','Нет данных');
      add(cell,$('div','font-size:9.5px;color:'+palette.muted+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap',counts));
      const exact=n=>Number.isFinite(n)?n.toLocaleString(ru?'ru-RU':'en-US'):'—';
      cell.title=[tr('Local session statistics, all accounts; may include subscriptions and imported history.','Статистика локальных сессий по всем аккаунтам; может включать подписки и импортированные чаты.'),
        tr('Tokens: ','Токены: ')+exact(row?.tokens),tr('Steps: ','Шаги: ')+exact(row?.steps),
        value?tr('Through: ','По состоянию на: ')+new Date(value.to).toISOString():''].filter(Boolean).join('\n');
    }
  }
}
function renderLimits(ctx,target,data,onSwitch=null,switchingID=null,stableOrder=null) {
  empty(target);
  const all=presentation.connectedSubscriptions(data).concat(presentation.connectedApiKeys(data));
  // Preserve first-seen order. Switching cannot move cards even if the host
  // returns active credentials first or updates the provider inventory order.
  if(stableOrder){for(const account of all)if(!stableOrder.has(account.id))stableOrder.set(account.id,stableOrder.size);}
  const order=(items)=>stableOrder?[...items].sort((a,b)=>(stableOrder.get(a.id)??Infinity)-(stableOrder.get(b.id)??Infinity)):items;
  const accounts=order(presentation.connectedSubscriptions(data));
  const apiAccounts=order(presentation.connectedApiKeys(data));
  const budgets=presentation.availableApiBudgets(data);
  if(!accounts.length&&!apiAccounts.length&&!budgets.length){
    const initial=!data?.checkedAt;
    const unavailable=data?.inventoryWarning==='credentials_unavailable'||data?.inventoryWarning==='connections_unavailable';
    const lang=ctx.locale?.locale?.()||'en';
    const ru=String(lang).toLowerCase().startsWith('ru');
    const message=initial?(ru?'Загружаем подключённые аккаунты…':'Loading connected accounts…')
      :unavailable?(ru?'Не удалось получить список аккаунтов из OpenCode.':'Could not read accounts from OpenCode.')
      :(ru?'Подключённые аккаунты не найдены.':'No connected accounts found.');
    const node=add(target,note(message));
    node.setAttribute('data-pv-empty-state',initial?'loading':unavailable?'unavailable':'none');
    return;
  }
  const list=add(target,$('div','display:flex;flex-direction:column;gap:4px'));
  for(const account of accounts){
    const card=compactCard(list,account.active);
    accountHeader(ctx,card,account,onSwitch,switchingID);
    if(account.windows.length){
      const hasBoth=account.windows.some(w=>presentation.classifyWindow(w.label)==='fiveHour') &&
        account.windows.some(w=>presentation.classifyWindow(w.label)==='weekly');
      const ordered=[...account.windows].sort((a,b)=>{
        const rank={fiveHour:0,weekly:1,other:2};
        return rank[presentation.classifyWindow(a.label)]-rank[presentation.classifyWindow(b.label)];
      });
      const grid=add(card,$('div',`display:grid;grid-template-columns:${hasBoth?'repeat(2,minmax(0,1fr))':'minmax(0,1fr)'};gap:5px;margin-top:5px;min-width:0`));
      grid.setAttribute('data-pv-metrics-grid',hasBoth?'dual':'single');
      for(const win of ordered)progress(ctx,grid,win,hasBoth?'dual':'single');
    } else {
      const ru=String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru');
      add(card,$('div',`color:${palette.muted};font-size:10px;margin-top:2px`,ru?'Общие лимиты недоступны':'General quotas unavailable'));
    }
    const footerItems=[];
    if(account.credits!==null)footerItems.push(`🪙 ${account.credits}`);
    if(account.state==='stale' && Number.isFinite(account.checkedAt)) {
      const raw=ctx.locale?.locale?.()||'en';
      const lang=({zht:'zh-Hant',zh:'zh-Hans',br:'pt-BR',no:'nb-NO'})[raw]||raw;
      try{footerItems.push(`◷ ${new Intl.DateTimeFormat(lang,{dateStyle:'short',timeStyle:'short'}).format(new Date(account.checkedAt))}`);}catch{}
    }
    if(footerItems.length)add(card,$('div',`color:${palette.muted};font-size:10px;line-height:1.2;margin-top:3px`,footerItems.join('  ·  ')));
    renderProviderDetails(ctx,card,account);
  }
  for(const account of apiAccounts){
    const card=compactCard(list,account.active);
    const own=account.balance;
    const hasOwn=own && Number.isFinite(own.amount) && ['USD','CNY'].includes(own.currency);
    const routerBudget=presentation.openRouterBudget(account);
    const actualWallet=hasOwn&&own.kind==='balance';
    const consoleBudget=presentation.tightestGeneralBudget(account);
    const shownBudget=!actualWallet&&(routerBudget||consoleBudget);
    const display=actualWallet?currencyAmount(own.amount,own.currency):shownBudget?money(shownBudget.remaining??shownBudget.remainingUsd):'—';
    accountHeader(ctx,card,account,onSwitch,switchingID,true,display,actualWallet||shownBudget?account.checkedAt:null);
    const amountEl=card.querySelector('[data-pv-api-amount]');
    const ru=String(ctx.locale?.locale?.()||'en').startsWith('ru');
    if(amountEl&&shownBudget){
      amountEl.title=[ru?'Остаток бюджета расходов, не средства кошелька.':'Remaining spending budget, not wallet funds.',amountEl.title].filter(Boolean).join('\n');
    }else if(amountEl && (!actualWallet||account.state==='stale')){
      const reasons={
        plugin_ipc_unavailable:['Plugin service unavailable; inventory-only mode.','Служба плагина недоступна; режим списка аккаунтов.'],
        credential_not_readable:['The host did not supply a readable API credential.','OpenCode не предоставил доступный API-ключ.'],
        unauthorized:['Provider rejected authorization (401).','Провайдер отклонил авторизацию (401).'],
        forbidden:['Provider denied access (403).','Провайдер запретил доступ (403).'],
        rate_limited:['Provider rate limited the request (429).','Провайдер ограничил частоту запросов (429).'],
        request_failed:['Provider request failed or timed out.','Ошибка или таймаут запроса к провайдеру.'],
        invalid_payload:['Provider returned an unsupported response.','Провайдер вернул неподдерживаемый ответ.'],
        invalid_balance:['Provider returned an invalid balance.','Провайдер вернул некорректный баланс.'],
        no_balance_access:['API key has no readable wallet balance or spending cap.','Ключ не предоставляет доступ к балансу или лимиту расходов.'],
        no_usage_endpoint:['No supported prepaid balance endpoint.','Нет поддерживаемого API получения остатка средств.'],
        no_prepaid_balance:['Workspace does not use prepaid credits.','Workspace не использует предоплаченные кредиты.'],
        unsupported_console:['Unsupported Console origin.','Неподдерживаемый адрес Console.'],
        workspace_required:['Workspace is missing from the existing connection.','В существующем подключении отсутствует workspace.'],
        login_expired:['OpenCode login expired.','Срок входа в OpenCode истёк.']
      };
      const reason=reasons[account.message]?.[ru?1:0];
      const note=actualWallet?(ru?'Последний подтверждённый баланс.':'Last confirmed balance.')
        :(ru?'Баланс недоступен; это не означает нулевой остаток.':'Balance unavailable; this does not mean zero.');
      amountEl.title=[note,reason,amountEl.title].filter(Boolean).join('\n');
    }
    const extras=Array.isArray(account.balances)?account.balances.filter(b=>b && b.kind==='balance' && b.currency!==own?.currency && Number.isFinite(b.amount)):[];
    if(extras.length) add(card,$('div',`margin-top:2px;font-size:10px;color:${palette.muted};font-variant-numeric:tabular-nums`,
      extras.map(b=>currencyAmount(b.amount,b.currency)).join(' · ')));
    if(shownBudget){
      const lang=ctx.locale?.locale?.()||'en';
      const label=String(lang).startsWith('ru')?'Остаток бюджета расходов, не баланс':'Spending budget remaining, not wallet balance';
      const noteEl=add(card,$('span',`font-size:9.5px;color:${palette.muted}`,label));noteEl.setAttribute('data-pv-key-limit-label','true');
    }
    renderProviderDetails(ctx,card,account,renderConsoleBudgets);
  }
  renderLocalUsage(ctx,list,data,all);
  // An organization monthly spend cap is NOT an API credit balance. Keep
  // budgets in a separate compact row, never merge the two amounts.
  for(const budget of budgets){
    const card=add(list,$('div',`display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:5px 7px;border-radius:7px;border:1px solid ${palette.border}`));
    const label=add(card,$('strong',`color:${palette.text};font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0`,budget.label));
    label.title=budget.label;
    const amount=add(card,$('span',`color:${palette.muted};font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0`,`${t(ctx,'usage.budget.left',{amount:money(budget.usdRemainingBudget)})} · ${t(ctx,'usage.budget.of',{limit:money(budget.monthlyBudgetUsd)})}`));
    amount.title=amount.textContent;
  }
}
// The plugin main process owns tokens and cache. When its IPC is temporarily
// unavailable, window code may show only NON-SECRET integration connection
// metadata; never ask the window for raw credentials or tokens.
function publicIntegrationAccounts(value) {
  const list=Array.isArray(value)?value:Array.isArray(value?.data)?value.data:Array.isArray(value?.data?.data)?value.data.data:[];
  const accounts=[];
  for(const integration of list){
    const ids={codex:['openai','codex','chatgpt','openai-chatgpt'],
      claude:['anthropic','claude','claude-agent','claude-code','anthropic-agent'],
      gemini:['google','google-ai','gemini','google-generative-ai'],deepseek:['deepseek'],
      kimi:['moonshotai','moonshotai-cn','moonshot','moonshot-cn','kimi','kimi-coding','kimi-for-coding'],
      qwen:['alibaba','dashscope','qwen','qwen-code'],
      zai:['zai','zai-coding-plan','zai-cn-coding-plan','zhipuai','zhipuai-coding-plan','glm'],
      openrouter:['openrouter'],minimax:['minimax','minimax-cn','minimax-coding-plan','minimax-cn-coding-plan'],
      opencode:['opencode'],'opencode-go':['opencode-go']};
    const provider=Object.keys(ids).find(p=>ids[p].includes(String(integration?.id||'').toLowerCase()))||null;
    if(!provider||!Array.isArray(integration.connections))continue;
    for(const conn of integration.connections){
      if(conn?.type!=='credential'||typeof conn.id!=='string'||conn.status?.status==='needs_auth')continue;
      const kind=provider==='opencode-go'?'subscription':provider==='opencode'?'api':
        conn.method==='key'&&!/(?:coding-plan|kimi-(?:for-)?coding)$/.test(integration.id)?'api':'subscription';
      const rawLabel=typeof conn.label==='string'?conn.label.trim():'';
      const label=rawLabel&&!/^\s*(sk-[\w-]+|oc_sk_[\w-]+|Bearer\s+|eyJ[A-Za-z0-9_-]{24,})/.test(rawLabel)
        ?rawLabel.replace(/[\x00-\x1f]/g,'').slice(0,90):`${providerLabel(provider)} account`;
      accounts.push({id:`${integration.id}:${conn.id}`,provider,kind,label,
        source:'OpenCode',active:false,state:'unavailable',message:'plugin_ipc_unavailable',windows:[],credits:null,balance:null,balances:[],budgets:[],budgetMessage:null,metrics:[],notices:[],keyBudget:null,modelWindows:[],checkedAt:0});
    }
  }
  return accounts.slice(0,80);
}
async function bounded(call,ms=10000) {
  const controller=typeof AbortController==='function'?new AbortController():null;
  let timer;
  const timeout=new Promise((_,reject)=>{
    if(controller){controller.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});
      timer=setTimeout(()=>controller.abort(),ms);
    }else timer=setTimeout(()=>reject(new Error('timeout')),ms);
  });
  try{return await Promise.race([Promise.resolve().then(()=>call(controller?.signal)),timeout]);}
  finally{if(timer!==undefined)clearTimeout(timer);controller?.abort();}
}
async function publicIntegrationFallback(ctx) {
  // Never call credential.list() here: unlike integration.list(), it includes secrets.
  try{
    const api=ctx.client?.integration;
    if(!api||typeof api.list!=='function')return null;
    const raw=await bounded(signal=>api.list(undefined,{signal}),6000);
    const accounts=publicIntegrationAccounts(raw);
    return {accounts,organizations:[],localUsage:{today:null,month:null},inventoryWarning:'plugin_main_unavailable',checkedAt:Date.now()};
  }catch{return null;}
}
function createView(ctx,client,{compact=false}={}) {
  const root=$('section',`box-sizing:border-box;min-width:0;${compact?'overflow:visible;':'overflow-y:auto;max-height:100%;'}padding:${compact?'8px 9px':'16px'};color:${palette.text};font-family:inherit;background:${compact?'var(--v2-background-bg-layer-02, var(--background,#18191d))':'transparent'}`);
  const header=add(root,$('div','display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid ${palette.border}'));
  const heading=add(header,$('strong',`font-size:12px;color:${palette.text}`,t(ctx,'usage.title')));
  const refresh=add(header,$('button',`background:transparent;color:${palette.muted};border:0;cursor:pointer;font-size:16px;padding:2px 4px;display:flex;align-items:center;justify-content:center;min-width:22px;min-height:22px`));
  add(refresh,$('span','display:inline-block;transform-origin:center;line-height:1','↻'));
  refresh.type='button';refresh.setAttribute('aria-label',t(ctx,'usage.retry'));refresh.title=t(ctx,'usage.retry');
  const body=add(root,$('div'));
  let alive=true,running=false,hasData=false,lastSnapshot=null,lastServerSnapshot=null,queuedRefresh=false,coldRefreshRequested=false,switchSequence=0,commitVersion=0;
  const stableOrder=stableAccountOrder;
  const desiredByProvider=new Map();
  const applyDesired=snapshot=>{
    if(!snapshot)return snapshot;
    // A popup may close while activation is still running. The global pending
    // intention also protects a newly opened popup from stale account flags.
    const pending=new Map([...desiredByProvider,...visualIntents]);
    return pending.size?{...snapshot,accounts:(snapshot.accounts||[]).map(a=>
      pending.has(a.provider)?{...a,active:a.id===pending.get(a.provider)}:a)}:snapshot;
  };
  const showSnapshot=(snapshot,verified=true)=>{
    if(!alive||!snapshot)return;
    if(verified){
      if(snapshot.checkedAt||snapshot.accounts?.length){
        latestVerifiedSnapshot=snapshot;
        lastServerSnapshot=snapshot;
      }
    }else{
      snapshot=presentation.mergeInventoryFallback(snapshot,lastServerSnapshot||latestVerifiedSnapshot);
    }
    lastSnapshot=applyDesired(snapshot);
    hasData=!!(snapshot.accounts?.length||snapshot.organizations?.length||snapshot.checkedAt);
    renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder);
  };
  // Queued requests are serialized per provider. While one is running,
  // subsequent clicks replace the *unstarted* request; no interim API call.
  const activations=switchQueue.createLatestWinsQueue(async(_provider,id)=>
    bounded(signal=>client.activate({id},{signal}),30000));
  let disposeState=()=>{};
  const ru=()=>String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru');
  const msg=(english,russian)=>ru()?russian:english;
  function errorState(code){
    if(!alive)return;
    if(lastSnapshot){renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder);}
    else empty(body);
    const status=add(body,note(code==='timeout'?
      msg('The plugin service did not respond. Try refresh.','Служба плагина не отвечает. Попробуй обновить.'):
      code==='fallback'?
      msg('Accounts found, but the plugin service is unavailable. Restart OpenCode Desktop or check Settings → Extensions → Plugins.',
          'Аккаунты найдены, но служба плагина недоступна. Перезапусти OpenCode Desktop или проверь Настройки → Расширения → Плагины.'):
      msg('The plugin service is unavailable. Check Settings → Extensions → Plugins.','Служба плагина недоступна. Проверь Настройки → Расширения → Плагины.')));
    status.setAttribute('data-pv-ipc-error',code);
  }
  async function load(force=false){
    if(!alive)return;
    if(running){if(force)queuedRefresh=true;return;}
    running=true;
    const startedSwitch=switchSequence,startedCommit=commitVersion;
    setRefreshSpinning(refresh,true);
    // Keep Refresh clickable even while the initial cached call is pending.
    try{
      const snapshot=await bounded(signal=>force?client.refresh({signal}):client.get({signal}),force?15000:8000);
      if(!alive||startedSwitch!==switchSequence||startedCommit!==commitVersion||activations.busy())return;
      showSnapshot(snapshot);
      if(!hasData&&!force&&!coldRefreshRequested){coldRefreshRequested=true;queuedRefresh=true;}
      if(force)notifySnapshot(snapshot);
      // The main process initializes a cold cache in the background. The next
      // 5-second UI poll will observe it, without starting a new network call.
    }catch(error){
      if(!alive||startedSwitch!==switchSequence||startedCommit!==commitVersion||activations.busy())return;
      const fallback=await publicIntegrationFallback(ctx);
      if(!alive||startedSwitch!==switchSequence||startedCommit!==commitVersion||activations.busy())return;
      if(fallback?.accounts?.length){
        showSnapshot(fallback,false);
        errorState('fallback');
      }else{
        errorState(error?.message==='timeout'?'timeout':'ipc');
      }
    }finally{
      running=false;setRefreshSpinning(refresh,false);
      if(queuedRefresh && alive){queuedRefresh=false;void load(true);}
    }
  }
  // Latest-click-wins UX. Render the requested account immediately, then
  // serialize the actual OpenCode activations. Stale confirmations and failed
  // requests may never overwrite a more recent user choice.
  function activate(id){
    if(!alive||!client.activate||!lastSnapshot)return;
    const target=lastSnapshot.accounts?.find(a=>a.id===id && a.source==='OpenCode' && a.message!=='plugin_ipc_unavailable');
    if(!target || desiredByProvider.get(target.provider)===id)return;
    const provider=target.provider;
    ++switchSequence;
    if(!lastServerSnapshot)lastServerSnapshot=lastSnapshot;
    desiredByProvider.set(provider,id);
    visualIntents.set(provider,id);
    latestSelectedID=id;
    lastSnapshot=applyDesired(lastServerSnapshot);
    notifySnapshot(lastSnapshot);
    renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder);

    void activations.enqueue(provider,id).then(result=>{
      if(result.status==='superseded')return;
      const snapshot=result.value;
      // Keep a completed older activation as the rollback baseline, but do
      // not display it while a newer queued choice is still desired.
      lastServerSnapshot=snapshot;
      latestVerifiedSnapshot=snapshot;
      commitVersion++;
      if(desiredByProvider.get(provider)===id)desiredByProvider.delete(provider);
      // Do not clear a newer choice made from another popup/window.
      if(visualIntents.get(provider)===id)visualIntents.delete(provider);
      lastSnapshot=applyDesired(snapshot);
      hasData=true;
      notifySnapshot(lastSnapshot);
      if(alive)renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder);
    }).catch(()=>{
      if(desiredByProvider.get(provider)!==id)return;
      // A failed older selection must never discard a newer queued choice.
      desiredByProvider.delete(provider);
      const ownsLatest=visualIntents.get(provider)===id;
      if(ownsLatest)visualIntents.delete(provider);
      lastSnapshot=applyDesired(lastServerSnapshot||lastSnapshot);
      if(ownsLatest){
        const selected=lastSnapshot.accounts?.find(a=>a.provider===provider&&a.active);
        latestSelectedID=selected?.id||null;
      }
      notifySnapshot(lastSnapshot);
      if(alive){
        renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder);
        add(body,note(t(ctx,'usage.error')));
      }
    });
  }
  // IPC state is the currently cached snapshot from the background process.
  // It is pushed on initial disk load, refresh and account changes, so reopening
  // a popup never depends on a polling interval.
  if(typeof client.state==='function' && typeof createEffect==='function' && typeof createRoot==='function'){
    // A hover popup starts from a DOM event, outside Solid's component owner.
    // Give its state subscription an explicit lifetime to avoid listener leaks.
    createRoot(dispose=>{
      disposeState=dispose;
      createEffect(()=>{
        const latest=client.state();
        if(!alive||!latest)return;
        // A pushed main update supersedes an older request or inventory fallback.
        commitVersion++;
        showSnapshot(latest);
      });
    });
  }
  refresh.addEventListener('click',()=>void load(true));
  const timer=setInterval(()=>void load(false),5000);
  const destroy=()=>{alive=false;clearInterval(timer);disposeState();};
  if(!compact)onCleanup(destroy);
  void load();
  return {root,load,destroy};
}
// A compact 3-mode circular indicator. Only API mode shows numeric text.
// Account quota percentages stay accessible in the hover card and tooltip.
function indicatorGraphic(){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 50 50');svg.setAttribute('width','28');svg.setAttribute('height','28');
  svg.setAttribute('aria-hidden','true');
  const make=(tag,attrs,parent=svg)=>{
    const item=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))item.setAttribute(k,String(v));
    parent.appendChild(item);return item;
  };
  const C=Math.PI*2;
  const ring=(parent,r,width,color)=>{
    const circumference=C*r;
    make('circle',{cx:25,cy:25,r,fill:'none',stroke:palette.track,'stroke-width':width},parent);
    const arc=make('circle',{cx:25,cy:25,r,fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round',transform:'rotate(-90 25 25)','stroke-dasharray':circumference,'stroke-dashoffset':circumference},parent);
    return {arc,circumference};
  };
  const label=(size,y,weight=700,parent=svg)=>{
    const t=make('text',{x:25,y,'text-anchor':'middle',fill:'currentColor','font-size':size,'font-weight':weight,'font-variant-numeric':'tabular-nums'},parent);
    return t;
  };
  const dual=make('g',{'data-pv-indicator-mode':'dual'});
  // Variant 1: clearer concentric rings with matched thickness and stronger contrast.
  // Outer green ring = 5-hour, inner blue/red ring = weekly.
  const dualOuter=ring(dual,22,6,palette.success);
  const dualInner=ring(dual,14.5,6,palette.fiveHour);

  const single=make('g',{'data-pv-indicator-mode':'single'});
  const singleRing=ring(single,22,6,palette.fiveHour);

  const api=make('g',{'data-pv-indicator-mode':'api'});
  const apiRing=ring(api,22,6,palette.success);
  const apiText=label(10.5,28,700,api);

  const unavailable=make('g',{'data-pv-indicator-mode':'unavailable'});
  const unknownRing=ring(unavailable,22,6,palette.track);

  const setArc=(ringInfo,percent,color)=>{
    ringInfo.arc.setAttribute('stroke',color);
    const p=Math.max(0,Math.min(100,Number(percent)||0));
    ringInfo.arc.setAttribute('stroke-dashoffset',String(ringInfo.circumference*(1-p/100)));
  };

  function draw(state){
    const mode=state.mode;
    for(const [name,group] of Object.entries({dual,single,api,unavailable})) group.style.display=name===mode?'':'none';
    if(mode==='dual'){
      setArc(dualOuter,state.fiveHour,palette.success);
      setArc(dualInner,state.weekly<=0?100:state.weekly,state.weekly<=0?palette.danger:palette.fiveHour);
    }else if(mode==='single'){
      const color=state.kind==='weekly'?(state.value<=0?palette.danger:palette.fiveHour):state.kind==='fiveHour'?palette.success:palette.warning;
      setArc(singleRing,state.kind==='weekly'&&state.value<=0?100:state.value,color);
    }else if(mode==='api'){
      const amount=state.amount;
      const balance=amount===null?'—':currencyAmount(amount,state.currency||'USD');
      apiText.textContent=balance;
      const size=balance.length<=6?10:balance.length<=8?8.2:balance.length<=10?7:6;
      apiText.setAttribute('font-size',String(size));
      if(balance.length>10){apiText.setAttribute('textLength','41');apiText.setAttribute('lengthAdjust','spacingAndGlyphs');}
      else {apiText.removeAttribute?.('textLength');apiText.removeAttribute?.('lengthAdjust');}
      apiRing.arc.setAttribute('stroke',amount===null?palette.track:amount<=0?palette.danger:state.metric==='budget'?palette.warning:palette.success);
      apiRing.arc.setAttribute('stroke-dashoffset','0');
    }else{
      unknownRing.arc.setAttribute('stroke',palette.track);
      unknownRing.arc.setAttribute('stroke-dashoffset','0');
    }
  }
  draw({mode:'unavailable'});
  return {svg,draw};
}

// Narrow DOM adapter for the desktop layouts. Vertical tabs retain the
// existing in-flow footer; confirmed top tabs use a compact viewport anchor.
// Only the plugin's own wrapper moves. Native updater alignment is separate
// and reversible, and is enabled exclusively in the vertical sidebar.
const VERTICAL_SIDEBAR_SELECTOR='aside[data-slot="vertical-tabs-sidebar"]';
const SIDEBAR_SELECTOR=VERTICAL_SIDEBAR_SELECTOR+' [data-slot="vertical-tabs-mount"]';
const TOP_TABS_SELECTOR='[data-slot="titlebar-tabs"]';
const LAYOUT_SLOTS='[data-slot="vertical-tabs-sidebar"],[data-slot="vertical-tabs-mount"],[data-slot="vertical-tabs-footer"],'+TOP_TABS_SELECTOR;
function sidebarMount(documentRef=document){
  if(typeof documentRef.querySelector!=='function')return null;
  const mount=documentRef.querySelector(SIDEBAR_SELECTOR);
  if(!mount)return null;
  // OpenCode renders its real sidebar INSIDE a full-height Portal child of the
  // mount. A sibling of that child is outside the viewport and gets clipped.
  // Append within the Portal so the icon follows the native footer in flow.
  return Array.from(mount.children||[]).find(child => {
    const classes=String(child.getAttribute?.('class')||child.className||'').split(/\s+/);
    return classes.includes('size-full')&&classes.includes('flex-col');
  })||null;
}
function indicatorMount(documentRef=document){
  const sidebar=sidebarMount(documentRef);
  if(sidebar)return sidebar;
  // A vertical sidebar may exist before its Portal mounts. Never mistake
  // that transient state, or an unknown layout, for the horizontal layout.
  if(documentRef.querySelector(VERTICAL_SIDEBAR_SELECTOR))return null;
  const topTabs=Array.from(documentRef.querySelectorAll(TOP_TABS_SELECTOR)).some(tabs=>
    !tabs.closest('[data-slot="mobile-tabs-drawer"]')&&tabs.getClientRects().length>0);
  return topTabs?documentRef.body:null;
}
function layoutMutation(change){
  const source=change.target;
  return source?.matches?.(LAYOUT_SLOTS) ||
    source?.closest?.('[data-slot="vertical-tabs-footer"]') ||
    Array.from([...(change.addedNodes||[]),...(change.removedNodes||[])]).some(el=>
      el?.matches?.(LAYOUT_SLOTS)||el?.querySelector?.(LAYOUT_SLOTS));
}
function buildSidebarButton(ctx,client,{onResize,getUpdaterBounds}={}){
  const sidebarStyle=`box-sizing:border-box;flex:0 0 auto;margin-top:auto;min-height:40px;display:flex;align-items:center;justify-content:flex-start;padding:4px 4px 0;border-top:1px solid ${palette.border}`;
  const topTabsStyle='box-sizing:border-box;position:fixed;left:8px;bottom:max(8px,env(safe-area-inset-bottom,0px));z-index:30;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:transparent';
  const wrapper=$('div',sidebarStyle);
  wrapper.setAttribute('data-pv-usage-sidebar','true');
  const setLayout=mode=>{
    wrapper.style.cssText=mode==='top-tabs'?topTabsStyle:sidebarStyle;
    wrapper.setAttribute('data-pv-usage-layout',mode);
  };
  const button=add(wrapper,$('button',`box-sizing:border-box;width:32px;height:32px;min-width:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border-radius:50%;background:transparent;color:${palette.text};border:0;padding:0;box-shadow:none;appearance:none`));
  button.type='button';button.setAttribute('data-pv-usage-trigger','true');button.setAttribute('aria-label',t(ctx,'usage.title'));
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.title=t(ctx,'usage.title');
  const gauge=indicatorGraphic();add(button,gauge.svg);
  let alive=true,open=false,overlay=null,shown=null,closeTimer=null,reading=false,preferredID=null;
  const clearClose=()=>{if(closeTimer!==null){clearTimeout(closeTimer);closeTimer=null;}};
  // Anchor the popup by its BOTTOM edge when the trigger is near the bottom
  // of the screen. Its position does not depend on its measured content height:
  // async quota results can grow the popup without moving it off-screen.
  // The popup itself scrolls when more accounts arrive than can fit.
  const position=()=>{
    if(!overlay)return;
    const rect=button.getBoundingClientRect();
    const vw=window.innerWidth||document.documentElement.clientWidth||1024;
    const vh=window.innerHeight||document.documentElement.clientHeight||768;
    const margin=12, gap=10;
    const width=Math.max(0,Math.min(308,vw-2*margin));
    overlay.style.width=`${width}px`;
    const updateRight=getUpdaterBounds?.()?.right;
    let left=Math.max(rect.right,Number.isFinite(updateRight)?updateRight:rect.right)+gap;
    if(left+width>vw-margin)left=rect.left-width-gap;
    overlay.style.left=`${Math.max(margin,Math.min(left,vw-margin-width))}px`;
    // For a bottom sidebar button there is usually much more space ABOVE it.
    const above=Math.max(0,rect.bottom-margin);
    const below=Math.max(0,vh-rect.top-margin);
    const openAbove=above>=below;
    const available=openAbove?above:below;
    overlay.style.maxHeight=`${Math.floor(Math.min(520,vh*0.65,available))}px`;
    if(openAbove){
      overlay.style.top='auto';
      overlay.style.bottom=`${Math.max(0,vh-rect.bottom)}px`;
    }else{
      overlay.style.bottom='auto';
      overlay.style.top=`${Math.max(0,rect.top)}px`;
    }
  };
  const hide=()=>{
    clearClose();if(!open)return;open=false;
    button.setAttribute('aria-expanded','false');
    if(shown){shown.destroy();shown=null;}
    if(overlay){overlay.remove();overlay=null;}
  };
  const later=()=>{clearClose();closeTimer=setTimeout(()=>{
    const focus=typeof document!=='undefined'?document.activeElement:null;
    if(!button.matches(':hover')&&!button.matches(':focus-visible')&&!(overlay&&overlay.matches(':hover'))&&!(overlay&&focus&&overlay.contains(focus)))hide();
  },260);};
  const show=()=>{
    clearClose();if(open||!alive||!wrapper.isConnected)return;open=true;
    button.setAttribute('aria-expanded','true');
    overlay=$('div',`position:fixed;z-index:9999;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid ${palette.border};border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.32);background:var(--v2-background-bg-layer-02,var(--background,#18191d));color:${palette.text}`);
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label',t(ctx,'usage.title'));overlay.setAttribute('data-pv-usage-popup','true');
    document.body.appendChild(overlay);
    shown=createView(ctx,client,{compact:true});overlay.appendChild(shown.root);
    overlay.addEventListener('pointerenter',clearClose);overlay.addEventListener('pointerleave',later);overlay.addEventListener('focusout',later);
    position();
  };
  const updateGauge=data=>{
    const wanted=visualIntents.size?[...visualIntents.values()].at(-1):null;
    const forced=wanted?data?.accounts?.find(a=>a.id===wanted):null;
    const preferred=preferredID?data?.accounts?.find(a=>a.id===preferredID):null;
    if(!wanted&&preferred&&!preferred.active)preferredID=null;
    const account=forced||presentation.indicatorAccount(data,preferredID);
    const metric=presentation.indicatorPresentation(account,data);
    gauge.draw(metric);
    const detail=metric.mode==='dual'
      ?`${displayWindow(ctx,'5-hour')}: ${pct(metric.fiveHour)} · ${displayWindow(ctx,'Weekly')}: ${pct(metric.weekly)}`
      :metric.mode==='single'?`${metric.kind==='other'?t(ctx,'usage.title'):displayWindow(ctx,metric.kind==='weekly'?'Weekly':'5-hour')}: ${pct(metric.value)}`
      :metric.mode==='api'?(metric.amount===null?'—':metric.metric==='budget'?t(ctx,'usage.budget.left',{amount:currencyAmount(metric.amount,metric.currency||'USD')}):currencyAmount(metric.amount,metric.currency||'USD')):'—';
    const title=account?`${account.label} · ${detail}`:t(ctx,'usage.title');
    button.setAttribute('aria-label',title);button.title=title;
  };
  async function poll(){
    if(reading||!alive)return;reading=true;
    try{const data=await client.get({signal:ctx.signal});if(alive)updateGauge(data);}catch{if(alive)gauge.draw({mode:'unavailable'});}
    finally{reading=false;}
  }
  button.addEventListener('pointerenter',show);button.addEventListener('pointerleave',later);
  button.addEventListener('focus',()=>show());button.addEventListener('blur',later);
  button.addEventListener('click',()=>{if(open)hide();else show();});
  const key=event=>{if(event.key==='Escape')hide();};
  const resize=()=>{position();onResize?.();};
  window.addEventListener('keydown',key);window.addEventListener('resize',resize);
  const changed=snapshot=>{
    preferredID=latestSelectedID;
    updateGauge(snapshot);
  };
  snapshotListeners.add(changed);
  // OpenCode's IPC state stream supplies the last persisted snapshot on launch
  // and publishes later changes without waiting for a 20-second UI poll.
  if(typeof client.state==='function' && typeof createEffect==='function')createEffect(()=>{
    const state=client.state();
    if(alive&&state)updateGauge(state);
  });
  const initial=typeof client.state==='function'?client.state():null;
  if(initial)updateGauge(initial);
  const interval=setInterval(()=>void poll(),20000);
  const destroy=()=>{alive=false;clearInterval(interval);snapshotListeners.delete(changed);hide();window.removeEventListener('keydown',key);window.removeEventListener('resize',resize);wrapper.remove();};
  // IPC get remains a fallback for older Desktop builds that lack reactive state.
  void poll();
  return {wrapper,hide,destroy,setLayout,position};
}
function attachSidebarButton(ctx,client){
  if(typeof document==='undefined'||!document.body||typeof document.querySelector!=='function')return ()=>{};
  const updaterDock=nativeUpdate.createNativeUpdateDock();
  const view=buildSidebarButton(ctx,client,{onResize:()=>schedule(),getUpdaterBounds:updaterDock.bounds});
  let disposed=false,scheduled=null,observer=null,mode=null;
  const mount=()=>{
    scheduled=null;if(disposed)return;
    const target=indicatorMount(document);
    if(!target){
      updaterDock.restore();view.hide();view.wrapper.remove();mode=null;return;
    }
    const nextMode=target===document.body?'top-tabs':'sidebar';
    if(view.wrapper.parentNode!==target||mode!==nextMode){
      updaterDock.restore();view.hide();view.setLayout(nextMode);
      target.appendChild(view.wrapper);mode=nextMode;
    }
    if(mode==='sidebar')updaterDock.sync(view.wrapper);
    view.position();
  };
  const schedule=()=>{
    if(disposed||scheduled!==null)return;
    scheduled=setTimeout(mount,80);
  };
  mount();
  if(typeof MutationObserver==='function'){
    observer=new MutationObserver(changes=>{
      if(!view.wrapper.isConnected||!view.wrapper.parentNode?.isConnected)return schedule();
      // Detect layout transitions and native footer updates without
      // reacting to ordinary chat-message mutations.
      if(changes.some(layoutMutation))schedule();
    });
    observer.observe(document.body,{subtree:true,childList:true});
    // Catch visibility/class changes that do not generate child-list records.
    const watchdog=setInterval(()=>{if(scheduled===null)mount();},5000);
    return ()=>{disposed=true;observer.disconnect();clearInterval(watchdog);if(scheduled!==null)clearTimeout(scheduled);updaterDock.restore();view.destroy();};
  }else{
    const interval=setInterval(()=>{if(scheduled===null)mount();},2000);
    return ()=>{disposed=true;clearInterval(interval);if(scheduled!==null)clearTimeout(scheduled);updaterDock.restore();view.destroy();};
  }
}

exports.default=Plugin.define({
  // Standard UI strings come from OpenCode's own locale catalog (62+ locales).
  // No duplicate translations or static English-only strings are needed.
  setup(ctx){
    const client=ctx.main(Metrics);
    const tab={id:'usage',get title(){return t(ctx,'usage.title');},closable:'compact',fallback:true};
    ctx.add(Panel,{id:'usage',region:'side',width:'narrow',
      mobile:{get title(){return t(ctx,'usage.title');},kind:'menu',order:45,icon:'status'},
      list:input=>input.open.includes('usage')?[tab]:[],render:()=>createView(ctx,client).root});
    const launch=()=>{const session=ctx.sessions.current();if(session)ctx.layout.open(`${ctx.id}:usage`,session,{tab:'select'});};
    ctx.add(Command,()=>({id:'open',title:t(ctx,'command.usage.view'),run:launch}));
    ctx.add(MenuItem,()=>({menu:'session.panel',id:'open',title:t(ctx,'usage.title'),icon:'status',
      opened:!!ctx.sessions.current()&&ctx.layout.state(`${ctx.id}:usage`,ctx.sessions.current())!=='closed',run:launch}));
    return attachSidebarButton(ctx,client);
  },
  main(ctx){
    // OpenCode loads GUI bundles into a host-managed execution context where
    // CommonJS __dirname is not defined. Resolve the *installed* plugin from
    // documented config locations, never from a module-scope Node variable.
    // Missing optional files must not prevent the metrics IPC from starting.
    const fs=require('node:fs');
    const path=require('node:path');
    const os=require('node:os');
    const env=process.env;
    const roots=[];
    if(env.OPENCODE_CONFIG_DIR && path.isAbsolute(env.OPENCODE_CONFIG_DIR)) roots.push(env.OPENCODE_CONFIG_DIR);
    roots.push(path.join(os.homedir(),'.config','opencode'));
    // Project-scoped plugin installs are also supported when the app's working
    // directory is the project root. Do not walk arbitrary ancestor folders.
    roots.push(path.join(process.cwd(),'.opencode'));
    const pluginFolders=[...new Set(roots.map(root=>path.join(root,'plugins','usage-dashboard')))];
    const pluginFolder=pluginFolders.find(folder=>fs.existsSync(path.join(folder,'package.json')));
    let settings={refreshMinutes:5};
    if(pluginFolder) try {
      settings=JSON.parse(fs.readFileSync(path.join(pluginFolder,'settings.json'),'utf8'));
    } catch { /* defaults: optional configuration file missing or corrupt */ }
    const refreshMinutes=cache.readInterval(settings?.refreshMinutes,5);
    const monitor=core.makeDashboardMonitor({client:()=>ctx.client,
      endpoint:()=>ctx.serverEndpoints?.get('sidecar')});
    let published=cache.EMPTY();
    let channel=null;
    const store=cache.persistentMonitor(monitor,{intervalMinutes:refreshMinutes,onChange:snapshot=>{
      published=snapshot;
      channel?.changed?.();
    }});
    // The IPC state pushes the disk snapshot as soon as it is read and again
    // whenever the background monitor completes or the user switches accounts.
    // Main-process queue is shared by every GUI window and remains authoritative.
    // Never run overlapping credential.activate calls for one provider: the
    // final queued request is the only one allowed to follow the in-flight one.
    const activationQueue=switchQueue.createLatestWinsQueue(async(provider,id)=>{
      const current=await store.cached();
      const selected=await core.activateConnectedAccount({client:ctx.client,id,snapshot:current,force:true});
      if(selected.provider!==provider)throw new Error('account_provider_mismatch');
      return store.markActive(selected.id,selected.provider);
    },{onIdle:()=>{void store.refresh(true).catch(()=>{});}});
    channel=ctx.provide(Metrics,{
      state:()=>published,
      get:()=>store.cached(),refresh:()=>store.refresh(true),
      activate:async ({id})=>{
        const current=await store.cached();
        const item=current.accounts.find(a=>a.id===id&&a.source==='OpenCode');
        if(!item)throw new Error('account_not_connected');
        const result=await activationQueue.enqueue(item.provider,id);
        // A superseded request still settles, but never claims that its own
        // account became active. Only the queue's last applied result does.
        return result.status==='applied'?result.value:store.cached();
      },
    });
    store.start();
    // Lightweight local account-state polling, independent of quota requests.
    // External account switches should affect the ring within one polling cycle.
    const sync=async()=>{
      if(activationQueue.busy())return;
      try{const credentials=await ctx.client?.credential?.list?.();
        if(activationQueue.busy())return;
        if(Array.isArray(credentials))await store.syncActive(credentials);
        else if(Array.isArray(credentials?.data))await store.syncActive(credentials.data);
      }catch{};
    };
    const activeTimer=setInterval(()=>void sync(),20000);activeTimer.unref?.();
    void sync();
    return ()=>{clearInterval(activeTimer);store.stop();};
  },
});
