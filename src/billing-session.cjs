/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Main-process-only, opt-in billing sessions. Never attach to a user's normal
// browser profile or expose a debugging port. Manual login runs in a normal
// browser process; Playwright is used only for post-login billing reads.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const PROVIDERS = new Set(['codex','opencode']);
const CHANNELS = ['msedge','chrome'];
const ENTRY = {codex:'https://platform.openai.com/settings/organization/billing/overview',opencode:'https://opencode.ai/console'};
const STATES = ['connecting','awaiting_confirmation','confirmation_unavailable','ok','stale',
  'close_login_browser','login_required','balance_unavailable','runtime_missing','browser_missing','browser_error','browser_timeout','profile_busy','browser_access_denied','profile_error','disconnect_error'];

function billingPage(provider,raw) {
  try {
    if(typeof raw!=='string'||raw.length>512)return null;
    const u=new URL(raw);
    if(u.username||u.password)return null;
    if(provider==='codex'&&u.origin==='https://platform.openai.com'&&
      /^\/settings\/organization\/billing\/overview\/?$/.test(u.pathname)){
      // Preserve an explicitly selected organization only if the parameter is
      // a recognizable non-secret organization ID; discard all other parameters.
      const org=u.searchParams.get('organization')||u.searchParams.get('org');
      return ENTRY.codex+(org&&/^org[-_][A-Za-z0-9_-]{1,120}$/.test(org)?'?organization='+encodeURIComponent(org):'');
    }
    if(provider==='opencode'&&u.origin==='https://opencode.ai'&&
      /^\/(?:workspace\/[A-Za-z0-9_-]+\/billing|(?:console\/)?[A-Za-z0-9_-]+\/settings\/billing)\/?$/.test(u.pathname))
      return u.origin+u.pathname.replace(/\/$/,'');
  }catch{}
  return null;
}
function eligible(account) {
  return account?.kind==='api'&&PROVIDERS.has(account.provider)&&typeof account.id==='string'&&
    account.id.length>0&&account.id.length<=120&&account.message!=='login_required'&&account.message!=='plugin_ipc_unavailable';
}
// Runs inside the provider page. Return only a finite USD amount or null;
// no HTML, account labels, cookies, localStorage, or raw response leaves it.
function readBillingAmount(provider) {
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
  const visible=el=>!!el&&el.nodeType===1&&!el.closest('button,input,script,style,[hidden],[aria-hidden="true"]')&&
    el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
  const parse=text=>{
    const m=norm(text).match(/^(?:([-−]?)\s*(?:US\s*\$|\$|USD)\s*([-−]?)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|([-−]?)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*USD)$/i);
    if(!m||(m[1]&&m[2]))return null;
    const n=Number((m[3]||m[6]).replaceAll(',','')+'.'+(m[4]||m[7]||'0'))*(m[1]||m[2]||m[5]?-1:1);
    return Number.isFinite(n)&&n>=(provider==='opencode'?0:-1000000)&&n<=100000000?(n===0?0:n):null;
  };
  const label=provider==='opencode'
    ? /^(?:credit balance|prepaid balance|available credits?|current balance|available balance|balance|credits)$/i
    : /^(?:credit balance|prepaid balance|available credits?|current balance|available balance)$/i;
  const root=document.querySelector('main,[role="main"]')||document.body;
  if(!root)return null;
  const values=new Set();
  const add=n=>{if(n!==null)values.add(n);};
  for(const el of root.querySelectorAll('div,span,p,dt,dd,h1,h2,h3,h4,h5,h6,strong,b,label')){
    if(!visible(el))continue;
    const text=norm(el.innerText);
    if(!text||text.length>180)continue;
    const inline=text.match(/^(.+?)(?:\s*[:：]\s*|\s+)((?:[-−]?\s*(?:US\s*\$|\$|USD)|[-−]?\s*\d).+)$/i);
    if(inline&&label.test(inline[1]))add(parse(inline[2]));
    if(!label.test(text.replace(/[:：]$/,'')))continue;
    // Keep the search local to the labelled value, never scan unrelated
    // invoice, top-up, payment-method, budget, or threshold amounts.
    const candidates=[el.nextElementSibling,el.parentElement?.nextElementSibling,el.parentElement];
    for(const candidate of candidates){
      if(!visible(candidate))continue;
      const s=norm(candidate.innerText);
      const tail=s.toLowerCase().startsWith(text.toLowerCase())?s.slice(text.length).replace(/^\s*[:：]\s*/,''):s;
      const value=parse(tail);
      if(value!==null){add(value);break;}
    }
  }
  return values.size===1?[...values][0]:null;
}
function browserEnvironment(env) {
  // Avoid passing provider API secrets or arbitrary environment variables from
  // the host to the child browser. Keep only OS paths/runtime necessities.
  const names=new Set(['systemroot','windir','systemdrive','path','pathext','temp','tmp','localappdata',
    'appdata','userprofile','programfiles','programfiles(x86)','programw6432','commonprogramfiles',
    'commonprogramfiles(x86)','comspec','username','userdomain','homedrive','homepath','number_of_processors',
    'processor_architecture','os','home','display','wayland_display','xdg_runtime_dir','lang']);
  return Object.fromEntries(Object.entries(env||{}).filter(([k,v])=>names.has(k.toLowerCase())&&typeof v==='string'));
}
async function findBrowser(preferred=null,env=process.env,access=fs.access) {
  const roots=[env['ProgramFiles(x86)'],env.ProgramW6432,env.ProgramFiles,env.LOCALAPPDATA]
    .filter(x=>typeof x==='string'&&path.isAbsolute(x));
  for(const channel of preferred?[preferred]:CHANNELS){
    if(!CHANNELS.includes(channel))continue;
    const relative=channel==='msedge'?['Microsoft','Edge','Application','msedge.exe']:['Google','Chrome','Application','chrome.exe'];
    for(const root of new Set(roots)){
      const executablePath=path.join(root,...relative);
      try{await access(executablePath);return {channel,executablePath};}catch{}
    }
  }
  return null;
}
function startLoginBrowser({browser,profilePath,url,env,spawn=require('node:child_process').spawn}) {
  // The installed browser handles the provider's own OAuth flow. Do not use
  // Playwright, CDP, automation flags, a shell, or credential extraction here.
  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(browser.executablePath,[
        '--user-data-dir='+profilePath,'--new-window','--disable-background-mode','--disable-sync',url
      ],{shell:false,detached:true,windowsHide:false,stdio:'ignore',env:browserEnvironment(env)});
    }catch{reject(new Error('browser_error'));return;}
    child.once('error',()=>reject(new Error('browser_error')));
    child.once('spawn',()=>{
      child.unref();
      resolve({isRunning:()=>child.exitCode===null&&child.signalCode===null});
    });
  });
}
function loadChromium(pluginFolder) {
  if(!pluginFolder)throw new Error('runtime_missing');
  // Load only the packaged dependency, not arbitrary modules from PATH or the
  // host's global node_modules. No install script or browser download at runtime.
  const createRequire=require('node:module').createRequire;
  const localRequire=createRequire(path.join(pluginFolder,'package.json'));
  return localRequire(path.join(pluginFolder,'node_modules','playwright-core')).chromium;
}
function bounded(promise,ms) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),ms);})])
    .finally(()=>clearTimeout(timer));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createBillingSessions({directory,pluginFolder,store,intervalMinutes=5,clock=Date.now,
  io=fs,chromiumLoader=()=>loadChromium(pluginFolder),browserFinder=findBrowser,
  loginLauncher=startLoginBrowser,env=process.env}={}) {
  const manual=new Map(),busy=new Map(),contexts=new Set();
  let stopped=false,timer=null,tickBusy=false;
  const folder=account=>path.join(directory,crypto.createHash('sha256').update(account.provider+':'+account.id).digest('hex'));
  const bindingFile=account=>path.join(folder(account),'binding.json');
  const profile= (account,channel)=>path.join(folder(account),channel);
  const current=async id=>{
    const snapshot=await store.cached();
    if(snapshot.inventoryWarning)return null;
    return snapshot.accounts.find(a=>a.id===id&&eligible(a))||null;
  };
  const stateFor=(snapshot,id,provider)=>snapshot.billingSessions?.find(s=>s.id===id&&s.provider===provider);
  async function publish(account,state,{amount=null,checkedAt=0,preserve=false}={}){
    if(stopped)return store.cached();
    if(preserve){
      const old=stateFor(await store.cached(),account.id,account.provider);
      if(Number.isFinite(old?.amount)){amount=old.amount;checkedAt=old.checkedAt;}
    }
    return store.setBillingSession(account.id,account.provider,{id:account.id,provider:account.provider,state,amount,checkedAt});
  }
  async function readBinding(account){
    try{
      const b=JSON.parse(await io.readFile(bindingFile(account),'utf8'));
      if(b?.id===account.id&&b.provider===account.provider&&CHANNELS.includes(b.channel)&&
        typeof b.url==='string'&&billingPage(account.provider,b.url)===b.url)return b;
    }catch{}
    return null;
  }
  async function saveBinding(account,b){
    await io.mkdir(folder(account),{recursive:true,mode:0o700});
    const temp=bindingFile(account)+'.tmp';
    await io.writeFile(temp,JSON.stringify({id:account.id,provider:account.provider,channel:b.channel,url:b.url}),{encoding:'utf8',mode:0o600});
    await io.rename(temp,bindingFile(account));
  }
  async function closeContext(context){
    if(!context)return;
    try{await bounded(context.close(),10000);contexts.delete(context);}
    catch{throw new Error('browser_error');}
  }
  async function launch(account,browser){
    let chromium;
    try{chromium=chromiumLoader();if(!chromium?.launchPersistentContext)throw Error();}catch{throw new Error('runtime_missing');}
    try{await io.mkdir(profile(account,browser.channel),{recursive:true,mode:0o700});}
    catch{throw new Error('profile_error');}
    let context;
    try{context=await chromium.launchPersistentContext(profile(account,browser.channel),{
      channel:browser.channel,executablePath:browser.executablePath,headless:true,
      viewport:null,acceptDownloads:false,chromiumSandbox:true,timeout:15000,
      handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,
      args:['--disable-background-mode','--disable-sync'],env:browserEnvironment(env)
    });}catch(e){
      // Publish only a fixed classification, never raw browser arguments,
      // local paths, private URLs or exception text.
      const message=typeof e?.message==='string'?e.message:'';
      if(/timeout/i.test(message))throw new Error('browser_timeout');
      if(/profile.*(?:in use|lock)|processsingleton|user data directory is already in use/i.test(message))throw new Error('profile_busy');
      if(/access is denied|permission denied|eacces|eperm/i.test(message))throw new Error('browser_access_denied');
      throw new Error('browser_error');
    }
    contexts.add(context);
    context.once('close',()=>contexts.delete(context));
    if(stopped){await closeContext(context).catch(()=>{});throw new Error('browser_error');}
    return context;
  }
  const safeError=e=>STATES.includes(e?.message)?e.message:'browser_error';
  async function readPage(context,account,expected=null,wait=8000){
    const until=Date.now()+wait;
    do{
      if(stopped)return {state:'browser_error'};
      const pages=context.pages().map(page=>({page,url:billingPage(account.provider,page.url())})).filter(p=>p.url);
      if(pages.length>1)return {state:'confirmation_unavailable'};
      if(pages.length===1){
        const {page,url}=pages[0];
        if(expected&&url!==expected)return {state:'login_required'};
        try{
          const value=await bounded(page.evaluate(readBillingAmount,account.provider),4000);
          if(Number.isFinite(value)&&value>=(account.provider==='opencode'?0:-1000000)&&value<=100000000&&
            billingPage(account.provider,page.url())===url)return {state:'ok',amount:value,url};
        }catch{}
      }
      if(Date.now()>=until)break;
      await pause(400);
    }while(Date.now()<until);
    return {state:expected?(context.pages().some(p=>billingPage(account.provider,p.url())===expected)?'balance_unavailable':'login_required'):'confirmation_unavailable'};
  }
  async function navigateBilling(context,account,url){
    const page=context.pages()[0]||await context.newPage();
    let blocked=false;
    await page.route('**/*',async route=>{
      const request=route.request();
      if(request.isNavigationRequest()){
        let main=true;
        try{main=request.frame()===page.mainFrame();}catch{}
        if(main&&!billingPage(account.provider,request.url())){
          blocked=true;return route.abort();
        }
      }
      return route.continue();
    });
    try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});}
    catch(e){
      if(blocked||!billingPage(account.provider,page.url()))return {state:'login_required'};
      throw e;
    }
    if(blocked)return {state:'login_required'};
    // Only evaluate the expected billing document; never interact with OAuth,
    // sign-in, verification or any other non-billing page.
    return readPage(context,account,url);
  }
  async function open(account){
    const existing=manual.get(account.id);
    if(existing?.process.isRunning())return publish(account,'awaiting_confirmation');
    const old=await readBinding(account);
    try{
      // Check availability without launching an automated browser.
      try{if(!chromiumLoader()?.launchPersistentContext)throw Error();}catch{throw new Error('runtime_missing');}
      let browser=await browserFinder(existing?.browser.channel??old?.channel??null,env);
      if(!browser&&(existing||old))browser=await browserFinder(null,env);
      if(!browser)throw new Error('browser_missing');
      await io.rm(bindingFile(account),{force:true}).catch(()=>{throw new Error('profile_error');});
      await publish(account,'connecting');
      const profilePath=profile(account,browser.channel);
      try{await io.mkdir(profilePath,{recursive:true,mode:0o700});}
      catch{throw new Error('profile_error');}
      const url=existing?.url||old?.url||ENTRY[account.provider];
      const process=await loginLauncher({browser,profilePath,url,env});
      manual.set(account.id,{browser,process,url});
      return publish(account,'awaiting_confirmation');
    }catch(e){return publish(account,safeError(e));}
  }
  async function confirm(account,rawPage){
    const record=manual.get(account.id);
    if(!record)return publish(account,'login_required');
    if(record.process.isRunning())return publish(account,'close_login_browser');
    const url=billingPage(account.provider,rawPage);
    if(!url)return publish(account,'confirmation_unavailable');
    let context,result;
    try{
      // No browser process is killed or attached to. If Chromium reports
      // that the profile remains in use, the user must close it manually.
      context=await launch(account,record.browser);
      result=await navigateBilling(context,account,url);
      await closeContext(context);context=null;
      if(!await current(account.id))throw new Error('profile_error');
      if(result.state!=='ok')return publish(account,result.state==='login_required'?'login_required':'confirmation_unavailable');
      await saveBinding(account,{channel:record.browser.channel,url:result.url});
      manual.delete(account.id);
      return publish(account,'ok',{amount:result.amount,checkedAt:clock()});
    }catch(e){return publish(account,safeError(e));}
    finally{if(context)await closeContext(context).catch(()=>{});}
  }
  async function disconnect(account){
    const record=manual.get(account.id);
    try{
      if(record?.process.isRunning())return publish(account,'disconnect_error');
      // Remove only this plugin's dedicated, hashed account directory.
      await io.rm(folder(account),{recursive:true,force:true});
      manual.delete(account.id);
      return store.setBillingSession(account.id,account.provider,null);
    }catch{
      await io.rm(bindingFile(account),{force:true}).catch(()=>{});
      return publish(account,'disconnect_error');
    }
  }
  async function refreshAccount(account){
    const initialState=stateFor(await store.cached(),account.id,account.provider);
    if(['disconnect_error','login_required'].includes(initialState?.state))return;
    const binding=await readBinding(account);
    if(!binding){
      const state=stateFor(await store.cached(),account.id,account.provider);
      if(Number.isFinite(state?.amount))await store.setBillingSession(account.id,account.provider,null);
      else if(['connecting','awaiting_confirmation','confirmation_unavailable','close_login_browser'].includes(state?.state))await publish(account,'login_required');
      return;
    }
    let context;
    try{
      const browser=await browserFinder(binding.channel,env);
      if(!browser)throw new Error('browser_missing');
      context=await launch(account,browser);
      const result=await navigateBilling(context,account,binding.url);
      if(!await current(account.id))return;
      if(result.state==='ok')await publish(account,'ok',{amount:result.amount,checkedAt:clock()});
      else await publish(account,result.state,{preserve:true});
    }catch(e){await publish(account,safeError(e),{preserve:true});}
    finally{if(context)await closeContext(context).catch(()=>{});}
  }
  function run(account,fn,queue=false){
    if(stopped)return store.cached();
    const previous=busy.get(account.id);
    if(previous&&!queue)return store.cached();
    const task=Promise.resolve(previous).catch(()=>{}).then(async()=>{
      if(stopped||!await current(account.id))return store.cached();
      return fn();
    }).finally(()=>{if(busy.get(account.id)===task)busy.delete(account.id);});
    busy.set(account.id,task);return task;
  }
  async function action(id,verb,page=''){
    const reply=async(accepted,reason=null)=>({accepted,reason,snapshot:await store.cached()});
    if(stopped)return reply(false,'service_unavailable');
    if(!['open','confirm','disconnect'].includes(verb))return reply(false,'invalid_action');
    let snapshot=await store.cached();
    // Retry the private host inventory once rather than silently ignoring a click.
    if(snapshot.inventoryWarning){
      try{snapshot=await bounded(store.refresh(true),20000);}catch{return reply(false,'inventory_unavailable');}
      if(snapshot.inventoryWarning)return reply(false,'inventory_unavailable');
    }
    const account=snapshot.accounts.find(a=>a.id===id&&eligible(a));
    if(!account)return reply(false,'account_unavailable');
    if(verb==='confirm'&&!billingPage(account.provider,page))return reply(false,'invalid_billing_page');
    try{
      let executed=false;
      await run(account,async()=>{
        executed=true;
        return verb==='open'?open(account):verb==='confirm'?confirm(account,page):disconnect(account);
      },true);
      return executed?reply(true):reply(false,'account_unavailable');
    }catch{return reply(false,'action_failed');}
  }
  async function tick(){
    if(stopped||tickBusy)return;
    tickBusy=true;
    try{
      const snapshot=await store.cached();
      // Do not poll removed accounts or an inventory known to be incomplete.
      if(snapshot.inventoryWarning)return;
      const connected=new Set(snapshot.accounts.filter(eligible).map(a=>a.id));
      // Never close or kill a user-controlled login browser.
      for(const id of manual.keys())if(!connected.has(id))manual.delete(id);
      for(const account of snapshot.accounts.filter(eligible)){
        if(stopped)break;
        if(manual.has(account.id)||busy.has(account.id))continue;
        if(!await current(account.id))continue;
        await run(account,()=>refreshAccount(account)).catch(()=>{});
      }
    }finally{tickBusy=false;}
  }
  function start(){
    if(timer||stopped)return;
    const ms=Math.max(1,Math.min(120,Number(intervalMinutes)||5))*60000;
    timer=setInterval(()=>void tick().catch(()=>{}),ms);timer.unref?.();
    // The account monitor starts independently. Try again shortly after startup
    // to avoid waiting an entire refresh interval for the initial inventory.
    void tick().catch(()=>{});
  }
  async function stop(){
    stopped=true;if(timer)clearInterval(timer);timer=null;
    manual.clear();
    await Promise.allSettled([...contexts].map(c=>closeContext(c)));
    await Promise.allSettled([...busy.values()]);
  }
  return {action,tick,start,stop};
}
const COMMAND_ERRORS=new Set(['service_unavailable','inventory_unavailable','account_unavailable','invalid_action','invalid_billing_page','action_failed']);
function createBillingCommands(service,{log=()=>{}}={}) {
  const active=new Map(),results=new Map();
  let stopped=false;
  const record=(id,ticket,result)=>{
    if(stopped)return;
    results.set(id,{ticket,result});
    // Bound process-local diagnostic metadata. No credentials or URLs here.
    if(results.size>80)results.delete(results.keys().next().value);
    try{log(result);}catch{}
  };
  function submit({id,action,ticket,page=''}={}) {
    if(stopped)return 'service_unavailable';
    if(typeof id!=='string'||!id||id.length>120||
      typeof ticket!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(ticket)||
      !['open','confirm','disconnect'].includes(action)||
      typeof page!=='string'||page.length>512||(action!=='confirm'&&page!=='')||
      (action==='confirm'&&!billingPage('codex',page)&&!billingPage('opencode',page)))return 'invalid_action';
    const running=active.get(id);
    if(running)return running.ticket===ticket?'queued':'busy';
    if(active.size>=80)return 'busy';
    if(results.get(id)?.ticket===ticket)return 'queued';
    const entry={ticket};
    active.set(id,entry);
    record(id,ticket,'pending');
    // Do not keep the host IPC invocation open during browser startup, network
    // navigation or a credential refresh. The main service owns this task.
    entry.task=Promise.resolve().then(()=>stopped?null:service.action(id,action,page)).then(result=>{
      if(stopped)return;
      record(id,ticket,result?.accepted===true?'accepted':
        COMMAND_ERRORS.has(result?.reason)?result.reason:'action_failed');
    }).catch(()=>record(id,ticket,'action_failed')).finally(()=>{
      if(active.get(id)===entry)active.delete(id);
    });
    return 'queued';
  }
  function status({id,ticket}={}) {
    const entry=results.get(id);
    return entry?.ticket===ticket?entry.result:'unknown';
  }
  function stop(){stopped=true;results.clear();}
  return {submit,status,stop};
}
module.exports={billingPage,eligible,readBillingAmount,browserEnvironment,findBrowser,startLoginBrowser,createBillingSessions,createBillingCommands,STATES};
