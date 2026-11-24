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
const BROWSERS = Object.freeze({
  msedge: {name:'Microsoft Edge',prog:['MSEdgeHTM'],exe:'msedge.exe',dirs:['Microsoft/Edge/Application'],pw:'msedge'},
  chrome: {name:'Google Chrome',prog:['ChromeHTML'],exe:'chrome.exe',dirs:['Google/Chrome/Application'],pw:'chrome'},
  brave: {name:'Brave',prog:['BraveHTML'],exe:'brave.exe',dirs:['BraveSoftware/Brave-Browser/Application']},
  opera: {name:'Opera',prog:['OperaStable'],exe:'opera.exe',dirs:['Opera','Programs/Opera']},
  'opera-gx': {name:'Opera GX',prog:['OperaGXStable'],exe:'opera.exe',dirs:['Opera GX','Programs/Opera GX']},
  vivaldi: {name:'Vivaldi',prog:['VivaldiHTM','VivaldiHTML'],exe:'vivaldi.exe',dirs:['Vivaldi/Application','Programs/Vivaldi/Application']},
  chromium: {name:'Chromium',prog:['ChromiumHTM','ChromiumHTML'],exe:'chrome.exe',dirs:['Chromium/Application','Chromium','Programs/Chromium/Application']},
  yandex: {name:'Yandex Browser',prog:['YandexHTML','YandexBrowserHTML'],exe:'browser.exe',dirs:['Yandex/YandexBrowser/Application']},
  'msedge-beta': {name:'Edge Beta',prog:['MSEdgeBHTML'],exe:'msedge.exe',dirs:['Microsoft/Edge Beta/Application'],pw:'msedge-beta'},
  'msedge-dev': {name:'Edge Dev',prog:['MSEdgeDHTML'],exe:'msedge.exe',dirs:['Microsoft/Edge Dev/Application'],pw:'msedge-dev'},
  'msedge-canary': {name:'Edge Canary',prog:['MSEdgeSSHTM'],exe:'msedge.exe',dirs:['Microsoft/Edge SxS/Application'],pw:'msedge-canary'},
  'chrome-beta': {name:'Chrome Beta',prog:['ChromeBHTML'],exe:'chrome.exe',dirs:['Google/Chrome Beta/Application'],pw:'chrome-beta'},
  'chrome-dev': {name:'Chrome Dev',prog:['ChromeDHTML'],exe:'chrome.exe',dirs:['Google/Chrome Dev/Application'],pw:'chrome-dev'},
  'chrome-canary': {name:'Chrome Canary',prog:['ChromeSSHTM'],exe:'chrome.exe',dirs:['Google/Chrome SxS/Application'],pw:'chrome-canary'},
  'brave-beta': {name:'Brave Beta',prog:['BraveBHTML','BraveBetaHTML'],exe:'brave.exe',dirs:['BraveSoftware/Brave-Browser-Beta/Application']},
  'brave-dev': {name:'Brave Dev',prog:['BraveDHTML','BraveDevHTML'],exe:'brave.exe',dirs:['BraveSoftware/Brave-Browser-Dev/Application']},
  'brave-nightly': {name:'Brave Nightly',prog:['BraveNHTML','BraveNightlyHTML'],exe:'brave.exe',dirs:['BraveSoftware/Brave-Browser-Nightly/Application']},
  'opera-beta': {name:'Opera Beta',prog:['OperaNext','OperaBeta'],exe:'opera.exe',dirs:['Opera beta','Programs/Opera beta']},
  'opera-developer': {name:'Opera Developer',prog:['OperaDeveloper'],exe:'opera.exe',dirs:['Opera developer','Programs/Opera developer']},
  'vivaldi-snapshot': {name:'Vivaldi Snapshot',prog:['VivaldiSnapshotHTM'],exe:'vivaldi.exe',dirs:['Vivaldi Snapshot/Application','VivaldiSnapshot/Application']},
  thorium: {name:'Thorium',prog:['ThoriumHTM','ThoriumHTML'],exe:'thorium.exe',dirs:['Thorium/Application','Thorium','Programs/Thorium/Application']},
  slimjet: {name:'Slimjet',prog:['SlimjetHTML','SlimjetHTM'],exe:'slimjet.exe',dirs:['Slimjet']},
  cent: {name:'Cent Browser',prog:['CentBrowserHTML','CentBrowserHTM'],exe:'chrome.exe',dirs:['CentBrowser/Application']},
  'coc-coc': {name:'Coc Coc',prog:['CocCocHTML','CocCocHTM'],exe:'browser.exe',dirs:['CocCoc/Browser/Application']},
  'avast-secure': {name:'Avast Secure Browser',prog:['AvastHTML','AvastSecureBrowserHTML'],exe:'AvastBrowser.exe',dirs:['AVAST Software/Browser/Application']},
  'avg-secure': {name:'AVG Secure Browser',prog:['AVGHTML','AVGSecureBrowserHTML'],exe:'AVGBrowser.exe',dirs:['AVG/Browser/Application']}
});
const CHANNELS = Object.keys(BROWSERS);
const ACTIONS = ['open','open_edge',...CHANNELS.map(id=>'open_'+id),'confirm','disconnect'];
const CHOICE_STATES = ['choose_edge','choose_chrome','choose_browser'];
const ENTRY = {codex:'https://platform.openai.com/settings/organization/billing/overview',opencode:'https://opencode.ai/console'};
const STATES = ['connecting','awaiting_confirmation','confirmation_unavailable','ok','stale',
  'choose_edge','choose_chrome','choose_browser','close_login_browser','login_required','balance_unavailable','runtime_missing','browser_missing','browser_error','browser_timeout','profile_busy','browser_access_denied','profile_error','disconnect_error'];

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
// Read the current user's HTTPS association. Registry command strings are
// never executed: only an existing, local .exe with an allowlisted browser
// basename is extracted. Unknown apps and unsupported engines fail closed.
function browserFromProgId(value) {
  const id=String(value||'').trim().toLowerCase();
  for(const [key,spec] of Object.entries(BROWSERS)){
    if(spec.prog.some(p=>id===p.toLowerCase()||id.startsWith(p.toLowerCase()+'.')))return key;
  }
  return null;
}
function registryValue(stdout,name=''){
  const line=String(stdout||'').split(/\r?\n/).find(line=>{
    const m=line.match(/^\s*(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i);
    return m&&(name?m[1].trim().toLowerCase()===name.toLowerCase():true);
  });
  return line?.match(/^\s*(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i)?.[2]||null;
}
function registryQuery(key,value,env=process.env,platform=process.platform,execFile=require('node:child_process').execFile){
  if(platform!=='win32')return Promise.resolve(null);
  const systemRoot=env.SystemRoot||env.SYSTEMROOT||env.WINDIR;
  if(typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot)||systemRoot.startsWith('\\\\'))return Promise.resolve(null);
  const exe=path.win32.join(systemRoot,'System32','reg.exe');
  return new Promise(resolve=>{
    try{
      execFile(exe,['query',key,...(value?['/v',value]:['/ve'])],{shell:false,windowsHide:true,timeout:3000,maxBuffer:16384,env:browserEnvironment(env)},(error,stdout)=>{
        resolve(error?null:registryValue(stdout,value));
      });
    }catch{resolve(null);}
  });
}
function browserExecutable(command,env={}){
  if(typeof command!=='string'||command.length>8192)return null;
  const m=command.trim().match(/^(?:"([^"]+\.exe)"|([A-Za-z]:\\.*?\.exe))(?=\s|$)/i);
  if(!m)return null;
  const expanded=(m[1]||m[2]).replace(/%([A-Za-z0-9_()]+)%/g,(whole,key)=>{
    const found=Object.entries(env).find(([name])=>name.toLowerCase()===key.toLowerCase());
    return typeof found?.[1]==='string'?found[1]:whole;
  });
  // No UNC/network paths, shell syntax, alternate streams or relative paths.
  if(!/^[A-Za-z]:\\[^<>"|?*\x00-\x1f]+\.exe$/i.test(expanded)||expanded.slice(2).includes(':')||expanded.includes('%'))return null;
  return path.win32.normalize(expanded);
}
function browserMatchesPath(channel,executablePath){
  const spec=BROWSERS[channel];
  if(!spec||typeof executablePath!=='string')return false;
  return path.win32.basename(executablePath).toLowerCase()===spec.exe.toLowerCase();
}
function browserVariant(channel,executablePath){
  if(!channel||!executablePath)return channel;
  const normalized=executablePath.replace(/\\/g,'/').toLowerCase();
  // Some installations share a base ProgId across releases. Prefer the exact
  // known installation directory if it identifies a variant of this family.
  const family=channel.replace(/-(?:beta|dev|canary|nightly|developer|snapshot)$/,'');
  const candidates=CHANNELS.filter(id=>id===family||id.startsWith(family+'-')).sort((a,b)=>b.length-a.length);
  for(const id of candidates)if(browserMatchesPath(id,executablePath)&&BROWSERS[id].dirs.some(dir=>normalized.endsWith('/'+dir.toLowerCase()+'/'+BROWSERS[id].exe.toLowerCase())))return id;
  return channel;
}
async function defaultWindowsBrowser(env=process.env,platform=process.platform,execFile=require('node:child_process').execFile){
  const query=(key,value)=>registryQuery(key,value,env,platform,execFile);
  const key='HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';
  const prog=await query(key,'ProgId');
  const channel=browserFromProgId(prog);
  if(!channel)return null;
  // Do not interpolate untrusted registry key syntax.
  if(!/^[A-Za-z0-9_.-]{1,150}$/.test(prog))return {channel};
  const command=await query('HKCR\\'+prog+'\\shell\\open\\command','');
  let executablePath=browserExecutable(command,env);
  // Older Opera registrations point to a launcher; prefer the actual browser
  // executable, not a launcher that may spawn a second process.
  if(executablePath&&/^opera(?:-|$)/.test(channel)&&path.win32.basename(executablePath).toLowerCase()==='launcher.exe')
    executablePath=path.win32.join(path.win32.dirname(executablePath),'opera.exe');
  const resolved=browserVariant(channel,executablePath);
  return browserMatchesPath(resolved,executablePath)?{channel:resolved,executablePath}:{channel:resolved};
}
async function findBrowser(preferred=null,env=process.env,access=fs.access){
  const roots=[env['ProgramFiles(x86)'],env.ProgramW6432,env.ProgramFiles,env.LOCALAPPDATA]
    .filter(x=>typeof x==='string'&&path.isAbsolute(x));
  for(const channel of preferred?[preferred]:CHANNELS){
    const spec=BROWSERS[channel];
    if(!spec)continue;
    for(const root of new Set(roots))for(const relative of spec.dirs){
      const executablePath=path.join(root,...relative.split('/'),spec.exe);
      try{await access(executablePath);return {channel,executablePath};}catch{}
    }
  }
  return null;
}
async function findRegisteredBrowser(channel,env=process.env,access=fs.access){
  // App Paths is useful for non-standard installations, but shared exe names
  // (chrome.exe, browser.exe, etc.) cannot safely identify a browser variant.
  const spec=BROWSERS[channel];
  if(!spec||CHANNELS.filter(id=>BROWSERS[id].exe.toLowerCase()===spec.exe.toLowerCase()).length!==1)return null;
  for(const hive of ['HKCU','HKLM']){
    const raw=await registryQuery(hive+'\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\'+spec.exe,'',env);
    const executablePath=browserExecutable(raw,env);
    if(!browserMatchesPath(channel,executablePath))continue;
    try{await access(executablePath);return {channel,executablePath};}catch{}
  }
  return null;
}
async function selectBillingBrowser({preferred=null,explicit=null,env=process.env,browserFinder=findBrowser,defaultBrowser=defaultWindowsBrowser,access=fs.access}={}){
  // A bound or explicitly selected browser takes precedence over Windows.
  // A new session uses the exact registered executable when available.
  const detected=await defaultBrowser(env);
  const system=typeof detected==='string'?{channel:detected}:detected;
  const selected=explicit||preferred||system?.channel;
  if(CHANNELS.includes(selected)){
    if(system?.channel===selected&&browserMatchesPath(selected,system.executablePath)){
      try{await access(system.executablePath);return {browser:system,state:null,choices:[]};}catch{}
    }
    const browser=await browserFinder(selected,env);
    if(browser?.channel===selected)return {browser,state:null,choices:[]};
    if(browserFinder===findBrowser){
      const registered=await findRegisteredBrowser(selected,env,access);
      if(registered)return {browser:registered,state:null,choices:[]};
    }
  }
  const available=await Promise.all(CHANNELS.map(async channel=>{
    const browser=await browserFinder(channel,env);
    return browser?.channel===channel?channel:null;
  }));
  const choices=available.filter(Boolean);
  return {browser:null,state:choices.length?'choose_browser':'browser_missing',choices};
}
function playwrightBrowserChannel(channel){
  // Playwright recognizes only its branded channels and "chromium". Other
  // Chromium derivatives must be launched using their own executablePath.
  return BROWSERS[channel]?.pw||'chromium';
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
  loginLauncher=startLoginBrowser,defaultBrowser=defaultWindowsBrowser,env=process.env}={}) {
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
  async function publish(account,state,{amount=null,checkedAt=0,preserve=false,browser=null,choices=[]}={}){
    if(stopped)return store.cached();
    const old=stateFor(await store.cached(),account.id,account.provider);
    if(preserve&&Number.isFinite(old?.amount)){amount=old.amount;checkedAt=old.checkedAt;}
    return store.setBillingSession(account.id,account.provider,{id:account.id,provider:account.provider,state,amount,checkedAt,
      browser:browser||old?.browser||null,browserChoices:choices});
  }
  async function readBinding(account){
    try{
      const b=JSON.parse(await io.readFile(bindingFile(account),'utf8'));
      if(b?.id===account.id&&b.provider===account.provider&&CHANNELS.includes(b.channel)&&
        typeof b.url==='string'&&billingPage(account.provider,b.url)===b.url)
        return {...b,executablePath:browserMatchesPath(b.channel,b.executablePath)&&browserExecutable('"'+b.executablePath+'"')===b.executablePath?b.executablePath:null};
    }catch{}
    return null;
  }
  async function saveBinding(account,b){
    await io.mkdir(folder(account),{recursive:true,mode:0o700});
    const temp=bindingFile(account)+'.tmp';
    await io.writeFile(temp,JSON.stringify({id:account.id,provider:account.provider,channel:b.channel,url:b.url,executablePath:b.executablePath||null}),{encoding:'utf8',mode:0o600});
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
      channel:playwrightBrowserChannel(browser.channel),executablePath:browser.executablePath,headless:true,
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
  async function open(account,explicit=null){
    const existing=manual.get(account.id);
    if(existing?.process.isRunning())return publish(account,'awaiting_confirmation');
    const old=await readBinding(account);
    try{
      // Check availability without launching an automated browser.
      try{if(!chromiumLoader()?.launchPersistentContext)throw Error();}catch{throw new Error('runtime_missing');}
      let selected;
      // Keep the exact executable of an already confirmed non-standard install.
      const saved=existing?.browser||old;
      if(!explicit&&saved?.executablePath&&browserMatchesPath(saved.channel,saved.executablePath)){
        try{await io.access(saved.executablePath);selected={browser:{channel:saved.channel,executablePath:saved.executablePath}};}catch{}
      }
      if(!selected)selected=await selectBillingBrowser({
        preferred:saved?.channel??null,explicit,env,browserFinder,defaultBrowser
      });
      if(!selected.browser)return publish(account,selected.state,{choices:selected.choices});
      const browser=selected.browser;
      await io.rm(bindingFile(account),{force:true}).catch(()=>{throw new Error('profile_error');});
      await publish(account,'connecting',{browser:browser.channel});
      const profilePath=profile(account,browser.channel);
      try{await io.mkdir(profilePath,{recursive:true,mode:0o700});}
      catch{throw new Error('profile_error');}
      const url=existing?.url||old?.url||ENTRY[account.provider];
      const process=await loginLauncher({browser,profilePath,url,env});
      manual.set(account.id,{browser,process,url});
      return publish(account,'awaiting_confirmation',{browser:browser.channel});
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
      await saveBinding(account,{channel:record.browser.channel,url:result.url,executablePath:record.browser.executablePath});
      manual.delete(account.id);
      return publish(account,'ok',{amount:result.amount,checkedAt:clock(),browser:record.browser.channel});
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
    if(['disconnect_error','login_required',...CHOICE_STATES].includes(initialState?.state))return;
    const binding=await readBinding(account);
    if(!binding){
      const state=stateFor(await store.cached(),account.id,account.provider);
      if(Number.isFinite(state?.amount))await store.setBillingSession(account.id,account.provider,null);
      else if(['connecting','awaiting_confirmation','confirmation_unavailable','close_login_browser'].includes(state?.state))await publish(account,'login_required');
      return;
    }
    let context;
    try{
      let browser=null;
      if(binding.executablePath){
        try{await io.access(binding.executablePath);browser={channel:binding.channel,executablePath:binding.executablePath};}catch{}
      }
      if(!browser)browser=await browserFinder(binding.channel,env);
      if(!browser)throw new Error('browser_missing');
      context=await launch(account,browser);
      const result=await navigateBilling(context,account,binding.url);
      if(!await current(account.id))return;
      if(result.state==='ok')await publish(account,'ok',{amount:result.amount,checkedAt:clock(),browser:browser.channel});
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
    if(!ACTIONS.includes(verb))return reply(false,'invalid_action');
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
        return verb==='confirm'?confirm(account,page):verb==='disconnect'?disconnect(account):
          open(account,verb==='open_edge'?'msedge':verb.startsWith('open_')?verb.slice(5):null);
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
      !ACTIONS.includes(action)||
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
module.exports={billingPage,eligible,readBillingAmount,browserEnvironment,BROWSERS,browserFromProgId,browserExecutable,browserVariant,defaultWindowsBrowser,findBrowser,selectBillingBrowser,playwrightBrowserChannel,startLoginBrowser,createBillingSessions,createBillingCommands,STATES};
