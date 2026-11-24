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
const ACTIONS = ['open','open_edge',...CHANNELS.map(id=>'open_'+id),'disconnect'];
const CHOICE_STATES = ['choose_edge','choose_chrome','choose_browser'];
const ENTRY = {codex:'https://platform.openai.com/settings/organization/billing/overview',opencode:'https://opencode.ai/console'};
const STATES = ['connecting','awaiting_login','checking_billing','awaiting_confirmation','confirmation_unavailable','ok','stale',
  'choose_edge','choose_chrome','choose_browser','close_login_browser','page_detected','billing_page_missing','billing_page_ambiguous','billing_page_unavailable','login_required','balance_unavailable','runtime_missing','browser_missing','browser_error','browser_timeout','profile_busy','browser_access_denied','profile_error','disconnect_error'];

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
// Navigation discovery is limited to the user-authorized dedicated profile,
// after the ordinary login window closes. Never query the personal browser,
// Cookies, Login Data, authentication URLs, page titles or browsing contents.
const WINDOWS_EPOCH_US=11644473600000000n;
const MAX_DISCOVERY_BYTES=16*1024*1024;
const visitCutoff=ms=>BigInt(Math.floor(ms))*1000n+WINDOWS_EPOCH_US;
const billingPatterns=provider=>provider==='codex'
  ?['https://platform.openai.com/settings/organization/billing/overview*']
  :provider==='opencode'
    ?['https://opencode.ai/workspace/*/billing*','https://opencode.ai/*/settings/billing*']:[];

// Chromium stores its ordinary history in SQLite. Only URLs of candidate
// billing pages visited during this login attempt are returned by the query.
// Reference: Chromium history_database.cc and url_database.cc.
function historyBillingPages(file,provider,since,loadSQLite=()=>require('node:sqlite')){
  const patterns=billingPatterns(provider);
  if(!patterns.length)return [];
  const {DatabaseSync}=loadSQLite();
  const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=250;');
    const query='SELECT url FROM urls WHERE last_visit_time>=? AND length(url)<=512 AND ('+
      patterns.map(()=>'url GLOB ?').join(' OR ')+') LIMIT 65';
    const rows=db.prepare(query).all(visitCutoff(since),...patterns);
    if(rows.length>=65)return null; // truncated evidence is ambiguous
    return [...new Set(rows.map(row=>billingPage(provider,row.url)).filter(Boolean))];
  }finally{db.close();}
}

// Fallback for unencrypted Chromium session files, if the host lacks SQLite
// or this browser's History format cannot be read. Parse only the URL field
// of UpdateTabNavigation records; never decode titles, serialized page state,
// other record types, or encrypted session storage. The file format is
// described by Chromium SessionCommand and SerializedNavigationEntry.
function navigationTimestamp(buffer,pickle,end,length){
  // Skip length-delimited fields without decoding them. The serialized
  // navigation timestamp prevents restored entries from an earlier login
  // being mistaken for visits made in this attempt.
  let pos=pickle+16+Math.ceil(length/4)*4;
  const skipString=unit=>{
    if(pos+4>end)return false;
    const n=buffer.readInt32LE(pos);
    if(n<0||n>(end-pos-4)/unit)return false;
    pos+=4+Math.ceil(n*unit/4)*4;
    return pos<=end;
  };
  const skip=n=>{pos+=n;return pos<=end;};
  if(!skipString(2)||!skipString(1)||!skip(8)||!skipString(1)||!skip(4)||
    !skipString(1)||!skip(4)||pos+8>end)return null;
  return buffer.readBigInt64LE(pos);
}
function sessionBillingPages(buffer,provider,since){
  if(!Buffer.isBuffer(buffer)||buffer.length<8||buffer.length>MAX_DISCOVERY_BYTES||
    buffer.toString('ascii',0,4)!=='SNSS'||![1,3].includes(buffer.readUInt32LE(4)))return null;
  if(!Number.isFinite(since)||since<=0)return null;
  const cutoff=visitCutoff(since);
  const prefix=Buffer.from(provider==='codex'?'https://platform.openai.com/settings/organization/billing/overview':'https://opencode.ai/');
  const pages=new Set();
  for(let offset=8;offset<buffer.length;){
    if(offset+3>buffer.length)return null;
    const size=buffer.readUInt16LE(offset),start=offset+2,end=start+size;
    if(size<1||end>buffer.length)return null;
    if(buffer[start]===6&&size>=17){
      const pickle=start+1;
      const payloadSize=buffer.readUInt32LE(pickle);
      const length=buffer.readInt32LE(pickle+12);
      if(payloadSize===size-5&&length>0&&length<=512&&pickle+16+length<=end){
        // Decode only candidate URLs under the expected provider origin.
        if(length>=prefix.length&&buffer.subarray(pickle+16,pickle+16+prefix.length).equals(prefix)){
          const url=billingPage(provider,buffer.toString('utf8',pickle+16,pickle+16+length));
          if(url){
            const timestamp=navigationTimestamp(buffer,pickle,end,length);
            if(timestamp===null)return null;
            if(timestamp>=cutoff)pages.add(url);
          }
          if(pages.size>1)return [...pages];
        }
      }
    }
    offset=end;
  }
  return [...pages];
}
async function plainFile(io,root,file,maxSize){
  try{
    const stat=await io.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxSize)return false;
    const actual=await io.realpath(file),rel=path.relative(root,actual);
    return !!rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);
  }catch{return false;}
}
async function discoverBillingPage({provider,profilePath,dedicatedDirectory,since,io=fs,loadSQLite}={}){
  if(!PROVIDERS.has(provider)||!Number.isFinite(since)||since<=0)return {state:'billing_page_unavailable'};
  let root;
  try{
    const st=await io.lstat(profilePath);
    if(!st.isDirectory()||st.isSymbolicLink())return {state:'billing_page_unavailable'};
    root=await io.realpath(profilePath);
    if(dedicatedDirectory){
      const base=await io.realpath(dedicatedDirectory);
      const expected=path.relative(dedicatedDirectory,profilePath);
      const actual=path.relative(base,root);
      // Reject a junction/symlink redirecting a hashed account directory
      // into another profile, even when the final directory itself is normal.
      if(!expected||path.isAbsolute(expected)||expected==='..'||expected.startsWith('..'+path.sep)||
        actual!==expected)return {state:'billing_page_unavailable'};
    }
  }catch{return {state:'billing_page_unavailable'};}
  const pages=new Set();
  let readable=false,uncertain=false;
  // Chromium and its derivatives use either Default or the user-data root
  // itself. No traversal into arbitrary profiles or user's personal history.
  const profiles=[path.join(root,'Default'),root];
  for(const dir of profiles){
    const file=path.join(dir,'History');
    if(!await plainFile(io,root,file,128*1024*1024))continue;
    try{
      const found=historyBillingPages(file,provider,since,loadSQLite);
      if(found===null){uncertain=true;continue;}
      readable=true;
      for(const url of found)pages.add(url);
    }catch{}
  }
  if(uncertain||pages.size>1)return {state:'billing_page_ambiguous'};
  if(readable)return pages.size===1?{state:'page_detected',url:[...pages][0]}:{state:'billing_page_missing'};
  // Recent session files only; no older session restore files and no decryption.
  // The filename is a timestamp in microseconds since the Windows epoch.
  for(const dir of profiles){
    const sessions=path.join(dir,'Sessions');
    let entries;
    try{
      const st=await io.lstat(sessions),real=await io.realpath(sessions);
      const rel=path.relative(root,real);
      if(!st.isDirectory()||st.isSymbolicLink()||!rel||path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep))continue;
      entries=await io.readdir(sessions);
    }catch{continue;}
    const cutoff=visitCutoff(since);
    const files=entries.filter(name=>/^Session_\d{15,20}$/.test(name)&&BigInt(name.slice(8))>=cutoff).sort();
    if(files.length>8){uncertain=true;continue;}
    for(const name of files){
      const file=path.join(sessions,name);
      if(!await plainFile(io,root,file,MAX_DISCOVERY_BYTES))continue;
      try{
        const bytes=await io.readFile(file);
        const found=sessionBillingPages(bytes,provider,since);
        if(found===null){uncertain=true;continue;}
        readable=true;
        for(const url of found)pages.add(url);
      }catch{}
    }
  }
  if(pages.size>1)return {state:'billing_page_ambiguous'};
  if(uncertain)return {state:'billing_page_unavailable'};
  return pages.size===1?{state:'page_detected',url:[...pages][0]}:{state:readable?'billing_page_missing':'billing_page_unavailable'};
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
      resolve({
        pid:child.pid,
        isRunning:()=>child.exitCode===null&&child.signalCode===null,
        onExit:fn=>{
          if(child.exitCode!==null||child.signalCode!==null)Promise.resolve().then(fn);
          else child.once('exit',fn);
        }
      });
    });
  });
}
// The helper is installed with the plugin. It runs in a separate short-lived
// Windows PowerShell process so an unresponsive accessibility provider
// cannot block the host. Timeout/abort affects only the helper.
function inspectBillingWindow({pluginFolder,browser,profilePath,provider,startedAt,pid,expected=null,signal,env=process.env,
  platform=process.platform,execFile=require('node:child_process').execFile}={}){
  const unavailable={state:'unavailable'};
  if(platform!=='win32'||!pluginFolder||!PROVIDERS.has(provider)||
    !Number.isSafeInteger(pid)||pid<=0||pid>2147483647||!Number.isFinite(startedAt)||startedAt<=0||
    !browserMatchesPath(browser?.channel,browser?.executablePath)||!path.win32.isAbsolute(profilePath||'')||
    signal?.aborted)return Promise.resolve(unavailable);
  const systemRoot=env.SystemRoot||env.SYSTEMROOT||env.WINDIR;
  if(typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot)||systemRoot.startsWith('\\\\'))return Promise.resolve(unavailable);
  const executable=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=path.join(pluginFolder,'installer','BillingWindow.ps1');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-MTA','-ExecutionPolicy','Bypass','-File',script,
    '-BrowserProcessId',String(pid),'-BrowserExecutable',browser.executablePath,'-ProfileDirectory',profilePath,
    '-Provider',provider,'-StartedAt',String(Math.floor(startedAt))];
  const expectedUrl=billingPage(provider,expected?.url);
  if(expectedUrl&&Number.isInteger(expected?.window)&&expected.window!==0)
    args.push('-ExpectedUrl',expectedUrl,'-ExpectedWindow',String(expected.window));
  return new Promise(resolve=>{
    try{
      execFile(executable,args,{shell:false,windowsHide:true,timeout:12000,maxBuffer:4096,
        env:browserEnvironment(env),...(signal?{signal}:{})},(error,stdout)=>{
        if(error){resolve(unavailable);return;}
        try{
          const r=JSON.parse(String(stdout).trim());
          if(!['ready','close_requested'].includes(r?.state)){resolve({state:r?.state==='not_ready'?'not_ready':'unavailable'});return;}
          const url=billingPage(provider,r.url),window=r.window;
          if(!url||!Number.isInteger(window)||window===0||window< -2147483648||window>2147483647||
            (r.state==='close_requested'&&(!expectedUrl||url!==expectedUrl||window!==expected.window))){
            resolve(unavailable);return;
          }
          resolve({state:r.state,url,window});
        }catch{resolve(unavailable);}
      });
    }catch{resolve(unavailable);}
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
  loginLauncher=startLoginBrowser,defaultBrowser=defaultWindowsBrowser,pageDiscovery=discoverBillingPage,
  retryWait=pause,windowInspector=inspectBillingWindow,env=process.env}={}) {
  const manual=new Map(),busy=new Map(),contexts=new Set();
  let stopped=false,timer=null,loginTimer=null,tickBusy=false;
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
    if(existing?.process.isRunning())return publish(account,'awaiting_login');
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
      const startedAt=clock();
      const process=await loginLauncher({browser,profilePath,url,env});
      const record={account,browser,process,url,profilePath,startedAt,finished:false,completion:null,
        windowProbe:null,windowAbort:null,lastWindowProbe:0,readyWindow:null,closeRequested:false,autoCloseUrl:null};
      manual.set(account.id,record);
      const snapshot=await publish(account,'awaiting_login',{browser:browser.channel});
      // Authorization is always manual and outside Playwright. Once the
      // dedicated browser exits, continue the user-initiated connection in
      // main, regardless of whether the dashboard popup is still open.
      process.onExit?.(()=>{void scheduleCompletion(account,record);});
      // Also cover browser launchers that exit before the listener is attached.
      if(!process.isRunning())void scheduleCompletion(account,record);
      return snapshot;
    }catch(e){return publish(account,safeError(e));}
  }
  const sameAttempt=(account,record)=>!stopped&&manual.get(account.id)===record;
  async function detectPage(account,record){
    if(record.process.isRunning())return {state:'close_login_browser'};
    let result;
    try{result=await pageDiscovery({provider:account.provider,profilePath:record.profilePath,dedicatedDirectory:directory,since:record.startedAt,io});}
    catch{result={state:'billing_page_unavailable'};}
    if(!sameAttempt(account,record))return {state:'billing_page_unavailable'};
    const url=result.state==='page_detected'?billingPage(account.provider,result.url):null;
    const state=url?'page_detected':(['billing_page_missing','billing_page_ambiguous','billing_page_unavailable'].includes(result.state)?result.state:'billing_page_unavailable');
    return {state,url};
  }
  async function completeLogin(account,record){
    if(!sameAttempt(account,record)||record.process.isRunning()||!await current(account.id))return;
    const browser=record.browser.channel;
    const finish=async state=>{
      if(!sameAttempt(account,record))return;
      record.finished=true;
      return publish(account,state,{browser});
    };
    let context;
    try{
      await publish(account,'checking_billing',{browser});
      // The browser may still be flushing its dedicated history or releasing
      // the profile lock. Retry only these transient failures, with a bound.
      let detected;
      for(const delay of [0,500,1500,3000]){
        if(delay)await retryWait(delay);
        if(!sameAttempt(account,record)||record.process.isRunning()||!await current(account.id))return;
        detected=await detectPage(account,record);
        if(detected.url||detected.state==='billing_page_ambiguous')break;
      }
      if(!detected?.url)return finish(detected?.state||'billing_page_unavailable');
      // If we requested the close, the flushed navigation must agree with
      // the visible document that triggered it.
      if(record.autoCloseUrl&&record.autoCloseUrl!==detected.url)return finish('billing_page_ambiguous');
      let result;
      for(const delay of [0,1000,3000]){
        if(delay)await retryWait(delay);
        if(!sameAttempt(account,record)||record.process.isRunning()||!await current(account.id))return;
        try{
          context=await launch(account,record.browser);
          break;
        }catch(e){
          if(e?.message!=='profile_busy'||delay===3000)throw e;
        }
      }
      if(!context)return finish('browser_error');
      result=await navigateBilling(context,account,detected.url);
      await closeContext(context);context=null;
      if(!sameAttempt(account,record)||!await current(account.id))return;
      // Never infer a zero balance or select another organization/workspace.
      // Bind only a unique, recognized page from this login attempt for which
      // the normal post-login read produced an actual finite amount.
      if(result.state!=='ok')return finish(result.state==='login_required'?'login_required':'confirmation_unavailable');
      await saveBinding(account,{channel:browser,url:result.url,executablePath:record.browser.executablePath});
      if(!sameAttempt(account,record))return;
      record.finished=true;
      manual.delete(account.id);
      return publish(account,'ok',{amount:result.amount,checkedAt:clock(),browser});
    }catch(e){
      return finish(safeError(e));
    }finally{if(context)await closeContext(context).catch(()=>{});}
  }
  function scheduleCompletion(account,record){
    if(!sameAttempt(account,record)||record.finished||record.process.isRunning()||record.windowProbe)return Promise.resolve();
    if(record.completion)return record.completion;
    // Use the same per-account queue as reconnect/disconnect and periodic reads.
    // An exit notification, a watchdog check and a refresh can never launch
    // competing headless readers for the same profile.
    const task=run(account,()=>completeLogin(account,record),true)
      .catch(async()=>{if(sameAttempt(account,record)){record.finished=true;await publish(account,'browser_error').catch(()=>{});}})
      .finally(()=>{if(record.completion===task)record.completion=null;});
    record.completion=task;
    return task;
  }
  function watchLoginWindow(account,record){
    if(!sameAttempt(account,record)||record.finished||!record.process.isRunning()||record.closeRequested||
      !Number.isSafeInteger(record.process.pid)||record.process.pid<=0)return Promise.resolve();
    if(record.windowProbe)return record.windowProbe;
    const now=clock();
    if(record.lastWindowProbe&&now-record.lastWindowProbe<4000)return Promise.resolve();
    record.lastWindowProbe=now;
    const controller=new AbortController();
    record.windowAbort=controller;
    const task=Promise.resolve().then(async()=>{
      if(!sameAttempt(account,record)||!record.process.isRunning()||!await current(account.id))return;
      // A stable visible Billing page must remain selected for at least
      // eight seconds, giving the user a chance to select their workspace.
      const candidate=record.readyWindow;
      const expected=candidate&&now-candidate.since>=8000?candidate:null;
      const result=await windowInspector({pluginFolder,browser:record.browser,profilePath:record.profilePath,
        provider:account.provider,startedAt:record.startedAt,pid:record.process.pid,expected,signal:controller.signal,env});
      if(!sameAttempt(account,record))return;
      const url=billingPage(account.provider,result?.url),window=result?.window;
      if(result?.state==='close_requested'&&expected&&url===expected.url&&window===expected.window){
        record.autoCloseUrl=url;record.closeRequested=true;
        record.readyWindow=null;
      }else if(result?.state==='ready'&&url&&Number.isInteger(window)&&window!==0){
        record.readyWindow=candidate?.url===url&&candidate.window===window?candidate:{url,window,since:clock()};
      }else record.readyWindow=null;
    }).catch(()=>{record.readyWindow=null;}).finally(()=>{
      if(record.windowProbe===task){record.windowProbe=null;record.windowAbort=null;}
      if(!record.process.isRunning())void scheduleCompletion(account,record);
    });
    record.windowProbe=task;
    return task;
  }
  function checkLoginWindows(){
    if(stopped)return;
    for(const record of manual.values()){
      if(record.process.isRunning())void watchLoginWindow(record.account,record);
      else void scheduleCompletion(record.account,record);
    }
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
      else if(['connecting','awaiting_login','checking_billing','awaiting_confirmation','close_login_browser','page_detected'].includes(state?.state))await publish(account,'login_required');
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
  async function action(id,verb){
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
    try{
      let executed=false;
      await run(account,async()=>{
        executed=true;
        return verb==='disconnect'?disconnect(account):
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
      for(const [id,record] of manual)if(!connected.has(id)){
        record.windowAbort?.abort();manual.delete(id);
      }
      for(const account of snapshot.accounts.filter(eligible)){
        if(stopped)break;
        const record=manual.get(account.id);
        if(record){
          if(record.process.isRunning())await watchLoginWindow(account,record);
          else await scheduleCompletion(account,record);
          continue;
        }
        if(busy.has(account.id))continue;
        if(!await current(account.id))continue;
        await run(account,()=>refreshAccount(account)).catch(()=>{});
      }
    }finally{tickBusy=false;}
  }
  function start(){
    if(timer||stopped)return;
    const ms=Math.max(1,Math.min(120,Number(intervalMinutes)||5))*60000;
    timer=setInterval(()=>void tick().catch(()=>{}),ms);timer.unref?.();
    // Short, local watchdog for lost/missed process-exit notifications.
    // It is idle when no interactive connection is pending.
    loginTimer=setInterval(checkLoginWindows,1500);loginTimer.unref?.();
    // The account monitor starts independently. Try again shortly after startup
    // to avoid waiting an entire refresh interval for the initial inventory.
    void tick().catch(()=>{});
  }
  async function stop(){
    stopped=true;if(timer)clearInterval(timer);timer=null;
    if(loginTimer)clearInterval(loginTimer);loginTimer=null;
    const probes=[...manual.values()].map(record=>{
      record.windowAbort?.abort();return record.windowProbe;
    }).filter(Boolean);
    manual.clear();
    await Promise.allSettled(probes);
    await Promise.allSettled([...contexts].map(c=>closeContext(c)));
    await Promise.allSettled([...busy.values()]);
  }
  return {action,tick,start,stop};
}
const COMMAND_ERRORS=new Set(['service_unavailable','inventory_unavailable','account_unavailable','invalid_action','action_failed']);
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
  function submit({id,action,ticket}={}) {
    if(stopped)return 'service_unavailable';
    if(typeof id!=='string'||!id||id.length>120||
      typeof ticket!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(ticket)||
      !ACTIONS.includes(action))return 'invalid_action';
    const running=active.get(id);
    if(running)return running.ticket===ticket?'queued':'busy';
    if(active.size>=80)return 'busy';
    if(results.get(id)?.ticket===ticket)return 'queued';
    const entry={ticket};
    active.set(id,entry);
    record(id,ticket,'pending');
    // Do not keep the host IPC invocation open during browser startup, network
    // navigation or a credential refresh. The main service owns this task.
    entry.task=Promise.resolve().then(()=>stopped?null:service.action(id,action)).then(result=>{
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
module.exports={billingPage,historyBillingPages,sessionBillingPages,discoverBillingPage,eligible,readBillingAmount,browserEnvironment,BROWSERS,browserFromProgId,browserExecutable,browserVariant,defaultWindowsBrowser,findBrowser,selectBillingBrowser,playwrightBrowserChannel,startLoginBrowser,inspectBillingWindow,createBillingSessions,createBillingCommands,STATES};
