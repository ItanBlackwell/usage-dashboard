/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// The GUI entry runs in the renderer AND Electron main. Only main sees secrets.
// The vertical sidebar adapter is intentionally isolated: OpenCode GUI SDK
// currently has no public left-sidebar footer slot. No host styles are patched.
const { Plugin, Ipc, Panel, Command, MenuItem } = require('@opencode/plugin/gui');
const { Schema } = require('effect');
const { onCleanup, createEffect, createRoot } = require('solid-js');
const core = require('./accounts.cjs');
const presentation = require('./presentation.cjs');
const cache = require('./cache.cjs');
const billing = require('./billing-session.cjs');
const switchQueue = require('./switch-queue.cjs');
const nativeUpdate = require('./native-update-layout.cjs');

const ProviderBalanceSchema = Schema.Struct({amount:Schema.Number,currency:Schema.String,kind:Schema.String});
const WindowSchema = Schema.Struct({ label:Schema.String, usedPercent:Schema.Number,
  remainingPercent:Schema.Number, resetsAt:Schema.NullOr(Schema.Number) });
const AccountSchema = Schema.Struct({ id:Schema.String,provider:Schema.String,kind:Schema.String,
  label:Schema.String,source:Schema.String,active:Schema.Boolean,state:Schema.String,message:Schema.String,
  windows:Schema.Array(WindowSchema),credits:Schema.NullOr(Schema.Number),balance:Schema.NullOr(ProviderBalanceSchema),balances:Schema.Array(ProviderBalanceSchema),checkedAt:Schema.Number });
const OrgSchema = Schema.Struct({ id:Schema.String,provider:Schema.String,label:Schema.String,
  month:Schema.String,state:Schema.String,message:Schema.String,usdSpent:Schema.NullOr(Schema.Number),
  monthlyBudgetUsd:Schema.NullOr(Schema.Number),usdRemainingBudget:Schema.NullOr(Schema.Number),
  limitType:Schema.String,checkedAt:Schema.Number });
const BillingSessionSchema = Schema.Struct({id:Schema.String,provider:Schema.String,state:Schema.String,amount:Schema.NullOr(Schema.Number),checkedAt:Schema.Number,browser:Schema.NullOr(Schema.String),browserChoices:Schema.Array(Schema.String)});
const SnapshotSchema = Schema.Struct({ accounts:Schema.Array(AccountSchema),organizations:Schema.Array(OrgSchema),
  inventoryWarning:Schema.NullOr(Schema.String),checkedAt:Schema.Number,billingSessions:Schema.Array(BillingSessionSchema) });
const Metrics = Ipc.define({id:'usage-dashboard.metrics.v3',state:SnapshotSchema,methods:{get:{output:SnapshotSchema},refresh:{output:SnapshotSchema},activate:{input:Schema.Struct({id:Schema.String}),output:SnapshotSchema}}});
// Version independently from the metrics contract. Older host clients may
// retain method tables for an existing token across plugin reloads.
const BillingCommands=Ipc.define({id:'usage-dashboard.billing.v6',methods:{
  ping:{output:Schema.String},
  submit:{input:Schema.Struct({id:Schema.String,action:Schema.String,ticket:Schema.String}),output:Schema.String},
  status:{input:Schema.Struct({id:Schema.String,ticket:Schema.String}),output:Schema.String}
}});

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
// Only an unconfirmed request may override active flags received from main.
const visualIntents = new Map();
let latestSelectedID=null;
// Retain the last authoritative main-process snapshot across popup lifetimes.
let latestVerifiedSnapshot=null;
const billingUiPending=new Set(),billingUiErrors=new Map();
let billingTicketSequence=0;
const billingUiListeners=new Set();
function updateBillingUi(){for(const fn of billingUiListeners){try{fn();}catch{}}}
function billingError(e,stage){
  if(e?.message==='timeout')return 'ipc_timeout';
  // Fixed stage identifiers only. Never surface raw IPC errors or credentials.
  return stage==='ping'?'ipc_ping_failed':stage==='submit'?'ipc_submit_failed':'ipc_status_failed';
}
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
function renderBillingControls(ctx,card,account,session,onBilling,pending){
  const actionError=billingUiErrors.get(account.id);
  if(!['codex','opencode'].includes(account.provider)||account.kind!=='api')return;
  const ru=String(ctx.locale?.locale?.()||'en').toLowerCase().startsWith('ru');
  const tr=(en,rus)=>ru?rus:en;
  const status=session?.state;
  const text={
    connecting:tr('Opening isolated browser…','Открывается отдельный браузер…'),
    choose_edge:tr('The default or saved browser is unavailable or unsupported. Use Edge?','Браузер по умолчанию или сохранённый браузер недоступен либо не поддерживается. Использовать Edge?'),
    choose_chrome:tr('The default or saved browser is unavailable or unsupported. Use Chrome?','Браузер по умолчанию или сохранённый браузер недоступен либо не поддерживается. Использовать Chrome?'),
    choose_browser:tr('The default or saved browser is unavailable or unsupported. Choose a browser for Billing.','Браузер по умолчанию или сохранённый браузер недоступен либо не поддерживается. Выбери браузер для Billing.'),
    awaiting_login:tr('Sign in and open Billing for this API account. The dedicated window closes automatically when the balance is recognized; otherwise close it yourself.','Войди и открой Billing нужного API-аккаунта. После распознавания баланса отдельное окно закроется автоматически; иначе закрой его вручную.'),
    awaiting_login_window:tr('Waiting for the dedicated browser window [W01]. You can close it manually.','Не удалось однозначно определить отдельное окно [W01]. Можно закрыть его вручную.'),
    awaiting_login_document:tr('Waiting for an accessible Billing document [W02].','Ожидаем доступную страницу Billing [W02].'),
    awaiting_login_tabs:tr('Auto-close requires one selected browser tab [W03]. Close other tabs or the dedicated window.','Для автозакрытия нужна одна открытая вкладка [W03]. Закрой лишние вкладки или отдельное окно.'),
    awaiting_login_balance:tr('Waiting for a readable Billing balance [W04].','Ожидаем распознавания баланса в окне Billing [W04].'),
    awaiting_login_ready:tr('Billing page and balance recognized; closing the dedicated window…','Страница и баланс распознаны; закрываем отдельное окно…'),
    awaiting_login_helper:tr('Window accessibility is unavailable [W05]. Close the dedicated window manually after sign-in.','Не удалось получить данные доступности окна [W05]. После входа закрой отдельное окно вручную.'),
    checking_billing:tr('Connecting Billing automatically…','Автоматически подключаем Billing…'),
    awaiting_confirmation:tr('Reconnect Billing to finish automatically.','Переподключи Billing для автоматического завершения.'),
    page_detected:tr('Reconnect Billing to finish automatically.','Переподключи Billing для автоматического завершения.'),
    billing_page_missing:tr('Billing page not found. Reopen the browser and visit Billing.','Страница Billing не найдена. Открой браузер и перейди в Billing.'),
    billing_page_ambiguous:tr('Several Billing pages found. Reopen and visit only the matching page.','Найдено несколько страниц Billing. Открой браузер и перейди только на нужную страницу.'),
    billing_page_unavailable:tr('Could not read the dedicated browser navigation data. Reopen and retry.','Не удалось определить страницу в отдельном профиле браузера. Открой его повторно.'),
    confirmation_unavailable:tr('Balance not recognized. Check the Billing page and retry.','Баланс не распознан. Проверь страницу Billing и повтори.'),
    close_login_browser:tr('Close all windows of the dedicated login profile.','Закрой все окна отдельного профиля входа.'),
    ok:tr('Billing connected','Billing подключён'),
    stale:tr('Last confirmed balance','Последний подтверждённый баланс'),
    login_required:tr('Sign-in required. Reconnect in the normal browser.','Требуется вход. Переподключи Billing в обычном браузере.'),
    balance_unavailable:tr('Billing balance unavailable','Баланс Billing недоступен'),
    billing_label_missing:tr('Billing page loaded, but the credit balance label was not found [R01].','Страница Billing открылась, но подпись баланса не найдена [R01].'),
    billing_value_missing:tr('Balance label found, but its USD amount could not be read [R02].','Подпись баланса найдена, но сумма USD не распознана [R02].'),
    billing_value_ambiguous:tr('Several different credit balances found [R03].','Найдено несколько разных значений баланса [R03].'),
    billing_read_failed:tr('Could not read the Billing document [R04].','Не удалось прочитать страницу Billing [R04].'),
    billing_navigation_failed:tr('The background browser could not load Billing [R05].','Фоновый браузер не смог загрузить Billing [R05].'),
    runtime_missing:tr('Billing runtime missing. Reinstall the plugin.','Нет модуля Billing. Переустанови плагин.'),
    browser_missing:tr('No compatible installed Chromium browser found.','Не найден совместимый установленный Chromium-браузер.'),
    browser_error:tr('Could not launch Billing browser.','Не удалось запустить браузер Billing.'),
    browser_timeout:tr('Browser launch timed out.','Истекло время запуска браузера.'),
    profile_busy:tr('Billing profile is in use. Close its browser and retry.','Профиль Billing занят. Закрой его браузер и повтори.'),
    browser_access_denied:tr('Browser launch was denied by the system.','Система запретила запуск браузера.'),
    profile_error:tr('Could not save billing profile.','Не удалось сохранить профиль Billing.'),
    disconnect_error:tr('Close the billing browser and retry removal.','Закрой браузер Billing и повтори удаление.')
  }[status];
  const errors={
    service_unavailable:tr('Billing service unavailable. Restart OpenCode.','Служба Billing недоступна. Перезапусти OpenCode.'),
    inventory_unavailable:tr('Account inventory unavailable. Refresh and retry.','Список учётных данных недоступен. Обнови и повтори.'),
    account_unavailable:tr('Account not available to Billing. Refresh and retry.','Аккаунт недоступен службе Billing. Обнови и повтори.'),
    invalid_action:tr('Unsupported Billing action.','Действие Billing не поддерживается.'),
    action_failed:tr('Billing action failed. Retry.','Действие Billing завершилось ошибкой. Повтори.'),
    ipc_unavailable:tr('Billing IPC client missing [B01].','Клиент IPC Billing отсутствует [B01].'),
    ipc_ping_failed:tr('Billing service did not accept the connection [B02].','Служба Billing не отвечает на проверку связи [B02].'),
    ipc_submit_failed:tr('Billing command was not accepted [B03].','Команда Billing не принята [B03].'),
    ipc_status_failed:tr('Billing command status unavailable [B04].','Статус команды Billing недоступен [B04].'),
    ipc_protocol:tr('Billing service protocol mismatch [B05].','Несовместимый протокол Billing [B05].'),
    busy:tr('Another Billing action is in progress.','Другое действие Billing ещё выполняется.'),
    unknown:tr('Billing command was interrupted. Retry.','Команда Billing прервана. Повтори.'),
    ipc_timeout:tr('Billing service did not respond.','Служба Billing не отвечает.')
  };
  const line=add(card,$('div','display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:3px;margin-top:3px;min-height:0'));
  line.setAttribute('data-pv-billing-session',status||'disconnected');
  const choosing=['choose_edge','choose_chrome','choose_browser'].includes(status);
  const browserName=billing.BROWSERS[session?.browser]?.name;
  const waiting=typeof status==='string'&&status.startsWith('awaiting_login');
  const busy=pending||status==='connecting'||status==='checking_billing';
  const feedback=errors[actionError]||(pending?tr('Connecting…','Подключение…'):text);
  if(feedback)add(line,$('span','font-size:10px;line-height:12px;min-width:0;flex:1 1 100%;color:'+(actionError?palette.danger:palette.muted),feedback+(browserName&&!choosing?' · '+browserName:'')));
  const button=(verb,label,tooltip)=>{
    const el=add(line,$('button','box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:auto;height:18px;min-height:18px;max-height:18px;line-height:12px;border:1px solid '+palette.border+';border-radius:4px;background:transparent;color:'+palette.text+';font-family:inherit;font-size:10px;font-weight:400;padding:0 5px;margin:0;cursor:pointer;white-space:nowrap;appearance:none',label));
    el.type='button';el.title=tooltip;el.disabled=!onBilling||busy;
    el.setAttribute('data-pv-billing-action',verb);
    el.addEventListener('click',event=>{event.stopPropagation();onBilling?.(account.id,verb);});
  };
  if(choosing){
    const choices=(session?.browserChoices||[]).filter(id=>Object.hasOwn(billing.BROWSERS,id));
    // Old cached choice states have no list; use a fresh detection on retry.
    for(const id of choices){
      const name=billing.BROWSERS[id].name;
      button('open_'+id,name,tr('Open a dedicated profile in '+name+'.','Открыть отдельный профиль в '+name+'.'));
    }
    button('open',tr('Retry default','Повторить выбор'),tr('Check the default or saved browser again.','Повторно проверить браузер по умолчанию или сохранённый браузер.'));
  }else if(!waiting&&status!=='checking_billing'){
    // No post-login confirmation or address input: main finishes the attempt
    // automatically after the native browser exits.
    button('open',status?tr('Reconnect Billing','Переподключить Billing'):tr('Connect Billing','Подключить Billing'),tr('Open Billing for this account in a separate browser. Select the matching organization or workspace; the window may close automatically after the balance is recognized.','Открыть Billing этого аккаунта в отдельном браузере. Выбери нужную организацию или workspace; после распознавания баланса окно может закрыться автоматически.'));
  }
  if(status&&!waiting&&status!=='checking_billing')button('disconnect',tr('Disconnect','Отключить'),tr('Remove this account’s browser profile and session.','Удалить профиль и Billing-сессию этого аккаунта.'));
}
function renderLimits(ctx,target,data,onSwitch=null,switchingID=null,stableOrder=null,onBilling=null,billingPending=null) {
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
      add(card,$('div',`color:${palette.muted};font-size:10px;margin-top:2px`,'—'));
    }
    const footerItems=[];
    if(account.credits!==null)footerItems.push(`🪙 ${account.credits}`);
    if(account.state==='stale' && Number.isFinite(account.checkedAt)) {
      const raw=ctx.locale?.locale?.()||'en';
      const lang=({zht:'zh-Hant',zh:'zh-Hans',br:'pt-BR',no:'nb-NO'})[raw]||raw;
      try{footerItems.push(`◷ ${new Intl.DateTimeFormat(lang,{dateStyle:'short',timeStyle:'short'}).format(new Date(account.checkedAt))}`);}catch{}
    }
    if(footerItems.length)add(card,$('div',`color:${palette.muted};font-size:10px;line-height:1.2;margin-top:3px`,footerItems.join('  ·  ')));
  }
  for(const account of apiAccounts){
    const card=compactCard(list,account.active);
    const own=account.balance;
    const hasOwn=own && Number.isFinite(own.amount) && ['USD','CNY'].includes(own.currency);
    const session=presentation.billingSessionFor(account,data);
    const balance=presentation.billingSessionBalance(account,data);
    const display=hasOwn?currencyAmount(own.amount,own.currency):(balance?money(balance.usd):'—');
    accountHeader(ctx,card,account,onSwitch,switchingID,true,display,hasOwn?account.checkedAt:balance?.observedAt??null);
    const amountEl=card.querySelector('[data-pv-api-amount]');
    const ru=String(ctx.locale?.locale?.()||'en').startsWith('ru');
    if(amountEl && (!hasOwn||account.state==='stale')){
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
        no_usage_endpoint:['No supported balance endpoint.','Нет поддерживаемого API получения баланса.']
      };
      const reason=reasons[account.message]?.[ru?1:0];
      const note=balance?(balance.state==='ok'?(ru?'Подтверждённый баланс Billing-сессии.':'Confirmed billing session balance.'):(ru?'Последний подтверждённый баланс Billing-сессии.':'Last confirmed billing session balance.'))
        :hasOwn?(ru?'Последний подтверждённый баланс.':'Last confirmed balance.')
        :['codex','opencode'].includes(account.provider)
          ?(ru?'Подключи Billing-сессию для этого API-аккаунта.':'Connect a billing session for this API account.')
          :(ru?'Баланс недоступен; это не означает нулевой остаток.':'Balance unavailable; this does not mean zero.');
      amountEl.title=[note,reason,amountEl.title].filter(Boolean).join('\n');
    }
    const extras=Array.isArray(account.balances)?account.balances.filter(b=>b && b.kind==='balance' && b.currency!==own?.currency && Number.isFinite(b.amount)):[];
    if(extras.length) add(card,$('div',`margin-top:2px;font-size:10px;color:${palette.muted};font-variant-numeric:tabular-nums`,
      extras.map(b=>currencyAmount(b.amount,b.currency)).join(' · ')));
    renderBillingControls(ctx,card,account,session,onBilling,billingPending?.has(account.id));
    if(hasOwn && own.kind==='key_limit'){
      const lang=ctx.locale?.locale?.()||'en';
      const label=String(lang).startsWith('ru')?'Остаток лимита ключа, не баланс':'API key spending cap, not account balance';
      const noteEl=add(card,$('span',`font-size:9.5px;color:${palette.muted}`,label));noteEl.setAttribute('data-pv-key-limit-label','true');
    }
  }
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
        source:'OpenCode',active:false,state:'unavailable',message:'plugin_ipc_unavailable',windows:[],credits:null,balance:null,balances:[],checkedAt:0});
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
    return {accounts,organizations:[],inventoryWarning:'plugin_main_unavailable',checkedAt:Date.now(),billingSessions:[]};
  }catch{return null;}
}
function createView(ctx,client,{compact=false,billingClient=null}={}) {
  const root=$('section',`box-sizing:border-box;min-width:0;${compact?'overflow:visible;':'overflow-y:auto;max-height:100%;'}padding:${compact?'8px 9px':'16px'};color:${palette.text};font-family:inherit;background:${compact?'var(--v2-background-bg-layer-02, var(--background,#18191d))':'transparent'}`);
  const header=add(root,$('div','display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid ${palette.border}'));
  const heading=add(header,$('strong',`font-size:12px;color:${palette.text}`,t(ctx,'usage.title')));
  const refresh=add(header,$('button',`background:transparent;color:${palette.muted};border:0;cursor:pointer;font-size:16px;padding:2px 4px;display:flex;align-items:center;justify-content:center;min-width:22px;min-height:22px`));
  add(refresh,$('span','display:inline-block;transform-origin:center;line-height:1','↻'));
  refresh.type='button';refresh.setAttribute('aria-label',t(ctx,'usage.retry'));refresh.title=t(ctx,'usage.retry');
  const body=add(root,$('div'));
  let alive=true,running=false,hasData=false,lastSnapshot=null,lastServerSnapshot=null,queuedRefresh=false,coldRefreshRequested=false,switchSequence=0,commitVersion=0;
  const stableOrder=stableAccountOrder;
  const desiredByProvider=new Map(),billingPending=billingUiPending;
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
    renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);
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
    if(lastSnapshot){renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);}
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
  async function billingAction(id,action){
    if(!alive||billingPending.has(id)||!lastSnapshot)return;
    const account=lastSnapshot.accounts?.find(a=>a.id===id&&a.kind==='api'&&['codex','opencode'].includes(a.provider));
    if(!account)return;
    billingUiErrors.delete(id);
    if(!billingClient||['ping','submit','status'].some(k=>typeof billingClient[k]!=='function')){
      billingUiErrors.set(id,'ipc_unavailable');updateBillingUi();return;
    }
    billingPending.add(id);updateBillingUi();
    const ticket=Date.now().toString(36)+'-'+(++billingTicketSequence).toString(36)+'-'+Math.random().toString(36).slice(2,10);
    let stage='ping';
    try{
      const version=await bounded(signal=>billingClient.ping({signal}),8000);
      if(version!=='billing-v6'){billingUiErrors.set(id,'ipc_protocol');return;}
      stage='submit';
      const ack=await bounded(signal=>billingClient.submit({id,action,ticket},{signal}),10000);
      if(ack!=='queued'){
        billingUiErrors.set(id,['service_unavailable','invalid_action','busy'].includes(ack)?ack:'ipc_protocol');return;
      }
      stage='status';
      const until=Date.now()+120000;
      while(Date.now()<until){
        const result=await bounded(signal=>billingClient.status({id,ticket},{signal}),8000);
        if(result==='pending'){
          await new Promise(resolve=>setTimeout(resolve,500));
          continue;
        }
        if(result!=='accepted')billingUiErrors.set(id,['service_unavailable','inventory_unavailable','account_unavailable','invalid_action','action_failed','unknown'].includes(result)?result:'ipc_protocol');
        return;
      }
      billingUiErrors.set(id,'ipc_timeout');
    }catch(e){billingUiErrors.set(id,billingError(e,stage));}
    finally{
      billingPending.delete(id);
      updateBillingUi();
      if(alive)void load(false);
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
    renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);

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
      if(alive)renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);
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
        renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);
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
  const billingUpdated=()=>{if(alive&&lastSnapshot)renderLimits(ctx,body,lastSnapshot,activate,null,stableOrder,billingAction,billingPending);};
  billingUiListeners.add(billingUpdated);
  const destroy=()=>{alive=false;clearInterval(timer);disposeState();billingUiListeners.delete(billingUpdated);};
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
      apiRing.arc.setAttribute('stroke',amount===null?palette.track:amount>0?palette.success:palette.danger);
      apiRing.arc.setAttribute('stroke-dashoffset','0');
    }else{
      unknownRing.arc.setAttribute('stroke',palette.track);
      unknownRing.arc.setAttribute('stroke-dashoffset','0');
    }
  }
  draw({mode:'unavailable'});
  return {svg,draw};
}

// Unsupported, narrowly scoped DOM adapter for the current vertical-tabs
// sidebar. It uses the host's existing flex layout, not a fixed overlay or a
// window.bottom Slot. It never relocates the usage button itself.
// The native update action is optionally aligned by a separate reversible
// adapter, keeping the host's original DOM event handlers and ownership.
// The actual anchor is the full-height Portal child, not its clipped mount.
const SIDEBAR_SELECTOR='aside[data-slot="vertical-tabs-sidebar"] [data-slot="vertical-tabs-mount"]';
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
function buildSidebarButton(ctx,client,{onResize,getUpdaterBounds,billingClient}={}){
  const wrapper=$('div',`box-sizing:border-box;flex:0 0 auto;margin-top:auto;min-height:40px;display:flex;align-items:center;justify-content:flex-start;padding:4px 4px 0;border-top:1px solid ${palette.border}`);
  wrapper.setAttribute('data-pv-usage-sidebar','true');
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
    shown=createView(ctx,client,{compact:true,billingClient});overlay.appendChild(shown.root);
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
      :metric.mode==='api'?(metric.amount===null?'—':currencyAmount(metric.amount,metric.currency||'USD')):'—';
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
  return {wrapper,hide,destroy};
}
function attachSidebarButton(ctx,client,billingClient){
  if(typeof document==='undefined'||!document.body||typeof document.querySelector!=='function')return ()=>{};
  const updaterDock=nativeUpdate.createNativeUpdateDock();
  const view=buildSidebarButton(ctx,client,{billingClient,onResize:()=>updaterDock.sync(view.wrapper),getUpdaterBounds:updaterDock.bounds});
  let disposed=false,scheduled=null,observer=null;
  const mount=()=>{
    scheduled=null;if(disposed)return;
    const target=sidebarMount(document);
    if(!target){updaterDock.restore();if(view.wrapper.isConnected){view.hide();view.wrapper.remove();}return;}
    if(view.wrapper.parentNode!==target){updaterDock.restore();view.hide();target.appendChild(view.wrapper);}
    updaterDock.sync(view.wrapper);
  };
  const schedule=()=>{
    if(disposed||scheduled!==null)return;
    scheduled=setTimeout(mount,80);
  };
  mount();
  if(typeof MutationObserver==='function'){
    observer=new MutationObserver(changes=>{
      if(!view.wrapper.isConnected||!view.wrapper.parentNode?.isConnected)return schedule();
      // The app mounts/unmounts its update pill as availability changes.
      // Watch only the sidebar footer, not chat-message mutations.
      if(changes.some(change=>{
        const source=change.target;
        return source?.matches?.('[data-slot="vertical-tabs-footer"]') ||
          source?.closest?.('[data-slot="vertical-tabs-footer"]') ||
          Array.from([...(change.addedNodes||[]),...(change.removedNodes||[])]).some(el=>el?.matches?.('[data-slot="vertical-tabs-footer"]'));
      }))schedule();
    });
    observer.observe(document.body,{subtree:true,childList:true});
    // A low-frequency check also catches sidebar class/host changes that do
    // not add or remove DOM nodes (the observer watches childList only).
    const watchdog=setInterval(()=>{
      if(sidebarMount(document)!==view.wrapper.parentNode)schedule();
      else updaterDock.sync(view.wrapper);
    },5000);
    return ()=>{disposed=true;observer.disconnect();clearInterval(watchdog);if(scheduled!==null)clearTimeout(scheduled);updaterDock.restore();view.destroy();};
  }else{
    // Older desktop builds without MutationObserver still get a safe retry.
    const interval=setInterval(mount,2000);
    return ()=>{disposed=true;clearInterval(interval);if(scheduled!==null)clearTimeout(scheduled);updaterDock.restore();view.destroy();};
  }
}

exports.default=Plugin.define({
  // Standard UI strings come from OpenCode's own locale catalog (62+ locales).
  // No duplicate translations or static English-only strings are needed.
  setup(ctx){
    const client=ctx.main(Metrics);
    let billingClient=null;
    try{billingClient=ctx.main(BillingCommands);}catch{/* Metrics remain usable. */}
    const tab={id:'usage',get title(){return t(ctx,'usage.title');},closable:'compact',fallback:true};
    ctx.add(Panel,{id:'usage',region:'side',width:'narrow',
      mobile:{get title(){return t(ctx,'usage.title');},kind:'menu',order:45,icon:'status'},
      list:input=>input.open.includes('usage')?[tab]:[],render:()=>createView(ctx,client,{billingClient}).root});
    const launch=()=>{const session=ctx.sessions.current();if(session)ctx.layout.open(`${ctx.id}:usage`,session,{tab:'select'});};
    ctx.add(Command,()=>({id:'open',title:t(ctx,'command.usage.view'),run:launch}));
    ctx.add(MenuItem,()=>({menu:'session.panel',id:'open',title:t(ctx,'usage.title'),icon:'status',
      opened:!!ctx.sessions.current()&&ctx.layout.state(`${ctx.id}:usage`,ctx.sessions.current())!=='closed',run:launch}));
    return attachSidebarButton(ctx,client,billingClient);
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
    const billingService=billing.createBillingSessions({
      directory:pluginFolder?path.join(path.dirname(path.dirname(pluginFolder)),'.usage-dashboard-userdata','billing-sessions'):
        path.join(cache.cacheDirectory(),'billing-sessions'),
      pluginFolder,store,intervalMinutes:refreshMinutes
    });
    // The IPC state pushes the disk snapshot as soon as it is read and again
    // whenever the background monitor completes or the user switches accounts.
    // Optional browser services cannot prevent this channel from starting.
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
      get:()=>store.cached(),refresh:async()=>{
        const snapshot=await store.refresh(true);
        void billingService.tick().catch(()=>{});
        return snapshot;
      },
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
    const billingCommands=billing.createBillingCommands(billingService,{
      log:result=>{try{ctx.log?.write?.('info','Usage Dashboard Billing command',{result});}catch{}}
    });
    // The browser command channel is separately registered and returns only
    // scalar acknowledgements/statuses. Failures must not disable metrics.
    try{
      ctx.provide(BillingCommands,{
        ping:()=> 'billing-v6',
        submit:input=>billingCommands.submit(input),
        status:input=>billingCommands.status(input)
      });
      try{ctx.log?.write?.('info','Usage Dashboard Billing IPC ready',{protocol:'billing-v6'});}catch{}
    }catch{
      try{ctx.log?.write?.('warn','Usage Dashboard Billing IPC registration failed',{code:'B02'});}catch{}
    }
    store.start();
    let disposed=false;
    void store.refresh(true).then(()=>{if(!disposed)billingService.start();}).catch(()=>{});
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
    return ()=>{disposed=true;clearInterval(activeTimer);store.stop();billingCommands.stop();void billingService.stop().catch(()=>{});};
  },
});
