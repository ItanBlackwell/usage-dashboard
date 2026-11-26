/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Renderer-only SVG chart. No requests, account activation, storage or libraries.
const DAY=86400000,NS='http://www.w3.org/2000/svg';
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function daysFor(now){
  const d=new Date(now),today=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  return Array.from({length:7},(_,i)=>today-(6-i)*DAY);
}
function seriesFor(snapshot,target,now){
  const days=daysFor(now);
  const check=(row,day)=>row&&row.from===day&&Number.isSafeInteger(row.to)&&row.to>day&&row.to<day+DAY&&row.to<=now;
  if(target.kind==='quota'){
    const row=snapshot?.codexUsage?.find(a=>a.id===target.id);
    const series=['fiveHour','weekly'].map(key=>{
      const w=row?.[key];
      return {key,values:days.map(day=>{
        const v=[...(w?.daily||[]),w?.today].filter(d=>check(d,day)).sort((a,b)=>b.to-a.to)[0];
        return valid(v?.amount)?v.amount:null;
      })};
    });
    // A missing quota is not a zero-valued series. Preserve recent history
    // when a window disappears or a provider read temporarily fails.
    const account=snapshot?.accounts?.find(a=>a.id===target.id);
    const labels={fiveHour:'5-hour',weekly:'Weekly'};
    const supported=series.filter(s=>(account?.windows||[]).some(w=>w.label===labels[s.key])
      ||s.values.some(valid));
    const observed=series.filter(s=>row?.[s.key]?.baseline);
    return {days,series:supported.length?supported:observed.length?observed:series};
  }
  const history=snapshot?.localWeek;
  const past=Number.isSafeInteger(history?.checkedAt)&&history.checkedAt<=now?history.days||[]:[];
  return {days,series:[{key:'cost',values:days.map((day,i)=>{
    const v=i===6?snapshot?.localUsage?.today:past.find(d=>d.from===day);
    if(!check(v,day)||(i<6&&v.to!==day+DAY-1))return null;
    const row=v.rows?.find(r=>r.provider===target.id);
    return valid(row?.cost)?row.cost:null;
  })}]};
}
function axisStep(series,quota){
  const maximum=Math.max(0,...series.flatMap(s=>s.values.filter(valid)));
  if(!maximum)return quota?10:0.25;
  const raw=Math.max(maximum/3,quota?0.01:1e-8);
  const power=10**Math.floor(Math.log10(raw));
  return ([1,2,2.5,5,10].find(n=>n*power>=raw)||10)*power;
}
function summarize(values){
  const known=values.filter(valid);
  return {amount:known.length?known.reduce((sum,v)=>sum+v,0):null,count:known.length};
}
function targetsFor(accounts,providers,providerLabel,tr){
  return [
    ...accounts.map(a=>({key:'quota:'+a.id,id:a.id,kind:'quota',label:providerLabel(a.provider)+' · '+a.label,active:a.active})),
    ...providers.map(id=>({key:'local:'+id,id,kind:'local',label:providerLabel(id)+' · '+tr('local estimate','локальная оценка')}))
  ];
}
function render(parent,snapshot,accounts,providers,{document:doc,palette,tr,providerLabel,formatSpend,locale,now,state}){
  const targets=targetsFor(accounts,providers,providerLabel,tr);
  if(!targets.length)return;
  const node=(tag,style='',text='')=>{
    const el=doc.createElement(tag);el.style.cssText=style;el.textContent=text;return el;
  };
  const add=(p,n)=>(p.appendChild(n),n);
  const svgNode=(tag,attrs,parent,text='')=>{
    const el=doc.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));
    if(text)el.textContent=text;
    return add(parent,el);
  };
  const muted='font-size:10px;line-height:1.35;color:'+palette.muted;
  const box=add(parent,node('section','min-width:0;margin:3px 0 7px;padding:7px;border:1px solid '+palette.border+';border-radius:7px;background:rgba(125,135,155,.045)'));
  box.setAttribute('data-pv-weekly-chart','true');
  const titleRow=add(box,node('div','display:flex;justify-content:space-between;align-items:baseline;gap:6px'));
  add(titleRow,node('strong','font-size:11px;color:'+palette.text,tr('Usage over 7 days','Расход за 7 дней')));
  const dateFmt=new Intl.DateTimeFormat(locale,{day:'2-digit',month:'2-digit',timeZone:'UTC'});
  const fullFmt=new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',timeZone:'UTC'});
  const weekFmt=new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'});
  const fmt=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
  const tickFmt=new Intl.NumberFormat(locale,{maximumSignificantDigits:3,notation:'compact'});
  const dates=daysFor(now);
  add(titleRow,node('span',muted,dateFmt.format(dates[0])+' – '+dateFmt.format(dates[6])+' · UTC'));
  const select=add(box,node('select','display:block;width:100%;min-width:0;box-sizing:border-box;margin-top:6px;padding:4px 6px;font:inherit;font-size:11px;color:'+palette.text+';background:var(--v2-background-bg-layer-02,var(--background,#18191d));border:1px solid '+palette.border+';border-radius:5px;cursor:pointer'));
  select.setAttribute('aria-label',tr('Chart account or provider','Аккаунт или провайдер графика'));
  for(const target of targets){
    const option=add(select,node('option','',target.label));option.value=target.key;
  }
  const initial=targets.find(t=>t.key===state.key)||targets.find(t=>t.active)||targets[0];
  select.value=state.key=initial.key;
  const content=add(box,node('div','min-width:0;margin-top:6px'));
  function draw(){
    content.replaceChildren();
    const target=targets.find(t=>t.key===select.value)||initial;
    state.key=target.key;
    const {days,series}=seriesFor(snapshot,target,now),quota=target.kind==='quota';
    const quotaStyles={
      fiveHour:{label:tr('5 hours','5 часов'),color:palette.success},
      weekly:{label:tr('Weekly quota','Недельный лимит'),color:palette.fiveHour}
    };
    const styles=series.map(s=>quota?quotaStyles[s.key]:{label:tr('Local cost','Локальная оценка'),color:palette.fiveHour});
    const format=v=>!valid(v)?'—':quota?'≈ '+fmt.format(v)+' '+tr('pp','п.п.'):'≈ '+formatSpend(v,'USD');
    const summary=add(content,node('div','display:grid;grid-template-columns:repeat('+series.length+',minmax(0,1fr));gap:5px'));
    series.forEach((s,i)=>{
      const total=summarize(s.values),tile=add(summary,node('div','min-width:0;padding:5px 6px;border-radius:5px;background:rgba(125,135,155,.075)'));
      const legend=add(tile,node('div','display:flex;align-items:center;gap:4px;'+muted));
      add(legend,node('span','display:inline-block;flex-shrink:0;width:12px;height:2px;border-radius:2px;background:'+styles[i].color));
      add(legend,node('span','overflow:hidden;text-overflow:ellipsis;white-space:nowrap',styles[i].label));
      add(tile,node('strong','display:block;margin-top:2px;font-size:12px;font-variant-numeric:tabular-nums;color:'+styles[i].color,format(total.amount)));
      add(tile,node('div',muted,total.count===7?tr('7 days observed','7 дней наблюдений'):tr('Days with data: ','Дней с данными: ')+total.count+'/7'));
    });
    if(quota&&!series.some(s=>s.values.some(valid))){
      const account=snapshot?.accounts?.find(a=>a.id===target.id);
      const labels={fiveHour:'5-hour',weekly:'Weekly'};
      const comparable=(account?.windows||[]).some(w=>series.some(s=>labels[s.key]===w.label)
        &&Number.isSafeInteger(w.resetsAt)&&w.resetsAt>account.checkedAt);
      const note=snapshot?.inventoryWarning||account?.state!=='ok'?
        tr('Current quota observation unavailable.','Текущий замер квоты недоступен.'):
        !comparable?
          tr('Quota reset time is unknown or expired.','Время сброса квоты неизвестно или истекло.'):
          tr('Waiting for comparable quota readings. The first reading is a baseline.','Ожидание сопоставимых замеров квоты. Первый замер служит точкой отсчёта.');
      add(content,node('div',muted+';margin-top:5px',note));
    }
    const svg=svgNode('svg',{viewBox:'0 0 320 144',width:'100%',role:'group','aria-label':tr('Daily usage line chart','Линейный график расхода по дням')},content);
    svg.style.cssText='display:block;margin-top:6px;overflow:visible;font-family:inherit';
    const left=42,right=308,top=17,bottom=110,step=axisStep(series,quota),maximum=3*step;
    const x=i=>left+(right-left)*i/6,y=v=>bottom-(bottom-top)*v/maximum;
    svgNode('text',{x:0,y:9,fill:palette.muted,'font-size':9},svg,quota?tr('pp','п.п.'):'USD');
    for(let i=0;i<=3;i++){
      const n=i*step,yy=y(n),label=n>0&&n<0.001?n.toExponential(1):tickFmt.format(n);
      svgNode('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:palette.track,'stroke-width':0.6},svg);
      svgNode('text',{x:left-5,y:yy+3,'text-anchor':'end',fill:palette.muted,'font-size':9},svg,label);
    }
    const cursor=svgNode('line',{x1:right,x2:right,y1:top,y2:bottom,stroke:palette.muted,'stroke-width':0.8,'stroke-dasharray':'2 3'},svg);
    const dots=[];
    series.forEach((s,j)=>{
      const color=styles[j].color;
      // Only join adjacent known days. Never interpolate a missing observation.
      for(let i=1;i<7;i++){
        if(!valid(s.values[i-1])||!valid(s.values[i]))continue;
        svgNode('line',{x1:x(i-1),x2:x(i),y1:y(s.values[i-1]),y2:y(s.values[i]),stroke:color,'stroke-width':1.8,'stroke-linecap':'round',...(i===6?{'stroke-dasharray':'4 3'}:{})},svg);
      }
      s.values.forEach((v,i)=>{
        if(!valid(v))return;
        const dot=svgNode('circle',{cx:x(i),cy:y(v),r:2.6,fill:color,stroke:color,'stroke-width':0.6},svg);
        dots.push({dot,i});
      });
    });
    days.forEach((day,i)=>{
      const color=i===6?palette.text:palette.muted;
      svgNode('text',{x:x(i),y:124,'text-anchor':'middle',fill:color,'font-size':9},svg,weekFmt.format(day));
      svgNode('text',{x:x(i),y:137,'text-anchor':'middle',fill:color,'font-size':9},svg,dateFmt.format(day));
    });
    const detail=add(content,node('div','display:flex;justify-content:space-between;gap:8px;align-items:start;padding:6px;margin-top:2px;border-radius:5px;background:rgba(125,135,155,.075)'));
    const dayInfo=add(detail,node('div','min-width:0'));
    const dayLabel=add(dayInfo,node('strong','font-size:11px;color:'+palette.text));
    const dayNote=add(dayInfo,node('div',muted));
    const amounts=add(detail,node('div','display:flex;flex-direction:column;gap:2px;align-items:flex-end;text-align:right'));
    const amountNodes=series.map((s,i)=>add(amounts,node('div','font-size:10px;font-variant-numeric:tabular-nums;color:'+styles[i].color)));
    function selectDay(i){
      state.day=days[i];cursor.setAttribute('x1',String(x(i)));cursor.setAttribute('x2',String(x(i)));
      for(const d of dots)d.dot.setAttribute('r',d.i===i?'4':'2.6');
      dayLabel.textContent=fullFmt.format(days[i]);
      dayNote.textContent=i===6?tr('Today · incomplete','Сегодня · день не завершён'):tr('Observed daily use','Наблюдаемый расход за день');
      series.forEach((s,j)=>{amountNodes[j].textContent=styles[j].label+': '+format(s.values[i]);});
    }
    const hit=[];
    days.forEach((day,i)=>{
      const half=(right-left)/12,xx=i===0?left-8:x(i)-half,edge=i===6?right+8:x(i)+half;
      const control=svgNode('rect',{x:xx,y:top-3,width:edge-xx,height:bottom-top+7,fill:'transparent',tabindex:0,role:'button','aria-label':fullFmt.format(day)+', '+series.map((s,j)=>styles[j].label+': '+format(s.values[i])).join('; ')},svg);
      control.style.cssText='cursor:crosshair;outline-offset:-1px';
      svgNode('title',{},control,fullFmt.format(day)+' · '+series.map((s,j)=>styles[j].label+': '+format(s.values[i])).join(' · '));
      for(const event of ['pointerenter','focus','click'])control.addEventListener(event,()=>selectDay(i));
      control.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();selectDay(i);}
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
          event.preventDefault();const n=Math.max(0,Math.min(6,i+(event.key==='ArrowLeft'?-1:1)));hit[n]?.focus();
        }
      });
      hit.push(control);
    });
    const chosen=days.indexOf(state.day);
    selectDay(chosen<0?6:chosen);
    add(content,node('div',muted+';margin-top:5px',quota?
      tr('Observed account-wide quota use; may include external use. Gaps are unknown; today is dashed.','Расход квот всего аккаунта, включая внешнюю активность. Пропуски неизвестны; сегодня пунктир.'):
      tr('Local model cost across all accounts, not provider charges. Gaps are unknown; today is dashed.','Локальная стоимость моделей по всем аккаунтам, не списания. Пропуски неизвестны; сегодня пунктир.')));
  }
  select.addEventListener('change',draw);draw();
  return box;
}
module.exports={daysFor,seriesFor,axisStep,summarize,targetsFor,render};
