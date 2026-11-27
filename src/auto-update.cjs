/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Main-process only. Never pass release payloads or local paths to the GUI.
const REPO='ItanBlackwell/usage-dashboard';
const API='https://api.github.com/repos/'+REPO+'/releases/latest';
const DOWNLOAD='https://github.com/'+REPO+'/releases/download/';
const DAY=86400000;
const MODES=['notify','auto','manual'];
const FILES=['package.json','dist/gui-experimental.cjs'];
const MAX_ARCHIVE=20*1024*1024;
function version(value){
  if(typeof value!=='string'||! /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value))return null;
  return value.split('.').map(Number);
}
function newer(a,b){
  const x=version(a),y=version(b);
  if(!x||!y)return false;
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];
  return false;
}
function selectRelease(raw,current){
  if(!raw||raw.draft!==false||raw.prerelease!==false||typeof raw.tag_name!=='string'||!raw.tag_name.startsWith('v'))return null;
  const next=raw.tag_name.slice(1);
  if(!newer(next,current))return null;
  const name='Usage-Dashboard-Portable-'+next+'.zip';
  const prefix=DOWNLOAD+'v'+next+'/';
  const assets=Array.isArray(raw.assets)?raw.assets:[];
  const find=n=>assets.filter(a=>a?.name===n&&a.state==='uploaded'&&a.browser_download_url===prefix+n);
  const zip=find(name),sum=find('SHA256SUMS.txt');
  if(zip.length!==1||sum.length!==1||!Number.isSafeInteger(zip[0].size)||zip[0].size<1||zip[0].size>MAX_ARCHIVE)throw Error('missing_release_assets');
  return {version:next,name,zip:prefix+name,checksum:prefix+'SHA256SUMS.txt',size:zip[0].size,digest:typeof zip[0].digest==='string'?zip[0].digest:null};
}
function checksumFor(text,name){
  const matches=text.split(/\r?\n/).map(line=>/^([a-f0-9]{64}) [ *]([A-Za-z0-9._-]+)$/i.exec(line)).filter(m=>m&&m[2]===name);
  if(matches.length!==1)throw Error('invalid_checksum');
  return matches[0][1].toLowerCase();
}
function allowedUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
  if(u.hostname==='api.github.com')return u.href===API;
  if(u.hostname==='github.com')return u.href.startsWith(DOWNLOAD);
  return ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname);
}
async function download(url,limit,fetcher=globalThis.fetch){
  const signal=AbortSignal.timeout(60000);
  for(let hops=0;hops<5;hops++){
    if(!allowedUrl(url))throw Error('invalid_download_origin');
    const response=await fetcher(url,{signal,redirect:'manual',credentials:'omit',headers:{'User-Agent':'Usage-Dashboard-Updater','Accept':'application/octet-stream, application/vnd.github+json'}});
    if([301,302,303,307,308].includes(response.status)){
      const target=response.headers.get('location');await response.body?.cancel();
      if(!target)throw Error('invalid_redirect');
      url=new URL(target,url).href;continue;
    }
    if(!response.ok||!response.body){await response.body?.cancel();throw Error('download_failed');}
    if(Number(response.headers.get('content-length'))>limit){await response.body.cancel();throw Error('download_too_large');}
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{
      while(true){
        const {done,value}=await reader.read();if(done)break;
        length+=value.byteLength;if(length>limit)throw Error('download_too_large');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks,length);
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  throw Error('too_many_redirects');
}
// Read only the two expected ZIP entries. Never extract arbitrary paths or
// execute downloaded installers. ZIP64, multi-disk and encrypted ZIPs fail closed.
function readPortable(zip,expectedVersion){
  const zlib=require('node:zlib');
  if(!Buffer.isBuffer(zip)||zip.length<22||zip.length>MAX_ARCHIVE)throw Error('invalid_archive');
  const end=zip.length-22;
  if(zip.readUInt32LE(end)!==0x06054b50||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)||zip.readUInt16LE(end+20))throw Error('invalid_archive');
  const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),start=zip.readUInt32LE(end+16);
  if(count!==zip.readUInt16LE(end+8)||count>256||start+size!==end)throw Error('invalid_archive');
  const result={};let pos=start;
  for(let i=0;i<count;i++){
    if(pos+46>end||zip.readUInt32LE(pos)!==0x02014b50)throw Error('invalid_archive');
    const flags=zip.readUInt16LE(pos+8),method=zip.readUInt16LE(pos+10),compressed=zip.readUInt32LE(pos+20),plain=zip.readUInt32LE(pos+24);
    const nameLen=zip.readUInt16LE(pos+28),extraLen=zip.readUInt16LE(pos+30),commentLen=zip.readUInt16LE(pos+32),offset=zip.readUInt32LE(pos+42);
    const next=pos+46+nameLen+extraLen+commentLen;
    if(next>end||zip.readUInt16LE(pos+34)!==0)throw Error('invalid_archive');
    const name=zip.subarray(pos+46,pos+46+nameLen).toString('utf8');
    pos=next;
    const relative=FILES.find(f=>name==='Usage-Dashboard/'+f);
    if(!relative)continue;
    const max=relative==='package.json'?65536:5*1024*1024;
    if(Object.hasOwn(result,relative)||flags&1||![0,8].includes(method)||plain<1||plain>max||offset+30>start||zip.readUInt32LE(offset)!==0x04034b50)throw Error('invalid_archive');
    const localName=zip.readUInt16LE(offset+26),localExtra=zip.readUInt16LE(offset+28),data=offset+30+localName+localExtra;
    if(data+compressed>start||zip.readUInt16LE(offset+8)!==method||zip.readUInt16LE(offset+6)!==flags||zip.subarray(offset+30,offset+30+localName).toString('utf8')!==name)throw Error('invalid_archive');
    const input=zip.subarray(data,data+compressed);
    const output=method===0?Buffer.from(input):zlib.inflateRawSync(input,{maxOutputLength:max});
    if(output.length!==plain)throw Error('invalid_archive');
    result[relative]=output;
  }
  if(pos!==end||FILES.some(f=>!result[f]))throw Error('incomplete_archive');
  const manifest=JSON.parse(result['package.json'].toString('utf8'));
  if(manifest.name!=='usage-dashboard'||manifest.version!==expectedVersion||manifest.exports?.['./gui-experimental']!=='./dist/gui-experimental.cjs')throw Error('invalid_package');
  const bundle=result['dist/gui-experimental.cjs'].toString('utf8');
  if(!bundle.startsWith('/*\n * Usage Dashboard - generated GUI module\n')||!bundle.slice(0,1024).includes(' * Version: '+expectedVersion+'\n'))throw Error('invalid_bundle');
  return result;
}
function safePath(fs,path,target){
  let cursor=path.resolve(target);
  while(true){
    try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('redirected_path');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
  }
}
function atomicWrite(fs,path,target,data){
  safePath(fs,path,target);
  const temporary=target+'.update-'+require('node:crypto').randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,data,{flag:'wx',mode:0o600});fs.renameSync(temporary,target);}
  finally{try{fs.unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function installFiles(folder,current,next,files){
  const fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
  const root=path.dirname(path.dirname(folder));
  const queue=path.join(root,'.usage-dashboard-pending');
  const manifest=path.join(folder,'package.json');
  safePath(fs,path,manifest);
  const installed=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(installed.name!=='usage-dashboard'||installed.version!==current||!newer(next,current))throw Error('installed_version_changed');
  const helper=path.join(folder,'installer','Deferred.ps1');
  const common=path.join(folder,'installer','Common.ps1');
  for(const file of [helper,common]){safePath(fs,path,file);if(!fs.lstatSync(file).isFile())throw Error('manual_reinstall_required');}
  safePath(fs,path,queue);fs.mkdirSync(queue);
  try{
    for(const [src,name] of [[helper,'Deferred.ps1'],[common,'Common.ps1']])fs.copyFileSync(src,path.join(queue,name),fs.constants.COPYFILE_EXCL);
    for(const relative of FILES){
      const target=path.join(queue,'payload',relative);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,files[relative],{flag:'wx',mode:0o600});
    }
    fs.writeFileSync(path.join(queue,'operation.json'),JSON.stringify({action:'update',current,next}),{flag:'wx',mode:0o600});
    const system=process.env.SystemRoot;
    if(!system||!path.isAbsolute(system))throw Error('missing_windows_root');
    const worker=child.spawn(path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(queue,'Deferred.ps1')],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,OPENCODE_CONFIG_DIR:root}});
    worker.on('error',()=>{});worker.unref();
  }catch(error){throw error;}
}
function createUpdater({folder,current,fetcher=globalThis.fetch,platform=process.platform}){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const settings=folder&&path.join(folder,'settings.json');
  let mode='notify',state='idle',release=null,checkedAt=0,installedVersion=null,busy=null,timer=null,stopped=false;
  let supported=platform==='win32'&&!!folder&&!!version(current);
  function readSettings(){
    safePath(fs,path,settings);
    const value=JSON.parse(fs.readFileSync(settings,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_settings');
    return value;
  }
  if(supported)try{
    const options=readSettings();
    if(MODES.includes(options.updateMode))mode=options.updateMode;
    const manifest=path.join(folder,'package.json');safePath(fs,path,manifest);
    const installed=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(installed.name!=='usage-dashboard'||installed.version!==current||fs.existsSync(path.join(folder,'.update-lock'))||!fs.existsSync(path.join(folder,'installer','Deferred.ps1'))||!fs.existsSync(path.join(folder,'installer','Common.ps1')))supported=false;
  }catch{supported=false;}
  if(!supported)state='unavailable';
  const status=()=>({mode,state,version:installedVersion||release?.version||null,checkedAt});
  function run(task){
    if(!supported||stopped||busy||state==='restart')return busy||Promise.resolve(status());
    busy=Promise.resolve().then(task).catch(()=>{state='error';}).finally(()=>{busy=null;});
    return busy.then(status);
  }
  async function install(){
    if(!release||stopped)return;
    const selected=release;state='installing';
    const checksums=await download(selected.checksum,65536,fetcher);
    const hash=checksumFor(checksums.toString('utf8'),selected.name);
    if(selected.digest&&selected.digest!=='sha256:'+hash)throw Error('digest_mismatch');
    const archive=await download(selected.zip,MAX_ARCHIVE,fetcher);
    if(archive.length!==selected.size||crypto.createHash('sha256').update(archive).digest('hex')!==hash)throw Error('checksum_mismatch');
    const files=readPortable(archive,selected.version);
    if(stopped)return;
    installFiles(folder,current,selected.version,files);
    installedVersion=selected.version;state='restart';
  }
  function check(force=false){
    if(!force&&(mode==='manual'||Date.now()-checkedAt<DAY))return Promise.resolve(status());
    return run(async()=>{
      state='checking';release=null;
      try{
        const payload=await download(API,1024*1024,fetcher);
        release=selectRelease(JSON.parse(payload.toString('utf8')),current);
        state=release?'available':'current';
        if(release&&mode==='auto')await install();
      }finally{checkedAt=Date.now();}
    });
  }
  function setMode(value){
    if(!supported||stopped||!MODES.includes(value)||busy||state==='restart')return Promise.resolve(status());
    try{
      const options=readSettings();
      atomicWrite(fs,path,settings,JSON.stringify({...options,updateMode:value},null,2)+'\n');
      mode=value;
    }catch{state='error';return Promise.resolve(status());}
    if(mode==='auto'&&release)return run(install);
    if(mode!=='manual'&&!checkedAt)return check();
    return Promise.resolve(status());
  }
  return {status,check:()=>check(true),install:()=>run(install),setMode,
    start(){if(!supported||stopped||timer)return;void check();timer=setInterval(()=>void check(),DAY);timer.unref?.();},
    stop(){stopped=true;clearInterval(timer);timer=null;}};
}
module.exports={version,newer,selectRelease,checksumFor,allowedUrl,download,readPortable,installFiles,createUpdater};
