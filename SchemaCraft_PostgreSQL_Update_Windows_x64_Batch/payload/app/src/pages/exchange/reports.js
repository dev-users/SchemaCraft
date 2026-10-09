/* Advanced reports: all content is constructed as text or local SVG, never raw HTML. */
(() => {
  const $ = id => document.getElementById(id), panel = $('advanced-export-panel');
  if (!panel) return;
  const clone = x => JSON.parse(JSON.stringify(x));
  let templates = [], catalog = [], editing = null, definitions = {}, draft = null, dirty = false, templateDirty = false;
  let placeholderDirty=false, draftEpoch=0, draftIdentity=null, bindingTemplate='', bindingCache=new Map(), pdfUrl=null, previewTimer=null;
  const palette = ['#2875bd','#25a18e','#e9ac44','#9868c6','#db6575','#627d98'];
  const el = (tag,text='',className='') => { const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n; };
  const button = (text, fn) => { const n=el('button',text,'button button-secondary');n.type='button';n.addEventListener('click',fn);return n; };
  const option = (value,text) => {const o=el('option',text);o.value=value;return o;};
  const status = (text,error=false,target='report-status') => {$(target).textContent=text;$(target).classList.toggle('report-warning',error);};
  async function api(payload, path='/api/reports') {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'تعذّرت العملية.');return result;
  }
  function run(id,fn,target='report-status') { $(id).addEventListener('click',async()=>{const b=$(id);b.disabled=true;try{await fn();}catch(e){status(e.message,true,target);}finally{b.disabled=false;}}); }
  function confirmAction(text) {return new Promise(resolve=>{const d=$('report-confirm-dialog');$('report-confirm-text').textContent=text;let finished=false;const done=v=>{if(finished)return;finished=true;d.close();resolve(v);};$('report-confirm-yes').onclick=()=>done(true);$('report-confirm-no').onclick=()=>done(false);d.oncancel=e=>{e.preventDefault();done(false);};d.showModal();});}
  const selected = () => templates.find(t=>t.id===$('report-template-select').value);
  async function refresh(preferred) {
    const result=await api({action:'list'}); templates=result.templates.filter(t=>!t.document);if(!catalog.length)await loadCatalog();
    const old=preferred||$('report-template-select').value;
    $('report-template-select').replaceChildren(option('','اختر قالبًا'),...templates.map(t=>option(t.id,t.title)));
    $('report-template-select').value=templates.some(t=>t.id===old)?old:'';renderBindings();
  }
  function parseIds(text) { return [...new Set(text.trim().split(/[\s,،;؛]+/).filter(Boolean).map(v=>v.toUpperCase()))]; }
  function rememberBindings() {
    if (!bindingTemplate) return;
    const values=Object.create(null); $('report-bindings').querySelectorAll('[data-slot]').forEach(n=>values[n.dataset.slot]=n.value);
    bindingCache.set(bindingTemplate,values);
  }
  function renderBindings() {
    rememberBindings();
    const t=selected(), host=$('report-bindings'); host.replaceChildren(); bindingTemplate=t?.id||'';
    ['report-edit','report-duplicate','report-download','report-delete','report-generate'].forEach(id=>$(id).disabled=!t);
    if(!t){host.append(el('p','ابدأ بقالب جديد أو اختر قالبًا محفوظًا.','report-empty'));return;}
    const active=new Set([...t.body.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]));
    const savedValues={...(bindingCache.get(t.id)||{})};
    const slots=new Map();
    Object.entries(t.placeholders).forEach(([name,p])=>{if(active.has(name)){if(!slots.has(p.slot))slots.set(p.slot,[]);slots.get(p.slot).push([name,p]);}});
    for(const [slot,items] of slots){
      const card=el('section','','report-binding-card'), single=items.some(([,p])=>p.type==='field');
      const heading=el('div','','report-binding-heading');heading.append(el('strong',slot),el('span',single?'ملف واحد':'مجموعة ملفات','quiet-badge'));
      const input=el('textarea','','control'); input.rows=2; input.dir='ltr'; input.dataset.slot=slot;
      input.setAttribute('aria-label','IDs '+slot);input.placeholder='A1234567, B1234567'; input.value=savedValues[slot]||'';
      const count=el('small','','report-binding-info');
      const update=()=>{const n=parseIds(input.value).length;count.textContent=n+' محدد'+(single&&n>1?' — هذه المجموعة تتطلب ملفًا واحدًا':'');count.classList.toggle('report-warning',single&&n>1);rememberBindings();};
      input.addEventListener('input',update);
      const tools=el('div','','report-toolbar');tools.append(button('اختيار من الملفات',()=>openPicker(slot,items,single,input)),button('مسح',()=>{input.value='';update();}),count);
      card.append(heading,el('small',items.map(([n,p])=>(p.title||n)+' · '+(catalog.find(s=>s.id===p.schema_id)?.name||p.schema_id)).join(' / '),'report-binding-info'),input,tools);
      host.append(card);update();
    }
    if(!slots.size)host.append(el('p','هذا القالب نصي؛ يمكنك إنشاء معاينته مباشرة.','report-empty'));
  }
  async function loadCatalog(){catalog=(await api({action:'catalog'})).schemas;$('rp-schema').replaceChildren(...catalog.map(s=>option(s.id,s.name)));renderFields();}
  function fields(){return catalog.find(s=>s.id===$('rp-schema').value)?.fields||[];}
  function renderFields(){
    $('rp-fields').replaceChildren(...fields().map(f=>option(f.id,f.label+(f.repeated?' (متكرر)':''))));
    $('rp-group-field').replaceChildren(option('','اختر حقلًا ذا قيمة واحدة'),...fields().filter(f=>!f.repeated).map(f=>option(f.id,f.label)));
    $('rp-criteria').replaceChildren(); $('rp-field-search').value=''; renderFieldChoices();
  }
  function renderFieldChoices(){
    const host=$('rp-field-choices');host.replaceChildren();
    const multiple=$('rp-type').value==='chart';
    for(const field of fields()){
      const label=el('label','','report-field-choice');label.dataset.search=field.label.toLocaleLowerCase();
      const input=el('input');input.type=multiple?'checkbox':'radio';input.name='report-field-choice';input.value=field.id;
      input.checked=[...$('rp-fields').selectedOptions].some(o=>o.value===field.id);
      input.onchange=()=>{for(const o of $('rp-fields').options){if(o.value===field.id)o.selected=input.checked;else if(!multiple)o.selected=false;}renderFieldChoiceState();};
      label.append(input,el('span',field.label),el('small',field.repeated?'متكرر':({text:'نص',number:'رقم',integer:'عدد',date:'تاريخ',list:'قائمة',textarea:'نص'}[field.type]||'حقل')));host.append(label);
    }
    filterFields();
  }
  function renderFieldChoiceState(){const selectedFields=new Set([...$('rp-fields').selectedOptions].map(o=>o.value));$('rp-field-choices').querySelectorAll('input').forEach(n=>n.checked=selectedFields.has(n.value));}
  function filterFields(){const q=$('rp-field-search').value.toLocaleLowerCase();$('rp-field-choices').querySelectorAll('[data-search]').forEach(n=>n.hidden=!n.dataset.search.includes(q));}
  function syncType(){
    const type=$('rp-type').value;
    ['rp-chart-row','rp-mode-row','rp-sort-options'].forEach(id=>$(id).hidden=type!=='chart');
    $('rp-title-row').hidden=false; $('rp-function-row').hidden=type!=='aggregate';$('rp-format-options').hidden=type!=='aggregate';
    $('rp-group-options').hidden=type!=='chart'||$('rp-mode').value!=='grouped';
    $('rp-fields').multiple=type==='chart';renderFieldChoices();
  }
  function insertText(text){const ta=$('report-template-body');const start=ta.selectionStart,end=ta.selectionEnd;ta.setRangeText(text.replace(/\\n/g,'\n'),start,end,'end');ta.focus();templateDirty=true;templateHealth();}
  function renderDefinitions(){templateHealth();$('rp-slot-options').replaceChildren(...[...new Set(Object.values(definitions).map(p=>p.slot))].map(v=>option(v,v)));const host=$('report-placeholder-list');host.replaceChildren();Object.entries(definitions).forEach(([name,p])=>{host.append(button((p.title||name)+' · '+({field:'حقل',chart:'رسم',aggregate:'حساب'}[p.type])+' · تحرير',async()=>{ if(placeholderDirty&&!await confirmAction('ترك تعديلات العنصر الحالي دون حفظ؟'))return;placeholderDirty=false;$('rp-name').value=name;$('rp-type').value=p.type;$('rp-slot').value=p.slot;$('rp-schema').value=p.schema_id;renderFields();syncType();for(const o of $('rp-fields').options)o.selected=p.fields.includes(o.value);$('rp-chart').value=p.chart||'bar';$('rp-mode').value=p.mode||'values';$('rp-function').value=p.function||'sum';$('rp-title').value=p.title||'';$('rp-group-field').value=p.group_field||'';$('rp-reducer').value=p.reducer||'sum';$('rp-sort').value=p.sort||'none';$('rp-top-n').value=p.top_n??'';$('rp-decimals').value=p.decimals??'';$('rp-prefix').value=p.prefix||'';$('rp-suffix').value=p.suffix||'';$('rp-condition-mode').value=p.condition_mode||'all';syncType();renderFieldChoiceState();(p.criteria||[]).forEach(addCriterion);}),button('× حذف '+(p.title||name),async()=>{if(await confirmAction('حذف العنصر '+name+' من القالب؟')){delete definitions[name];$('report-template-body').value=$('report-template-body').value.split('{{'+name+'}}').join('');templateDirty=true;renderDefinitions();}}));});}
  async function openTemplate(mode){await loadCatalog();const t=mode==='new'?null:selected();if(mode!=='new'&&!t)throw Error('اختر قالبًا.');editing=mode==='edit'?clone(t):null;definitions=clone(t?.placeholders||{});$('report-template-title').value=t?(t.title+(mode==='duplicate'?' — نسخة':'')):'تقرير جديد';$('report-template-body').value=t?.body||'# تقرير جديد\nالتاريخ: {{date}}\n\n{{toc}}\n\n## مقدمة\nاكتب مقدمة التقرير هنا.\n\n## النتائج\n';resetPlaceholder();$('rp-criteria').replaceChildren();syncType();renderDefinitions();status('',false,'report-template-status');templateDirty=false;$('report-template-dialog').showModal();$('report-template-dialog').querySelector('.dialog-content').scrollTop=0;$('report-template-body').setSelectionRange(0,0);$('report-template-body').scrollTop=0;setTemplateView('write');templateHealth();}
  function addCriterion(c={}){const row=el('div','','report-criterion');const f=el('select','','control');f.replaceChildren(...fields().map(x=>option(x.id,x.label)));if(c.field)f.value=c.field;const op=el('select','','control');[['eq','يساوي'],['ne','لا يساوي'],['gt','أكبر من'],['gte','≥'],['lt','أصغر من'],['lte','≤'],['contains','يحتوي']].forEach(([v,l])=>op.append(option(v,l)));op.value=c.op||'eq';const v=el('input','','control');v.value=c.value??'';v.placeholder='القيمة';row.append(f,op,v,button('×',()=>row.remove()));$('rp-criteria').append(row);}
  function readDefinition(){const name=$('rp-name').value.trim();if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||['date','toc','pagebreak'].includes(name))throw Error('استخدم اسمًا إنجليزيًا مثل total_score.');const p={type:$('rp-type').value,slot:$('rp-slot').value.trim(),schema_id:$('rp-schema').value,fields:[...$('rp-fields').selectedOptions].map(o=>o.value),chart:$('rp-chart').value,mode:$('rp-mode').value,function:$('rp-function').value,title:$('rp-title').value.trim()||name,condition_mode:$('rp-condition-mode').value,group_field:$('rp-group-field').value,reducer:$('rp-reducer').value,sort:$('rp-sort').value,top_n:$('rp-top-n').value===''?null:Number($('rp-top-n').value),decimals:$('rp-decimals').value===''?null:Number($('rp-decimals').value),prefix:$('rp-prefix').value,suffix:$('rp-suffix').value,criteria:[...$('rp-criteria').children].map(row=>({field:row.children[0].value,op:row.children[1].value,value:row.children[2].value}))};if(!p.slot||!p.schema_id||!p.fields.length)throw Error('حدد مجموعة IDs والتصميم والحقول.');if(p.type!=='chart'&&p.fields.length!==1)throw Error('اختر حقلًا واحدًا.');if(p.type==='chart'&&(p.chart==='pie'||p.mode==='distribution')&&p.fields.length!==1)throw Error('الرسم الدائري يتطلب حقلًا واحدًا.');if(p.type==='aggregate'&&p.function.endsWith('ifs')&&!p.criteria.length)throw Error('أضف شرطًا للدالة الشرطية.');if(p.type==='chart'&&p.mode==='grouped'&&!p.group_field)throw Error('اختر حقل التجميع.');return [name,p];}
  function download(t){const meta=JSON.stringify({version:1,title:t.title,placeholders:t.placeholders,options:t.options||{}}).replaceAll('-->','\\u002d\\u002d>');const blob=new Blob(['<!-- SchemaCraftReport '+meta+' -->\n'+t.body],{type:'text/markdown;charset=utf-8'});const a=el('a');a.href=URL.createObjectURL(blob);a.download=t.title.replace(/[\\/:*?"<>|]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function inline(host,text){String(text).split(/(\*\*.*?\*\*)/g).forEach(part=>{host.append(part.startsWith('**')&&part.endsWith('**')?el('strong',part.slice(2,-2)):document.createTextNode(part));});}
  function svgNode(tag,attrs={}){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));return n;}
  function renderChart(c,host){host.append(el('h3',c.title));const svg=svgNode('svg',{viewBox:'0 0 540 250',role:'img','aria-label':c.title});const all=c.series.flatMap(s=>s.values);if(!c.labels.length||!all.some(v=>v)){host.append(el('p','لا توجد قيم للرسم.'));return;}
    if(c.type==='pie'){const values=c.series[0].values,total=values.reduce((a,b)=>a+b,0);if(values.some(v=>v<0)||total<=0){host.append(el('p','الدائرة تتطلب قيمًا غير سالبة ومجموعًا موجبًا.'));return;}let angle=-Math.PI/2;values.forEach((v,i)=>{if(!v)return;const next=angle+v/total*Math.PI*2;let shape;if(v===total)shape=svgNode('circle',{cx:270,cy:120,r:95,fill:palette[i%palette.length]});else shape=svgNode('path',{d:`M270 120 L${270+95*Math.cos(angle)} ${120+95*Math.sin(angle)} A95 95 0 ${v/total>.5?1:0} 1 ${270+95*Math.cos(next)} ${120+95*Math.sin(next)} Z`,fill:palette[i%palette.length]});const title=svgNode('title');title.textContent=c.labels[i]+': '+v;shape.append(title);svg.append(shape);angle=next;});}
    else {let min=Math.min(0,...all),max=Math.max(0,...all);if(max===min)max=min+1;const y=v=>210-(v-min)/(max-min)*180,step=450/Math.max(1,c.labels.length);svg.append(svgNode('line',{x1:50,x2:510,y1:y(0),y2:y(0),stroke:'#b6c7d9'}));for(let k=0;k<=4;k++){let value=min+(max-min)*k/4;const t=svgNode('text',{x:45,y:y(value)+4,'text-anchor':'end','font-size':10,fill:'#64748b'});t.textContent=Number(value.toPrecision(3));svg.append(t);}c.series.forEach((s,j)=>{if(c.type==='line')svg.append(svgNode('polyline',{points:s.values.map((v,i)=>`${50+step*(i+.5)},${y(v)}`).join(' '),fill:'none',stroke:palette[j%palette.length],'stroke-width':2}));s.values.forEach((v,i)=>{const shape=c.type==='bar'?svgNode('rect',{x:50+step*i+step*.1+j*step*.8/c.series.length,y:Math.min(y(0),y(v)),width:step*.8/c.series.length,height:Math.max(1,Math.abs(y(0)-y(v))),fill:palette[j%palette.length]}):svgNode('circle',{cx:50+step*(i+.5),cy:y(v),r:3,fill:palette[j%palette.length]});const title=svgNode('title');title.textContent=c.labels[i]+' / '+s.label+': '+v;shape.append(title);svg.append(shape);});});c.labels.forEach((label,i)=>{const t=svgNode('text',{x:50+step*(i+.5),y:234,'text-anchor':'middle','font-size':9});t.textContent=i+1;svg.append(t);});}host.append(svg);if(c.note)host.append(el('p',c.note,'report-chart-note'));
    const table=el('table');const head=el('tr');head.append(el('th','الفئة / ID'));c.series.forEach((s,j)=>{const th=el('th',s.label);th.style.color=palette[j%palette.length];head.append(th);});table.append(head);c.labels.forEach((label,i)=>{const tr=el('tr');tr.append(el('td',`${i+1}. ${label}`));c.series.forEach(s=>tr.append(el('td',s.values[i])));table.append(tr);});host.append(table);
  }
  function renderMarkdown(body,host,charts={}){host.replaceChildren();const lines=body.split('\n'),headings=lines.filter(l=>/^#{1,3}\s/.test(l)).map(l=>l.replace(/^#{1,3}\s+/,''));for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(!line){host.append(el('br'));continue;}if(line==='{{pagebreak}}'){host.append(el('div','صفحة جديدة','report-pagebreak'));continue;}if(line==='{{toc}}'){host.append(el('h2','المحتويات'));const list=el('ol');headings.forEach(h=>list.append(el('li',h)));host.append(list);continue;}const chart=line.match(/^\{\{chart:(\w+)\}\}$/);if(chart){if(charts[chart[1]])renderChart(charts[chart[1]],host);else host.append(el('p','رسم غير موجود: '+chart[1]));continue;}if(line.startsWith('|')&&line.endsWith('|')){const rows=[line];while(i+1<lines.length&&lines[i+1].trim().startsWith('|')&&lines[i+1].trim().endsWith('|'))rows.push(lines[++i].trim());const table=el('table');rows.filter(r=>!(/^[|\s:\-]+$/.test(r))).forEach((r,index)=>{const tr=el('tr');r.replace(/^\||\|$/g,'').split('|').forEach(v=>{const td=el(index===0?'th':'td');inline(td,v.trim());tr.append(td);});table.append(tr);});host.append(table);continue;}const h=line.match(/^(#{1,3})\s+(.*)$/),n=el(h?'h'+h[1].length:'p');inline(n,h?h[2]:line.replace(/^[-*]\s+/,'• '));host.append(n);}}
  function chartEditors(){const host=$('report-chart-editors');host.replaceChildren();Object.entries(draft.charts).forEach(([key,c])=>{const details=el('details','','report-chart-editor');details.append(el('summary','تحرير الرسم: '+c.title));const title=el('input','','control');title.value=c.title;title.maxLength=200;title.setAttribute('aria-label','عنوان الرسم');title.oninput=()=>{c.title=title.value;dirty=true;preview();};const type=el('select','','control');[['bar','أعمدة'],['pie','دائري'],['line','خطي']].forEach(([v,l])=>type.append(option(v,l)));type.value=c.type;type.onchange=()=>{if(type.value==='pie'&&(c.series.length!==1||c.series[0].values.some(v=>v<0))){type.value=c.type;status('الدائرة تتطلب سلسلة واحدة غير سالبة.',true);return;}c.type=type.value;dirty=true;preview();};details.append(title,type);const table=el('table','','report-chart-data'),head=el('tr');head.append(el('th','ID / الاسم'));c.series.forEach(s=>{const th=el('th'),input=el('input','','control');input.value=s.label;input.maxLength=160;input.oninput=()=>{s.label=input.value;dirty=true;preview();};th.append(input);head.append(th);});table.append(head);c.labels.forEach((label,i)=>{const row=el('tr'),cell=el('td'),input=el('input','','control');input.value=label;input.maxLength=160;input.oninput=()=>{c.labels[i]=input.value;dirty=true;preview();};cell.append(input);row.append(cell);c.series.forEach(s=>{const td=el('td'),v=el('input','','control');v.type='number';v.step='any';v.value=s.values[i];v.oninput=()=>{const n=Number(v.value);if(v.value===''||!Number.isFinite(n)||Math.abs(n)>1e15||(c.type==='pie'&&n<0)){v.setCustomValidity('قيمة رقمية غير صالحة');v.reportValidity();return;}v.setCustomValidity('');s.values[i]=n;dirty=true;preview();};td.append(v);row.append(td);});table.append(row);});details.append(table);host.append(details);});}
  window.ReportRendering={renderMarkdown};
  if(panel.dataset.visualOnly === 'true') return;
  run('report-refresh',()=>refresh());run('report-new',()=>openTemplate('new'));run('report-edit',()=>openTemplate('edit'));run('report-duplicate',()=>openTemplate('duplicate'));
  run('report-save-template',async()=>{if(placeholderDirty)throw Error('احفظ تعديلات العنصر بزر «حفظ العنصر وإدراجه» أولًا.');const t={title:$('report-template-title').value,body:$('report-template-body').value,placeholders:definitions,options:editing?.options||{}};await api({action:'validate',template:t});const r=await api({action:'save',template:t,id:editing?.id,revision:editing?.revision});templateDirty=false;$('report-template-dialog').close();await refresh(r.template.id);status('تم حفظ القالب كملف .md.');},'report-template-status');
  run('rp-insert',()=>{const [name,p]=readDefinition();definitions[name]=p;placeholderDirty=false;const token='{{'+name+'}}';if(!$('report-template-body').value.includes(token))insertText(p.type==='chart'?'\n'+token+'\n':token);templateDirty=true;renderDefinitions();status('تم حفظ العنصر.',false,'report-template-status');},'report-template-status');
  run('report-delete',async()=>{const t=selected();if(!t)return;if(await confirmAction('حذف القالب «'+t.title+'»؟ لا يؤثر ذلك في السجلات.')){await api({action:'delete',id:t.id,revision:t.revision});await refresh();status('تم حذف القالب.');}});
  run('report-download',()=>{const t=selected();if(t)download(t);});$('report-import').onclick=()=>$('report-import-file').click();$('report-import-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>300000)throw Error('القالب كبير جدًا.');const r=await api({action:'import',markdown:await f.text()});await refresh(r.template.id);status('تم استيراد القالب.');}catch(err){status(err.message,true);}finally{e.target.value='';}};
  run('report-generate',async()=>{const t=selected();if(!t)throw Error('اختر قالبًا.');if(draft&&dirty&&!await confirmAction('إعادة الإنشاء تستبدل تعديلات المسودة الحالية. متابعة؟'))return;const bindings=Object.create(null);$('report-bindings').querySelectorAll('[data-slot]').forEach(n=>bindings[n.dataset.slot]=[...new Set(n.value.trim().split(/[\s,،;؛]+/).filter(Boolean).map(v=>v.toUpperCase()))]);status('جارٍ قراءة الملفات وحساب التقرير…');const r=await api({action:'generate',id:t.id,bindings});installDraft(r.draft,null);status('تم إنشاء المسودة من '+draft.record_count+' ملف.\n'+draft.warnings.join('\n'),!!draft.warnings.length);});
  run('report-export',async()=>{if(!draft)throw Error('أنشئ المعاينة أولًا.');for(const input of $('report-chart-editors').querySelectorAll('input'))if(!input.reportValidity())return;preview();status('جارٍ إنشاء PDF واختيار مكان الحفظ…');const exporting=JSON.stringify(draft);const r=await api({type:'advanced_report',draft:clone(draft)},'/api/export/save');if(r.cancelled){status('أُلغي التصدير؛ المسودة محفوظة في الصفحة.');return;}if(JSON.stringify(draft)===exporting)dirty=false;status('تم الحفظ: '+r.filename);if(typeof loadExportHistory==='function')await loadExportHistory();});
  $('report-template-select').onchange=renderBindings;$('rp-schema').onchange=renderFields;$('rp-type').onchange=syncType;$('rp-mode').onchange=syncType;$('rp-fields').onchange=renderFieldChoiceState;$('rp-field-search').oninput=filterFields;$('rp-function').onchange=()=>{if($('rp-function').value.endsWith('ifs'))$('rp-criteria').closest('details').open=true;};$('rp-add-criterion').onclick=()=>addCriterion();$('rp-new').onclick=async()=>{if(!placeholderDirty||await confirmAction('بدء عنصر جديد وترك تعديلات العنصر الحالي؟'))resetPlaceholder();};$('report-format-tools').onclick=e=>{const b=e.target.closest('[data-insert]');if(b)insertText(b.dataset.insert);};
  ['report-draft-title','report-draft-body'].forEach(id=>$(id).oninput=()=>{dirty=true;preview();});['report-template-title','report-template-body'].forEach(id=>$(id).oninput=()=>{templateDirty=true;templateHealth();});
  $('report-template-dialog').querySelector('.report-placeholder-builder').addEventListener('input',e=>{if(e.target.id!=='rp-field-search'){templateDirty=true;placeholderDirty=true;}});
  // Capture closing before the application's generic dialog handler.
  $('report-template-dialog').addEventListener('click',async e=>{if(!e.target.closest('[data-close-dialog="report-template-dialog"]'))return;e.preventDefault();e.stopImmediatePropagation();if(!templateDirty||await confirmAction('إغلاق المحرر دون حفظ التعديلات؟')){templateDirty=false;$('report-template-dialog').close();}},true);
  $('report-template-dialog').addEventListener('cancel',async e=>{e.preventDefault();if(!templateDirty||await confirmAction('إغلاق المحرر دون حفظ التعديلات؟')){templateDirty=false;$('report-template-dialog').close();}});
  window.ReportRendering={renderMarkdown};
  window.addEventListener('beforeunload',e=>{if(dirty||templateDirty){e.preventDefault();e.returnValue='';}});
  function resetPlaceholder(){
    placeholderDirty=false;
    let n=Object.keys(definitions).length+1;while(definitions['item_'+n])n++;
    $('rp-name').value='item_'+n;$('rp-title').value='';$('rp-criteria').replaceChildren();
    $('rp-sort').value='none';$('rp-top-n').value='';$('rp-decimals').value='';$('rp-prefix').value='';$('rp-suffix').value='';$('rp-condition-mode').value='all';
    $('rp-group-field').value='';$('rp-reducer').value='sum';$('rp-mode').value='values';syncType();
  }
  function templateHealth(){
    const body=$('report-template-body').value, used=[...body.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]);
    const unknown=[...new Set(used.filter(k=>!definitions[k]&&!['date','toc','pagebreak'].includes(k)))];
    const unused=Object.keys(definitions).filter(k=>!used.includes(k));
    $('report-template-health').textContent=unknown.length?'غير معرّف: '+unknown.join('، '):Object.keys(definitions).length+' عناصر'+(unused.length?' · '+unused.length+' غير مستخدم':'');
    $('report-template-health').classList.toggle('report-warning',!!unknown.length);
    if(!$('report-template-preview').hidden){
      const text=body.replace(/\{\{(\w+)\}\}/g,(all,key)=>['toc','pagebreak'].includes(key)?all:key==='date'?new Date().toLocaleDateString('ar'):definitions[key]?'⟦ '+(definitions[key].title||key)+' ⟧':'⚠ '+key);
      renderMarkdown(text,$('report-template-preview'));
    }
  }
  function setTemplateView(mode){
    const show=mode==='preview';$('report-template-preview').hidden=!show;$('report-template-body').closest('label').hidden=show;$('report-format-tools').hidden=show;
    document.querySelectorAll('[data-template-view]').forEach(b=>{b.classList.toggle('is-active',b.dataset.templateView===mode);b.setAttribute('aria-pressed',String(b.dataset.templateView===mode));});templateHealth();
  }
  document.querySelectorAll('[data-template-view]').forEach(b=>b.onclick=()=>setTemplateView(b.dataset.templateView));
  $('report-starter').onchange=async()=>{
    const type=$('report-starter').value;if(!type)return;
    if(templateDirty&&!await confirmAction('استبدال نص القالب بالهيكل المختار؟ العناصر المعرّفة تبقى متاحة.')){$('report-starter').value='';return;}
    const bodies={narrative:'# تقرير تفصيلي\nالتاريخ: {{date}}\n\n{{toc}}\n\n## مقدمة\nاكتب الغرض من التقرير.\n\n## النتائج\nأدرج الحقول والحسابات والرسوم من لوحة العناصر.\n\n## التوصيات\n- التوصية الأولى\n',summary:'# ملخص تنفيذي\nالتاريخ: {{date}}\n\n## أبرز المؤشرات\n| المؤشر | القيمة |\n| --- | --- |\n| المؤشر الأول | أدخل قيمة أو عنصرًا |\n\n## قراءة النتائج\nاكتب تفسير النتائج.\n\n## الخطوات التالية\n- الإجراء الأول\n',comparison:'# تقرير مقارنة\nالتاريخ: {{date}}\n\n## نطاق المقارنة\nحدد المجموعات والفترة.\n\n## المؤشرات\nأضف رسمًا مجمعًا حسب القسم أو الحالة.\n\n## الملاحظات\n\n## الاستنتاج\n'};
    $('report-template-body').value=bodies[type];templateDirty=true;setTemplateView('write');templateHealth();$('report-starter').value='';
  };
  run('report-validate',async()=>{
    const result=await api({action:'validate',template:{title:$('report-template-title').value,body:$('report-template-body').value,placeholders:definitions,options:editing?.options||{}}});
    status('القالب صالح.'+(result.unused?.length?' عناصر غير مستخدمة: '+result.unused.join('، '):''),false,'report-template-status');
  },'report-template-status');
  $('report-template-search').oninput=()=>{const q=$('report-template-search').value.toLocaleLowerCase();[...$('report-template-select').options].forEach(o=>o.hidden=!!o.value&&o.value!==$('report-template-select').value&&!o.textContent.toLocaleLowerCase().includes(q));};

  function readPageOptions(){return {orientation:$('report-orientation').value,font_size:Number($('report-font-size').value),accent:$('report-accent').value,header:$('report-header').value,footer:$('report-footer').value};}
  function installDraft(value,identity){
    ++draftEpoch;clearTimeout(previewTimer);draft=clone(value);draftIdentity=identity;dirty=!identity;
    $('report-draft-title').value=draft.title;$('report-draft-body').value=draft.body;
    const opts={orientation:'portrait',font_size:11,accent:'blue',header:'',footer:'',...draft.options};
    for(const [id,key] of [['report-orientation','orientation'],['report-font-size','font_size'],['report-accent','accent'],['report-header','header'],['report-footer','footer']])$(id).value=opts[key];
    $('report-draft-area').hidden=false;chartEditors();preview(true);
  }
  function collectDraft(){
    if(!draft)throw Error('أنشئ تقريرًا أولًا.');
    for(const input of $('report-chart-editors').querySelectorAll('input'))if(!input.reportValidity())throw Error('صحح قيم الرسم قبل الحفظ.');
    draft.title=$('report-draft-title').value;draft.body=$('report-draft-body').value;draft.options=readPageOptions();return clone(draft);
  }
  function preview(immediate=false){
    if(!draft)return;
    draft.title=$('report-draft-title').value;draft.body=$('report-draft-body').value;draft.options=readPageOptions();
    $('report-save-state').textContent=dirty?'توجد تعديلات غير محفوظة':draftIdentity?'مسودة محفوظة':'نسخة مصدّرة؛ احفظ المسودة لإعادة تحريرها';
    clearTimeout(previewTimer);
    const render=()=>{
      const host=$('report-preview'),scroll=host.scrollTop;
      renderMarkdown(draft.body,host,draft.charts);
      host.style.fontSize=draft.options.font_size+'pt';host.dataset.accent=draft.options.accent;host.dataset.orientation=draft.options.orientation;host.scrollTop=scroll;
      const outline=$('report-outline');outline.replaceChildren();
      host.querySelectorAll('h1,h2,h3').forEach((h,i)=>{h.id='report-heading-'+i;outline.append(button(h.textContent,()=>h.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})));});
      $('report-document-stats').textContent=(draft.body.trim().split(/\s+/).filter(Boolean).length)+' كلمة · '+Object.keys(draft.charts).length+' رسوم';
    };
    if(immediate||!$('report-preview').childElementCount)render();else previewTimer=setTimeout(render,120);
  }
  for(const id of ['report-orientation','report-font-size','report-accent','report-header','report-footer'])$(id).addEventListener('input',()=>{dirty=true;preview();});
  document.querySelectorAll('[data-report-view]').forEach(b=>b.onclick=()=>{
    $('report-draft-grid').classList.toggle('is-preview-only',b.dataset.reportView==='preview');
    document.querySelectorAll('[data-report-view]').forEach(n=>{n.classList.toggle('is-active',n===b);n.setAttribute('aria-pressed',String(n===b));});
  });
  async function saveDraft(copy=false){
    const epoch=draftEpoch,value=collectDraft(), captured=JSON.stringify(value);
    const result=await api({action:'draft_save',draft:value,id:copy?undefined:draftIdentity?.id,revision:copy?undefined:draftIdentity?.revision});
    if(epoch!==draftEpoch){status('تم حفظ المسودة السابقة؛ التقرير المفتوح لم يتغيّر.');return;}
    draftIdentity={id:result.saved.id,revision:result.saved.revision};
    if(JSON.stringify(collectDraft())===captured)dirty=false;
    preview();status('تم حفظ المسودة. يمكنك فتحها بعد إعادة تشغيل التطبيق.');
  }
  run('report-save-draft',()=>saveDraft());run('report-save-copy',()=>saveDraft(true));
  async function listDrafts(){
    const data=await api({action:'draft_list'}),host=$('report-drafts-list');data.drafts=data.drafts.filter(d=>!d.document);host.replaceChildren();
    if(!data.drafts.length)host.append(el('p','لا توجد مسودات بعد. أنشئ تقريرًا ثم اضغط حفظ المسودة.','report-empty'));
    data.drafts.forEach(item=>{
      const row=el('section','','report-saved-draft'),details=el('div');details.append(el('strong',item.title),el('small',new Date(item.updated_at).toLocaleString('ar')));
      const open=button('فتح',async()=>{open.disabled=true;try{if(dirty&&!await confirmAction('فتح مسودة أخرى يستبدل التعديلات غير المحفوظة. متابعة؟'))return;const result=await api({action:'draft_read',id:item.id});installDraft(result.saved.draft,{id:result.saved.id,revision:result.saved.revision});$('report-drafts-dialog').close();status('فُتحت المسودة المحفوظة؛ أرقامها تعكس وقت إنشائها.');}catch(e){status(e.message,true);}finally{open.disabled=false;}});
      const remove=button('حذف',async()=>{if(!await confirmAction('حذف المسودة «'+item.title+'»؟'))return;remove.disabled=true;try{await api({action:'draft_delete',id:item.id,revision:item.revision});if(draftIdentity?.id===item.id){draftIdentity=null;dirty=true;preview();}await listDrafts();}catch(e){status(e.message,true);}finally{remove.disabled=false;}});
      row.append(details,open,remove);host.append(row);
    });
  }
  run('report-open-drafts',async()=>{await listDrafts();$('report-drafts-dialog').showModal();});
  run('report-pdf-preview',async()=>{
    status('جارٍ تجهيز صفحات PDF…');
    const result=await api({action:'pdf_preview',draft:collectDraft()});
    if(pdfUrl)URL.revokeObjectURL(pdfUrl);
    pdfUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(result.pdf),c=>c.charCodeAt(0))],{type:'application/pdf'}));
    $('report-pdf-frame').src=pdfUrl;$('report-pdf-link').href=pdfUrl;$('report-pdf-dialog').showModal();status('معاينة PDF جاهزة؛ لم يُحفظ ملف تصدير بعد.');
  });
  $('report-pdf-dialog').addEventListener('close',()=>{$('report-pdf-frame').src='about:blank';if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}});

  let picker=null, pickerRequest=0, pickerTimer=null;
  async function openPicker(slot,items,single,input){
    picker={slot,schema_ids:[...new Set(items.map(([,p])=>p.schema_id))],single,input,selected:new Set(parseIds(input.value)),offset:0,rows:[]};
    $('report-picker-query').value='';$('report-picker-archived').checked=false;$('report-picker-description').textContent=slot+' · الملفات المشتركة بين التصاميم المطلوبة فقط';
    $('report-picker-all').hidden=single;$('report-picker-dialog').showModal();await loadPicker();
  }
  function pickerCount(){$('report-picker-count').textContent=picker.selected.size+' / '+(picker.single?'1':'500')+' ملف محدد';}
  async function loadPicker(){
    const request=++pickerRequest;$('report-picker-rows').replaceChildren(el('p','جارٍ البحث…','report-empty'));
    $('report-picker-prev').disabled=true;$('report-picker-next').disabled=true;$('report-picker-all').disabled=true;
    try{
      const result=await api({action:'profiles',schema_ids:picker.schema_ids,query:$('report-picker-query').value,offset:picker.offset,include_archived:$('report-picker-archived').checked});
      if(request!==pickerRequest||!$('report-picker-dialog').open)return;
      picker.rows=result.profiles;const host=$('report-picker-rows');host.replaceChildren();
      for(const profile of result.profiles){
        const row=el('label','','report-picker-row'),check=el('input');check.type=picker.single?'radio':'checkbox';check.name='report-picked-profile';check.checked=picker.selected.has(profile.id);check.value=profile.id;
        check.onchange=()=>{if(picker.single)picker.selected.clear();if(check.checked){if(picker.selected.size>=500){check.checked=false;return;}picker.selected.add(profile.id);}else picker.selected.delete(profile.id);pickerCount();};
        const text=el('span');text.append(el('strong',profile.id),el('small',profile.description||'لا توجد معلومات عامة'));row.append(check,text);host.append(row);
      }
      if(!result.profiles.length)host.append(el('p','لا توجد ملفات مطابقة. جرّب بحثًا آخر.','report-empty'));
      $('report-picker-page').textContent=result.total?`${result.offset+1}–${result.offset+result.profiles.length} من ${result.total}`:'0 نتائج';
      $('report-picker-prev').disabled=result.offset===0;$('report-picker-next').disabled=!result.has_more;$('report-picker-all').disabled=!result.profiles.length;pickerCount();
    }catch(e){if(request===pickerRequest)$('report-picker-rows').replaceChildren(el('p',e.message,'report-warning'));}
  }
  $('report-picker-query').oninput=()=>{++pickerRequest;clearTimeout(pickerTimer);picker.offset=0;pickerTimer=setTimeout(loadPicker,180);};
  $('report-picker-archived').onchange=()=>{picker.offset=0;loadPicker();};
  $('report-picker-prev').onclick=()=>{picker.offset=Math.max(0,picker.offset-40);loadPicker();};$('report-picker-next').onclick=()=>{picker.offset+=40;loadPicker();};
  $('report-picker-all').onclick=()=>{for(const row of picker.rows)if(picker.selected.size<500)picker.selected.add(row.id);$('report-picker-rows').querySelectorAll('input').forEach(n=>n.checked=picker.selected.has(n.value));pickerCount();};
  $('report-picker-clear').onclick=()=>{picker.selected.clear();$('report-picker-rows').querySelectorAll('input').forEach(n=>n.checked=false);pickerCount();};
  $('report-picker-apply').onclick=()=>{if(picker.single&&picker.selected.size>1){$('report-picker-count').textContent='اختر ملفًا واحدًا فقط.';return;}picker.input.value=[...picker.selected].join(', ');picker.input.dispatchEvent(new Event('input',{bubbles:true}));$('report-picker-dialog').close();};
  $('report-picker-dialog').addEventListener('close',()=>{++pickerRequest;clearTimeout(pickerTimer);});
  // Keyboard saving respects the visible report context and its active dialog.
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='s')return;
    if($('report-template-dialog').open){e.preventDefault();e.stopImmediatePropagation();$('report-save-template').click();}
    else if(draft&&panel.getClientRects().length&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();$('report-save-draft').click();}
  },true);
  // These owned dialogs also work when this module is loaded independently in tests.
  ['report-picker-dialog','report-drafts-dialog','report-pdf-dialog'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.closest('[data-close-dialog="'+id+'"]'))$(id).close();}));
  let loading=false;
  new MutationObserver(async()=>{if(!panel.hidden&&!loading){loading=true;try{await refresh();}catch(e){status(e.message,true);}finally{loading=false;}}}).observe(panel,{attributes:true,attributeFilter:['hidden']});
  syncType();renderBindings();
})();
