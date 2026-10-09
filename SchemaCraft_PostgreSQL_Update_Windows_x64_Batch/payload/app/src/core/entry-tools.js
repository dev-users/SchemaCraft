/* Data Entry utilities. Calculations stay in this tab; calendar reads saved alerts.
 * Deliberately independent of entry drafts, schema IDs and shared alert filters. */
window.SCEntryTools = (() => {
  'use strict';
  const $=id=>document.getElementById(id), t=s=>scText(s), M=window.SCEntryMath;
  const MONTHS={gregorian:['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],persian:['فروردين','أرديبهشت','خرداد','تير','مرداد','شهريور','مهر','آبان','آذر','دي','بهمن','اسفند']};
  const WEEK=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
  let model=null,requestId=0,convertId=0,converted=null,answer=0,calcValue=null,averageValue=null,calendarTimer=null;
  const stateKey='schemacraft-entry-calendar-system-v1';
  function node(tag,text='',cls=''){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
  function user(tag,text,cls=''){const el=node(tag,text,cls);el.dataset.i18nSkip='true';el.setAttribute('translate','no');return el;}
  function error(id,message=''){$(id).textContent=t(message);$(id).hidden=!message;}
  function opened(id){return Boolean($(id)?.open);}
  function allowed(){return !window.SchemaCraftUITextEditor?.active;}
  function show(id){if(!allowed())return false;if(!opened(id))$(id).showModal();return true;}
  function number(n){return new Intl.NumberFormat(window.SchemaCraftI18n?.language==='fa'?'fa-IR':'ar',{useGrouping:false}).format(n);}
  function caption(system,year,month){return `${t(MONTHS[system][month-1])} ${number(year)}`;}
  function longDate(iso,system){const [y,m,d]=iso.split('-').map(Number);return `${number(d)} ${caption(system,y,m)}`;}
  async function get(path){const r=await fetch(path);const result=await r.json();if(!r.ok)throw Error(result.error||t('تعذّر تحميل بيانات الأداة.'));return result;}
  async function copy(value,dialog){
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(String(value));
      else {const input=node('textarea');input.value=String(value);input.className='entry-tool-copy-buffer';$(dialog).append(input);input.select();try{if(!document.execCommand('copy'))throw Error();}finally{input.remove();}}
      showToast(t('نُسخت النتيجة.'));
    }catch(_){showToast(t('تعذّر النسخ؛ حدّد النتيجة وانسخها يدويًا.'),'error');}
  }
  function button(label,fn,icon){const b=node('button',icon?'':t(label),'button button-secondary'+(icon?' workflow-icon-only':''));b.type='button';b.title=t(label);b.setAttribute('aria-label',t(label));if(icon){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','action-icon');svg.setAttribute('aria-hidden','true');const u=document.createElementNS(svg.namespaceURI,'use');u.setAttribute('href','#icon-'+icon);svg.append(u);b.append(svg);}b.onclick=fn;return b;}
  function currentQuery(extra={}) {return {system:$('entry-calendar-system').value,...(model?{year:model.year,month:model.month,day:model.selected_day||''}:{}),...extra};}
  async function loadCalendar(options={},append=false){
    if(!opened('entry-calendar-dialog')||!allowed())return;
    const token=++requestId,query=new URLSearchParams();for(const [key,value] of Object.entries(options))if(value!==null&&value!==undefined&&value!=='')query.set(key,String(value));
    $('entry-calendar-layout').setAttribute('aria-busy','true');$('entry-calendar-refresh').disabled=true;$('entry-calendar-more').disabled=true;error('entry-calendar-error');
    try{
      const result=await get('/api/tools/calendar?'+query);
      if(token!==requestId||!opened('entry-calendar-dialog'))return;
      if(append&&model)result.items=[...model.items,...result.items];
      model=result;renderCalendar();
    }catch(e){if(token===requestId)error('entry-calendar-error',e.message);}
    finally{if(token===requestId){$('entry-calendar-layout').setAttribute('aria-busy','false');$('entry-calendar-refresh').disabled=false;$('entry-calendar-more').disabled=false;}}
  }
  function renderCalendar(){
    const r=model;if(!r)return;
    $('entry-calendar-month').textContent=caption(r.system,r.year,r.month);
    $('entry-calendar-current').textContent=`${t('تاريخ اليوم')}: ${longDate(r.today,'gregorian')} · ${longDate(r.today_persian,'persian')}`;
    $('entry-calendar-prev').disabled=!r.previous;$('entry-calendar-next').disabled=!r.next;
    const grid=$('entry-calendar-grid');grid.replaceChildren();
    for(let i=0;i<r.leading_days;i++){const blank=node('span','','entry-calendar-blank');blank.setAttribute('aria-hidden','true');grid.append(blank);}
    for(const day of r.days){
      const count=r.counts[day.date]||0,b=button('',()=>void loadCalendar(currentQuery({day:r.selected_day===day.date?'':day.date,offset:0})));
      b.className='entry-calendar-day'+(day.today?' is-today':'')+(r.selected_day===day.date?' is-selected':'');b.dataset.date=day.date;b.dataset.count=count;b.dataset.i18nSkip='true';b.setAttribute('aria-pressed',String(r.selected_day===day.date));if(day.today)b.setAttribute('aria-current','date');
      b.title=`${day.date} · ${day.persian}`;b.setAttribute('aria-label',`${longDate(r.system==='gregorian'?day.date:day.persian,r.system)}${day.today?' · '+t('تاريخ اليوم'):''} · ${t('التنبيهات')}: ${number(count)}`);
      b.append(user('span',number(day.day),'entry-calendar-day-number'));
      if(count){const badge=user('span',number(count),'entry-calendar-day-badge');badge.setAttribute('aria-hidden','true');b.append(badge);}grid.append(b);
    }
    $('entry-calendar-agenda-title').textContent=t(r.selected_day?'تنبيهات اليوم المحدد':'تنبيهات الشهر');$('entry-calendar-all').disabled=!r.selected_day;
    $('entry-calendar-count').textContent=`${number(r.items.length)} / ${number(r.total)} · ${t('تنبيهات الشهر')}: ${number(r.month_total)}`;
    const warning=r.skipped_values||r.unavailable_schemas.length; $('entry-calendar-warning').hidden=!warning;
    $('entry-calendar-warning').textContent=warning?t('بعض بيانات التنبيهات غير متاحة؛ قد تكون القائمة غير مكتملة.'):'';
    const host=$('entry-calendar-alerts');host.replaceChildren();
    if(!r.items.length)host.append(node('p',t('لا توجد تنبيهات نشطة ذات تاريخ استحقاق في هذه الفترة.'),'entry-calendar-empty'));
    for(const item of r.items){
      const g=item.rule,card=node('article','','entry-calendar-alert');card.dataset.i18nSkip='true';
      card.dataset.notice=SCAlerts.noticeKind(g);
      if(/^#[0-9a-fA-F]{6}$/.test(g.color))card.style.setProperty('--calendar-alert-color',g.color);
      const body=node('div','','entry-calendar-alert-copy');body.append(user('strong',g.name),user('time',item.display_date,'entry-calendar-due'));
      body.append(user('span',[item.record_title,item.record_code].filter(Boolean).join(' · ')),user('small',[g.schema_name,g.field_name||g.category_name,item.card_name].filter(Boolean).join(' · '),'muted-text'));
      if(g.message)body.append(user('p',g.message));
      const open=button('فتح السجل',async()=>{
        if(hasUnsavedWorkspaceChanges()){showToast(t('احفظ التغييرات أو تجاهلها قبل فتح سجل التنبيه.'),'error');return;}
        $('entry-calendar-dialog').close();try{await SCAlerts.openRecord(g,item);}catch(e){showToast(e.message,'error');}
      },'open-record');card.append(body,open);host.append(card);
    }
    $('entry-calendar-more').hidden=!r.has_more;
  }
  function openCalendar(){
    if(!show('entry-calendar-dialog'))return;
    model=null;error('entry-calendar-error');$('entry-calendar-grid').replaceChildren();$('entry-calendar-alerts').replaceChildren(node('p',t('جارٍ تحميل التقويم…')));
    void loadCalendar({system:$('entry-calendar-system').value});
    clearInterval(calendarTimer);calendarTimer=setInterval(()=>{if(!document.hidden&&allowed())void loadCalendar(currentQuery({offset:0}));},60000);
  }
  function fillConverter(data,system){const list=system==='persian'?data.persian_parts:data.gregorian_parts;for(const [i,k] of ['year','month','day'].entries())$('entry-converter-'+k).value=String(list[i]);}
  function invalidateConversion(){++convertId;converted=null;$('entry-converter-result').hidden=true;error('entry-converter-error');}
  function openConverter(){
    if(!model||!show('entry-converter-dialog'))return;invalidateConversion();const day=model.days.find(d=>d.date===(model.selected_day||model.today))||model.days[0];
    const system=$('entry-calendar-system').value;$('entry-converter-system').value=system;
    fillConverter({persian_parts:day.persian.split('-').map(Number),gregorian_parts:day.date.split('-').map(Number)},system);
    $('entry-converter-year').focus();
  }
  async function convert(){
    const token=++convertId;error('entry-converter-error');converted=null;$('entry-converter-result').hidden=true;$('entry-converter-run').disabled=true;
    const system=$('entry-converter-system').value;
    try{
      const query=new URLSearchParams({system});for(const key of ['year','month','day'])query.set(key,$('entry-converter-'+key).value);
      const r=await get('/api/tools/convert-date?'+query);if(token!==convertId||!opened('entry-converter-dialog'))return;
      converted=r;const target=system==='gregorian'?'persian':'gregorian';$('entry-converter-output').textContent=r[target];$('entry-converter-result-label').textContent=t(target==='persian'?'شمسي فارسي':'ميلادي');$('entry-converter-output-long').textContent=longDate(r[target],target);$('entry-converter-result').hidden=false;
    }catch(e){if(token===convertId)error('entry-converter-error',e.message);}finally{$('entry-converter-run').disabled=false;}
  }
  function invalidateCalc(){calcValue=null;$('entry-calc-result').textContent='—';$('entry-calc-copy').disabled=true;error('entry-calc-error');}
  function evaluate(){try{calcValue=M.calculate($('entry-calc-expression').value,answer);answer=calcValue;$('entry-calc-result').textContent=M.format(calcValue);$('entry-calc-copy').disabled=false;error('entry-calc-error');}catch(e){invalidateCalc();error('entry-calc-error',e.message);}}
  function insertCalc(value){
    const input=$('entry-calc-expression');
    if(calcValue!==null){input.value=/^[+*/^%\-]$/.test(value)?`(${M.format(calcValue)})`:'';input.setSelectionRange(input.value.length,input.value.length);}
    const begin=input.selectionStart??input.value.length,end=input.selectionEnd??begin;input.setRangeText(value,begin,end,'end');invalidateCalc();input.focus();
  }
  function calcKeys(){
    const keys=[['C','clear','مسح العملية'],['⌫','back','حذف آخر محرف'],['(', '('],[')',')'],['÷','/'],['7','7'],['8','8'],['9','9'],['√','sqrt(','الجذر التربيعي'],['×','*'],['4','4'],['5','5'],['6','6'],['xʸ','^','القوة'],['−','-'],['1','1'],['2','2'],['3','3'],['%','%','النسبة المئوية'],['+','+'],['±','sign','تغيير الإشارة'],['0','0'],['.','.'],['Ans','ans','النتيجة السابقة'],['=','equals','حساب']];
    const host=$('entry-calculator-keys');
    for(const [display,key,label] of keys){const b=button(label||display,()=>{
      const input=$('entry-calc-expression');
      if(key==='clear'){input.value='';invalidateCalc();input.focus();}
      else if(key==='equals')evaluate();
      else if(key==='back'){const end=input.selectionEnd??input.value.length,start=input.selectionStart??end;input.setRangeText('',start===end?Math.max(0,start-1):start,end,'end');invalidateCalc();input.focus();}
      else if(key==='sign'){const old=input.value.trim();input.value=old?`-(${old})`:'-';invalidateCalc();input.focus();}
      else insertCalc(key);
    });b.textContent=display;b.dataset.i18nSkip='true';b.dataset.calcKey=key;
    b.className='button '+(key==='equals'?'button-primary':key==='clear'?'button-danger-quiet':'button-secondary');host.append(b);}
  }
  function invalidateAverage(){
    averageValue=null;$('entry-average-results').hidden=true;$('entry-average-copy').disabled=true;error('entry-average-error');
    $('entry-average-dialog').querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  }
  function renumberGradeRows(){
    const rows=[...$('entry-average-rows').children];
    rows.forEach((row,index)=>{
      row.querySelector('th').textContent=number(index+1);
      for(const [key,label] of [['score','الدرجة المحصلة'],['maximum','الحد الأعلى']])row.querySelector('[data-grade="'+key+'"]').setAttribute('aria-label',t(label)+' '+number(index+1));
      row.querySelector('button').setAttribute('aria-label',t('إزالة الدرجة')+' '+number(index+1));
    });
    $('entry-average-add').disabled=rows.length>=1000;
  }
  function addGradeRow(focus=true){
    if($('entry-average-rows').children.length>=1000)return;
    const row=node('tr');const index=node('th');index.scope='row';row.append(index);
    for(const key of ['score','maximum']){
      const cell=node('td'),input=document.createElement('input');
      input.className='control';input.type='text';input.inputMode='decimal';input.dir='ltr';input.maxLength=64;input.autocomplete='off';input.dataset.grade=key;
      input.addEventListener('input',invalidateAverage);cell.append(input);row.append(cell);
    }
    const actions=node('td'),remove=document.createElement('button');remove.type='button';remove.className='button button-danger-quiet workflow-icon-only';remove.title=t('إزالة الدرجة');
    remove.innerHTML='<svg class="action-icon" aria-hidden="true"><use href="#icon-trash"></use></svg>';
    remove.onclick=()=>{const next=row.nextElementSibling||row.previousElementSibling;row.remove();if(!$('entry-average-rows').children.length)addGradeRow(false);renumberGradeRows();invalidateAverage();(next||$('entry-average-rows').firstElementChild).querySelector('input').focus();};
    actions.append(remove);row.append(actions);$('entry-average-rows').append(row);renumberGradeRows();invalidateAverage();if(focus)row.querySelector('input').focus();
  }
  function computeAverage(){
    invalidateAverage();
    try{
      const rows=[...$('entry-average-rows').children].map(row=>({score:row.querySelector('[data-grade="score"]').value,maximum:row.querySelector('[data-grade="maximum"]').value}));
      const r=M.gradeAverage(rows,$('entry-average-target').value);averageValue=r;
      $('entry-average-mean').textContent=M.format(r.mean)+' / '+M.format(r.outOf);
      $('entry-average-equation').textContent='('+M.format(r.earned)+' ÷ '+M.format(r.possible)+') × '+M.format(r.outOf)+' = '+M.format(r.mean);
      for(const key of ['count','earned','possible'])$('entry-average-'+key).textContent=M.format(r[key]);
      $('entry-average-percent').textContent=M.format(r.percentage)+'%';$('entry-average-results').hidden=false;$('entry-average-copy').disabled=false;
    }catch(e){
      const row=Number.isInteger(e.gradeRow)?$('entry-average-rows').children[e.gradeRow]:null;
      const message=(row?t('الصف')+' '+number(e.gradeRow+1)+' — ':'')+t(e.message);
      $('entry-average-error').textContent=message;$('entry-average-error').hidden=false;
      const control=e.gradeField==='target'?$('entry-average-target'):row?.querySelector('[data-grade="'+(e.gradeField||'score')+'"]');
      if(control){control.setAttribute('aria-invalid','true');control.focus();}
    }
  }
  function init(){
    const panel=$('entry-tools-panel');if(!panel)return;
    // Existing startup code moves the search card; tools must stay last.
    $('entry-action-rail').append(panel);
    const heading=$('entry-tools-heading');const toggle=()=>{const hidden=!$('entry-tools-buttons').hidden;$('entry-tools-buttons').hidden=hidden;heading.setAttribute('aria-expanded',String(!hidden));};
    heading.onclick=toggle;heading.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}};
    try{const value=localStorage.getItem(stateKey);if(['gregorian','persian'].includes(value))$('entry-calendar-system').value=value;}catch(_){}
    $('entry-open-calendar').onclick=openCalendar;
    $('entry-open-calculator').onclick=()=>{if(show('entry-calculator-dialog'))$('entry-calc-expression').focus();};
    $('entry-open-average').onclick=()=>{if(show('entry-average-dialog'))$('entry-average-rows').querySelector('input').focus();};
    for(const b of document.querySelectorAll('[data-tool-close]'))b.onclick=()=>$(b.dataset.toolClose).close();
    $('entry-calendar-dialog').addEventListener('close',()=>{clearInterval(calendarTimer);++requestId;});
    $('entry-converter-dialog').addEventListener('close',()=>++convertId);
    $('entry-calendar-system').onchange=()=>{
      const system=$('entry-calendar-system').value;try{localStorage.setItem(stateKey,system);}catch(_){}
      const day=model?.days.find(d=>d.date===(model.selected_day||model.today))||model?.days[0];
      const vals=day?(system==='persian'?day.persian:day.date).split('-').map(Number):[];
      void loadCalendar({system,...(day?{year:vals[0],month:vals[1]}:{})});
    };
    for(const [id,key] of [['prev','previous'],['next','next']])$('entry-calendar-'+id).onclick=()=>{if(model?.[key])void loadCalendar({system:model.system,...model[key]});};
    $('entry-calendar-refresh').onclick=()=>void loadCalendar(currentQuery({offset:0}));
    $('entry-calendar-today').onclick=()=>void loadCalendar({system:$('entry-calendar-system').value});
    $('entry-calendar-all').onclick=()=>void loadCalendar(currentQuery({day:'',offset:0}));
    $('entry-calendar-more').onclick=()=>void loadCalendar(currentQuery({offset:model?.items.length||0}),true);
    for(const text of WEEK)$('entry-calendar-weekdays').append(node('span',t(text)));
    $('entry-calendar-grid').addEventListener('keydown',e=>{
      if(!e.target.matches('.entry-calendar-day'))return;const cells=[...$('entry-calendar-grid').querySelectorAll('button')],index=cells.indexOf(e.target);
      const moves={ArrowLeft:1,ArrowRight:-1,ArrowDown:7,ArrowUp:-7,Home:-index,End:cells.length-1-index};if(e.key in moves){e.preventDefault();e.stopPropagation();cells[Math.max(0,Math.min(cells.length-1,index+moves[e.key]))].focus();}
    });
    $('entry-open-converter').onclick=openConverter;$('entry-converter-run').onclick=()=>void convert();
    $('entry-converter-system').onchange=invalidateConversion;
    for(const key of ['year','month','day'])$('entry-converter-'+key).oninput=invalidateConversion;
    $('entry-converter-swap').onclick=()=>{const target=$('entry-converter-system').value==='gregorian'?'persian':'gregorian';if(converted)fillConverter(converted,target);$('entry-converter-system').value=target;invalidateConversion();};
    $('entry-converter-copy').onclick=()=>{if(converted)void copy($('entry-converter-output').textContent,'entry-converter-dialog');};
    $('entry-converter-dialog').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input')){e.preventDefault();e.stopPropagation();void convert();}});
    calcKeys();$('entry-calc-expression').oninput=invalidateCalc;
    $('entry-calc-expression').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='='){e.preventDefault();e.stopPropagation();evaluate();}});
    $('entry-calc-copy').onclick=()=>{if(calcValue!==null)void copy(M.format(calcValue),'entry-calculator-dialog');};
    addGradeRow(false);addGradeRow(false);
    $('entry-average-add').onclick=()=>addGradeRow();$('entry-average-target').oninput=invalidateAverage;$('entry-average-run').onclick=computeAverage;
    $('entry-average-clear').onclick=()=>{$('entry-average-rows').replaceChildren();addGradeRow(false);addGradeRow(false);invalidateAverage();$('entry-average-rows').querySelector('input').focus();};
    $('entry-average-copy').onclick=()=>{if(averageValue!==null)void copy(M.format(averageValue.mean)+' / '+M.format(averageValue.outOf),'entry-average-dialog');};
    $('entry-average-dialog').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&e.target.matches('input')){e.preventDefault();e.stopPropagation();computeAverage();}});
    window.addEventListener('focus',()=>{if(opened('entry-calendar-dialog')&&allowed())void loadCalendar(currentQuery({offset:0}));});
    document.addEventListener('schemacraft-data-changed',()=>{if(opened('entry-calendar-dialog')&&allowed())void loadCalendar(currentQuery({offset:0}));});
  }
  init();
  return {openCalendar,renderCalendar,openConverter};
})();
