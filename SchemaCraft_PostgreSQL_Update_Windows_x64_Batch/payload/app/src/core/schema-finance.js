/* Schema-native financial definitions. No financial workspace or executable formulas. */
const SCFinance = (() => {
  'use strict';
  const T = x => scText(x);
  const clone = x => JSON.parse(JSON.stringify(x));
  const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const $ = id => document.getElementById(id);
  function el(tag, cls = '', text = null) { const n=document.createElement(tag); n.className=cls; if(text!==null)n.textContent=text; return n; }
  function named(n,text){n.textContent=text??'';n.dataset.i18nSkip='true';return n;}
  function button(text,click,icon='',danger=false){const b=el('button','button '+(danger?'button-danger-quiet':'button-secondary'));b.type='button';if(icon)b.append(actionIcon(({check:'finance-check',close:'clear',folder:'open',download:'backup'})[icon]||icon));if(text)b.append(document.createTextNode(T(text)));b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();try{Promise.resolve(click(e)).catch(err=>showToast(err.message,'error'));}catch(err){showToast(err.message,'error');}});return b;}
  function iconButton(text,icon,click,danger=false){const b=button('',click,icon,danger);b.classList.add('workflow-icon-only');b.title=T(text);b.setAttribute('aria-label',b.title);return b;}
  function select(items,value,change){const n=el('select','control');items.forEach(([v,l])=>{const o=new Option(l,v);o.dataset.i18nSkip='true';n.append(o);});n.value=value??'';n.addEventListener('change',()=>change(n.value,n));return n;}
  function input(value,change,type='text'){const n=el('input','control');n.type=type;n.value=value??'';if(type==='number')n.step='any';n.addEventListener('input',()=>change(n.value,n));return n;}
  function field(text,control){const w=el('label','field');w.append(el('span','',T(text)),control);return w;}
  function namedField(text,control){const w=field('',control);named(w.firstChild,text);return w;}
  function check(text,value,change){const l=el('label','check-field'),c=el('input');c.type='checkbox';c.checked=!!value;c.addEventListener('change',()=>change(c.checked));l.append(c,el('span','',T(text)));return l;}
  function panel(text){const d=el('details','finance-config-panel');d.open=true;const summary=el('summary'),title=el('span','finance-config-title',T(text)),actions=el('span','finance-config-actions');summary.append(title,actions);d.append(summary);const body=el('div','finance-config-body');d.append(body);return {root:d,body,actions,title};}
  function dialog(title){const d=el('dialog','editor-dialog finance-config-dialog');if(elements.fieldDialog?.open||elements.categoryDialog?.open)d.classList.add('compact-associated-dialog');d.id=id('finance-dialog');const h=el('div','dialog-heading'),x=button('',()=>d.close());x.className='dialog-close';x.textContent='×';x.setAttribute('aria-label',T('إغلاق'));h.append(el('h2','',T(title)),x);const body=el('div','dialog-content'),foot=el('div','dialog-actions');d.append(h,body,foot);document.body.append(d);d.addEventListener('close',()=>d.remove());return {root:d,body,foot};}
  const numeric=f=>f?.type==='number'&&f.number_behavior?.storage_mode!=='text';
  const values=c=>(c?.fields||[]).filter(f=>!['spacer','field_group','file'].includes(f.type));
  const schemas={};let schemaPromise=null;
  async function fetchSchemas(force=false){
    if(!schemaPromise||force)schemaPromise=fetch('/api/schema-finance/definitions').then(responseJson).then(result=>{Object.keys(schemas).forEach(k=>delete schemas[k]);Object.assign(schemas,result.schemas||{});return schemas;}).catch(e=>{schemaPromise=null;throw e;});
    return schemaPromise;
  }
  function schema(sid=''){return !sid||sid===state.activeSchemaId ? state.draftSchema||state.schema : schemas[sid]?.schema;}
  function schemaOptions(){return [['',T('التصميم الحالي')],...Object.entries(schemas).filter(([sid])=>sid!==state.activeSchemaId).map(([sid,x])=>[sid,x.name])];}
  const sys=()=>[['$record_code',T('معرّف السجل')],['$updated_at',T('آخر تعديل')],['$created_at',T('تاريخ الإنشاء')]];
  function pairs(s){return (s?.categories||[]).flatMap(c=>values(c).map(f=>({c,f})));}
  function fieldOptions(s,catid='',onlyNumber=false,mainOnly=false,exclude=''){
    return pairs(s).filter(({c,f})=>(!mainOnly||c.kind==='main')&&(!catid||c.kind==='main'||c.id===catid)&&(!onlyNumber||numeric(f))&&f.id!==exclude).map(({c,f})=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`]);
  }
  function sourceFields(s){const sc=schema(s.schema_id);return pairs(sc).filter(({c})=>c.kind==='main'||c.id===s.category_id).map(({c,f})=>({...f,_category:c}));}
  function localFields(owner){return pairs(state.draftSchema||state.schema).filter(({c})=>c.kind==='main'||c.id===owner).map(({c,f})=>({...f,_category:c}));}
  const OPERATORS=[['equals','يساوي'],['not_equals','لا يساوي'],['contains','يحتوي'],['not_contains','لا يحتوي'],['empty','فارغ'],['not_empty','غير فارغ'],['gt','أكبر من'],['gte','أكبر من أو يساوي'],['lt','أقل من'],['lte','أقل من أو يساوي'],['between','بين قيمتين']];
  // The red rail is a sibling of the complete item body, not a floating button
  // inside a nested heading. Its full height makes the deletion scope explicit.
  function itemBox(kind, removeText, onRemove) {
    const root=el('div','finance-rule-card finance-item-box '+kind);
    const body=el('div','finance-item-content');
    const remove=iconButton(removeText,'trash',onRemove,true);
    remove.classList.add('finance-delete-rail');
    root.append(body,remove);
    return {root,body,remove};
  }
  function conditionValue(f,value,change){
    if(f?.type==='checkbox')return select([['true',T('نعم')],['false',T('لا')]],String(value??'true'),change);
    if(['select','yes_no','checkbox_group'].includes(f?.type)&&!f.record_options)return select([['',T('اختر قيمة')],...(f.options||[]).map(o=>[o.id||o.label,displayLabel(o)||o.label])],value,change);
    const n=input(value,change);if(numeric(f)){n.inputMode='decimal';n.dir='ltr';}else if(f?.type?.startsWith('date_')){n.placeholder='YYYY-MM-DD';n.dir='ltr';}return n;
  }
  function conditions(host,rules,available,changed=()=>{},matchObject=null,{headerActions=null,matchHost=null}={}) {
    host.replaceChildren();host.classList.add('finance-conditions','builder-conditions-box');
    const heading=el('div','finance-condition-heading builder-conditions-heading');
    heading.append(el('h4','',T('الشروط')));host.append(heading);
    if(headerActions)headerActions.replaceChildren();
    if(matchObject){
      const choice=field('تحقق الشروط',select([['all',T('جميع الشروط')],['any',T('أي شرط')]],matchObject.match||'all',v=>{matchObject.match=v;changed();}));
      choice.classList.add('finance-match-control');(matchHost||heading).append(choice);
    }
    const rows=el('div','finance-rule-list');host.append(rows);
    const render=()=>{
      rows.replaceChildren();rules.forEach((r,index)=>{
        const item=itemBox('finance-condition-row','حذف الشرط',()=>{rules.splice(index,1);render();changed();});
        const line=el('div','finance-condition-fields'),f=available.find(f=>f.id===r.field_id);
        const opts=[['',T('اختر حقلًا')],...available.map(f=>[f.id,(f._category?displayLabel(f._category)+' — ':'')+displayLabel(f)])];
        const source=select(opts,r.field_id,v=>{r.field_id=v;r.value='';render();changed();});source.setAttribute('aria-label',T('حقل الشرط'));
        const operator=select(OPERATORS.filter(([op])=>numeric(f)||!['gt','gte','lt','lte','between'].includes(op)||f?.type?.startsWith('date_')).map(([v,t])=>[v,T(t)]),r.operator||'equals',v=>{r.operator=v;render();changed();});operator.setAttribute('aria-label',T('مقارنة الشرط'));
        const value=el('div','finance-condition-values');
        if(!['empty','not_empty'].includes(r.operator)){
          const lower=conditionValue(f,r.value,v=>{r.value=v;changed();});lower.setAttribute('aria-label',T('قيمة الشرط'));value.append(lower);
          if(r.operator==='between'){const upper=conditionValue(f,r.upper,v=>{r.upper=v;changed();});upper.setAttribute('aria-label',T('القيمة العليا للشرط'));value.append(upper);}
        }else value.setAttribute('aria-hidden','true');
        line.append(source,operator,value);item.body.append(line);rows.append(item.root);
      });
    };
    heading.append(button('إضافة شرط',()=>{rules.push({field_id:available[0]?.id||'',operator:'equals',value:''});render();changed();},'plus'));render();
  }
  function newSource(){return {id:id('src'),schema_id:'',category_id:'',scope:'current',filters:[],match:'all'};}
  function sourceList(host,list,{aggregate=false,count=false,onchange=()=>{},headerActions=null}={}){
    host.replaceChildren();host.classList.add('finance-source-list');
    const render=()=>sourceList(host,list,{aggregate,count,onchange,headerActions});
    const add=button('إضافة مصدر جدول',()=>{list.push(newSource());render();onchange();},'plus');
    if(headerActions)headerActions.replaceChildren(add);else{const h=el('div','finance-list-heading');h.append(el('strong','',T('جداول المصدر')),add);host.append(h);}
    list.forEach((s,index)=>{
      const p=itemBox('finance-source-item','حذف المصدر',()=>{list.splice(index,1);render();onchange();});
      const sourcePicker=field('التصميم المصدر',select(schemaOptions(),s.schema_id,v=>{s.schema_id=v;s.category_id='';s.filters=[];delete s.value_field_id;delete s.currency_field_id;render();onchange();}));
      const sc=schema(s.schema_id),cats=(sc?.categories||[]).filter(c=>c.kind==='repeatable');
      const grid=el('div','finance-config-grid');grid.append(sourcePicker);
      grid.append(field('جدول المصدر',select([['',T('اختر فئة متكررة')],...cats.map(c=>[c.id,displayLabel(c)])],s.category_id,v=>{s.category_id=v;s.filters=[];delete s.value_field_id;delete s.currency_field_id;render();onchange();})));
      grid.append(field('نطاق السجلات',select([['current',T('هذا السجل فقط — عبر معرّف السجل')],['all',T('كل السجلات غير المؤرشفة')],['match',T('سجلات تطابق حقلًا في السجل الحالي')]],s.scope||'current',v=>{s.scope=v;render();onchange();})));
      if(s.scope==='match'){
        grid.append(field('حقل المطابقة هنا',select([...sys(),...fieldOptions(state.draftSchema)],s.local_field_id||'$record_code',v=>{s.local_field_id=v;onchange();})));
        grid.append(field('حقل المطابقة في المصدر',select([...sys(),...fieldOptions(sc,'',false,true)],s.remote_field_id||'$record_code',v=>{s.remote_field_id=v;onchange();})));
        s.local_field_id||='$record_code';s.remote_field_id||='$record_code';
      }
      if(aggregate){
        grid.append(field(count?'الحقل المعدود — فارغ لعد الصفوف':'حقل المبلغ',select([['',T(count?'عدد الصفوف':'اختر حقلًا عدديًا')],...fieldOptions(sc,s.category_id,!count)],s.value_field_id||'',v=>{s.value_field_id=v;onchange();})));
        grid.append(field('حقل العملة — اختياري',select([['',T('بلا فحص عملة')],...fieldOptions(sc,s.category_id)],s.currency_field_id||'',v=>{s.currency_field_id=v;onchange();})));
      }
      p.body.append(grid);
      if(s.category_id){const filter=el('div');conditions(filter,s.filters||=([]),sourceFields(s),onchange,s);p.body.append(filter);}
      host.append(p.root);
    });
  }
  let categoryDraft=null,fieldDraft=null,exactDraft=false;
  function initCategory(category){
    categoryDraft={table:clone(category?.table||{display:'cards',columns:(category?.fields||[]).filter(f=>!isLayoutField(f)).map(f=>f.id),row_rules:[]}),view:clone(category?.view_table||{sources:[],columns:[],filters:[],match:'all',totals:[]})};
    renderCategory();fetchSchemas(true).then(()=>{if(elements.categoryDialog.open)renderCategory();}).catch(e=>showToast(e.message,'error'));
  }
  function renderCategory(){
    const host=$('finance-category-editor');if(!host||!categoryDraft)return;host.replaceChildren();const kind=elements.categoryKind.value;const displaySlot=$('compact-repeatable-display');displaySlot?.replaceChildren();
    if(kind==='repeatable'){
      const t=categoryDraft.table,avail=(state.categoryFieldsDraft||[]).filter(f=>!isLayoutField(f));
      if(!t.columns.length)t.columns=avail.map(f=>f.id);
      const displayControl=field('طريقة عرض البطاقات',select([['cards',T('بطاقات وتبويبات')],['table',T('جدول — كل صف بطاقة')]],t.display,v=>{t.display=v;renderCategory();}));displayControl.lastChild.id='finance-card-display';(displaySlot||host).append(displayControl);
      if(t.display==='table'){
        const cols=panel('أعمدة الجدول');cols.body.classList.add('finance-table-columns');avail.forEach(f=>{const choice=check('',t.columns.includes(f.id),on=>{t.columns=on?[...t.columns,f.id]:t.columns.filter(k=>k!==f.id);});named(choice.lastChild,displayLabel(f));cols.body.append(choice);});host.append(cols.root);
        const rules=panel('شروط تنسيق الصف بالكامل');
        t.row_rules.forEach((r,i)=>{
          const item=itemBox('finance-format-item','حذف التنسيق الشرطي',()=>{t.row_rules.splice(i,1);renderCategory();}),head=el('div','finance-format-head');head.append(field('لون الصف',input(r.color,v=>r.color=v,'color')));item.body.append(head);
          const controls=el('div');conditions(controls,r.filters||=[],[...pairs(state.draftSchema).filter(({c})=>c.kind==='main').map(({f})=>f),...avail],()=>{},r,{matchHost:head});item.body.append(controls);rules.body.append(item.root);
        });
        rules.actions.append(button('إضافة تنسيق شرطي',()=>{t.row_rules.push({color:'#fff0dd',filters:[],match:'all'});renderCategory();},'plus'));host.append(rules.root);
        host.append(el('p','muted-text',T('الألوان لا تغير القيم. أول قاعدة مطابقة تحدد لون الصف.')));
      }
    }else if(kind==='view_table'){
      const v=categoryDraft.view;
      const sourcesPanel=panel('جداول المصدر وشروطها'),ss=el('div');sourceList(ss,v.sources,{onchange:()=>renderViewColumns(),headerActions:sourcesPanel.actions});sourcesPanel.body.append(ss);host.append(sourcesPanel.root);
      const cc=panel('أعمدة العرض'),ch=el('div');ch.id='finance-view-columns';cc.body.append(ch);cc.actions.append(button('إضافة عمود',()=>{v.columns.push({id:id('vcol'),label:'',fields:{}});renderViewColumns();},'plus'));
      cc.actions.append(button('إضافة أعمدة المصدر الأول',()=>{
        const src=v.sources[0];if(!src?.category_id)return;
        for(const f of values((schema(src.schema_id)?.categories||[]).find(c=>c.id===src.category_id))){if(v.columns.some(c=>c.fields[src.id]===f.id))continue;v.columns.push({id:id('vcol'),label:displayLabel(f),type:f.type,fields:{[src.id]:f.id}});}
        renderViewColumns();
      }));host.append(cc.root);
      const ff=panel('شروط جدول العرض الثابتة'),fh=el('div');fh.id='finance-view-filters';ff.body.append(fh);host.append(ff.root);
      const tt=panel('حقول الجمع'),th=el('div');th.id='finance-view-totals';tt.body.append(th);tt.actions.append(button('إضافة حقل جمع',()=>{v.totals.push({id:id('vsum'),label:'',operation:'sum',column_id:'',filters:[],precision:2});renderViewTotals();},'plus'));host.append(tt.root);
      renderViewColumns();
    }
  }
  function viewFields(){const v=categoryDraft.view;return v.columns.map(col=>{const types=Object.entries(col.fields).map(([sid,fid])=>{const f=sourceFields(v.sources.find(x=>x.id===sid)||{}).find(f=>f.id===fid);return f?(numeric(f)?'number':'text'):null;}).filter(Boolean);return {...col,type:types.length&&types.every(t=>t==='number')?'number':'text'};});}
  function renderViewColumns(){
    const host=$('finance-view-columns');if(!host)return;const v=categoryDraft.view;host.replaceChildren();
    v.columns.forEach((c,index)=>{
      const item=itemBox('finance-column-item','حذف العمود',()=>{v.columns.splice(index,1);renderViewColumns();});
      const mappings=el('div','finance-config-grid');mappings.append(field('اسم العمود',input(c.label,value=>{c.label=value;})));v.sources.forEach(src=>{
        const category=(schema(src.schema_id)?.categories||[]).find(c=>c.id===src.category_id);
        mappings.append(namedField(displayLabel(category)||T('المصدر'),select([['',T('لا قيمة من هذا المصدر')],...sourceFields(src).map(f=>[f.id,(f._category?displayLabel(f._category)+' — ':'')+displayLabel(f)])],c.fields[src.id]||'',value=>{if(value)c.fields[src.id]=value;else delete c.fields[src.id];renderViewTotals();})));
      });item.body.append(mappings);host.append(item.root);
    });
    const fh=$('finance-view-filters');if(fh)conditions(fh,v.filters,viewFields(),()=>{},v,{headerActions:fh.closest('details').querySelector(':scope > summary > .finance-config-actions')});renderViewTotals();
  }
  function renderViewTotals(){
    const host=$('finance-view-totals');if(!host)return;host.replaceChildren();const v=categoryDraft.view,fields=viewFields();
    v.totals.forEach((t,index)=>{
      const item=itemBox('finance-total-item','حذف حقل الجمع',()=>{v.totals.splice(index,1);renderViewTotals();}),grid=el('div','finance-config-grid');
      grid.append(field('اسم حقل الجمع',input(t.label,value=>t.label=value)),field('العملية',select(aggregateOptions(),t.operation,value=>{t.operation=value;renderViewTotals();})),field('العمود العددي',select([['',T('اختر عمودًا')],...fields.filter(f=>numeric(f)).map(f=>[f.id,f.label||T('عمود')])],t.column_id,value=>t.column_id=value)),field('المنازل العشرية',input(t.precision??2,value=>t.precision=Number(value),'number')),field('عمود العملة — اختياري',select([['',T('بلا فحص عملة')],...fields.map(f=>[f.id,f.label||T('عمود')])],t.currency_column_id||'',value=>t.currency_column_id=value)));
      item.body.append(grid);const filter=el('div');conditions(filter,t.filters||=[],fields);item.body.append(filter);host.append(item.root);
    });
  }
  function collectCategory(){
    const kind=elements.categoryKind.value;
    if(kind==='view_table'){
      if(state.categoryFieldsDraft?.length)throw Error(T('جدول العرض يستخدم أعمدة المصدر؛ أنشئ فئة جديدة أو انقل حقول الإدخال أولًا.'));
      const view=clone(categoryDraft.view);view.columns=clone(viewFields());
      if(!view.sources.length||view.sources.some(s=>!s.category_id))throw Error(T('اختر مصدر جدول واحدًا على الأقل.'));
      if(!view.columns.length||view.columns.some(c=>!c.label.trim()||!Object.keys(c.fields).length))throw Error(T('أضف أعمدة مسماة واربطها بمصادرها.'));
      return {view_table:view};
    }
    if(kind==='repeatable'){const table=clone(categoryDraft.table);table.columns=table.columns.filter(fid=>(state.categoryFieldsDraft||[]).some(f=>f.id===fid));return {table};}
    return {};
  }
  function aggregateOptions(){return [['sum','SUM — مجموع'],['sumif','SUMIF — مجموع بشرط'],['sumifs','SUMIFS — مجموع بعدة شروط'],['average','متوسط'],['count','عدد'],['min','أصغر قيمة'],['max','أكبر قيمة']].map(([v,t])=>[v,T(t)]);}
  function initField(f){fieldDraft=clone(f?.financial||null);exactDraft=!!f?.exact_decimal;renderField();fetchSchemas().then(()=>{if(elements.fieldDialog.open)renderField();}).catch(e=>showToast(e.message,'error'));}
  function renderField(){
    const host=$('finance-field-editor');if(!host)return;window.SCBuilderCompact?.clearFinanceField();host.replaceChildren();const ui=elements.fieldType.value,finance=['current_budget','calculation'].includes(ui),type=selectedBuilderFieldType();
    if(finance){
      const mode=ui==='current_budget'?'budget':'calculation';if(fieldDraft?.mode!==mode)fieldDraft={mode,operation:mode==='budget'?'subtract':'sum',precision:2,operands:mode==='budget'?[{kind:'aggregate',operation:'sumifs',sources:[newSource()]},{kind:'aggregate',operation:'sumifs',sources:[newSource()]}]:[{kind:'field',field_id:'',filters:[]},{kind:'field',field_id:'',filters:[]}]};
      const cfg=fieldDraft;const p=panel(mode==='budget'?'مصادر الرصيد الحالي':'إعداد الحساب');const grid=el('div','finance-config-grid');
      if(mode==='calculation')grid.append(field('عملية الحساب',select([['sum','جمع'],['subtract','طرح بالترتيب'],['multiply','ضرب'],['divide','قسمة بالترتيب'],['average','متوسط'],['count','عدد القيم'],['min','أصغر قيمة'],['max','أكبر قيمة'],['expression','صيغة متعددة العمليات']].map(([v,l])=>[v,T(l)]),cfg.operation,value=>{cfg.operation=value;renderField();})));
      const precision=field('المنازل العشرية',input(cfg.precision??2,value=>cfg.precision=Number(value),'number'));precision.dataset.compactFinancePrecision='';precision.lastChild.id='compact-finance-precision';precision.lastChild.min='0';precision.lastChild.max='12';precision.lastChild.step='1';grid.append(precision);p.body.append(grid);
      cfg.operands.forEach((o,index)=>{
        const removeOperand=()=>{if(cfg.operation==='expression'&&cfg.expression?.some(t=>t?.operand===index))throw Error(T('احذف هذا المصدر من الصيغة أولًا.'));cfg.operands.splice(index,1);if(cfg.expression)cfg.expression=cfg.expression.map(t=>t?.operand>index?{operand:t.operand-1}:t);renderField();};
        const opPanel=mode==='budget'?panel(index===0?'الدخل':'المصروف'):itemBox('finance-operand-item','حذف مصدر القيمة',removeOperand),head=el('div','finance-operand-grid');
        head.append(field('نوع المصدر',select([['field',T('حقل من السجل أو البطاقة')],['aggregate',T('تجميع من جدول بشروط')],['constant',T('قيمة ثابتة')]],o.kind,value=>{cfg.operands[index]=value==='aggregate'?{kind:value,operation:'sum',sources:[newSource()]}:value==='constant'?{kind:value,value:'0'}:{kind:value,field_id:'',filters:[]};renderField();})));
        opPanel.body.append(head);
        if(o.kind==='field'){
          head.append(field(cfg.operation==='count'?'الحقل المعدود':'الحقل العددي',select([['',T(cfg.operation==='count'?'اختر حقلًا':'اختر حقلًا عدديًا')],...fieldOptions(state.draftSchema,state.editingFieldCategoryId,cfg.operation!=='count',false,state.editingFieldId)],o.field_id,value=>o.field_id=value)));
          const filters=el('div');conditions(filters,o.filters||=[],localFields(state.editingFieldCategoryId),()=>{},o);opPanel.body.append(filters);
        }else if(o.kind==='constant'){head.append(field('القيمة',SCRecordChoices.numericConstant(o.value,value=>o.value=value)));}
        else{
          head.append(field('عملية التجميع',select(aggregateOptions(),o.operation,value=>{o.operation=value;renderField();})));
          const sh=el('div');sourceList(sh,o.sources,{aggregate:true,count:o.operation==='count'});opPanel.body.append(sh);
        }
        p.body.append(opPanel.root);
      });
      if(mode==='calculation')p.actions.append(button('إضافة مصدر قيمة',()=>{cfg.operands.push({kind:'field',field_id:'',filters:[]});renderField();},'plus'));
      if(cfg.operation==='expression')SCFieldRules.expressionEditor(p.body,cfg,renderField);
      p.body.append(el('p','muted-text',T('القيمة محسوبة للقراءة فقط. تُعاد الحسابات على الخادم عند حفظ السجل. لا تُحوّل العملات تلقائيًا.')));host.append(p.root);
    }else if(!['file','spacer','system_record_code','system_created_at','system_updated_at','user_name'].includes(type)&&ui!=='composed_text'){
      if(type==='number')host.append(check('حفظ عشري دقيق — مناسب للمبالغ',exactDraft,on=>exactDraft=on));
      if(fieldDraft&&fieldDraft.mode!=='lookup')fieldDraft=null;
      const p=panel('نسخ قيمة من سجل');p.body.append(check('أخذ القيمة من سجل في هذا التصميم أو تصميم آخر',fieldDraft?.mode==='lookup',on=>{fieldDraft=on?{mode:'lookup',schema_id:'',field_id:'',local_field_id:'$record_code',remote_field_id:'$record_code'}:null;renderField();}));
      if(fieldDraft?.mode==='lookup'){
        const cfg=fieldDraft,sc=schema(cfg.schema_id),grid=el('div','finance-config-grid');
        grid.append(field('التصميم المصدر',select(schemaOptions(),cfg.schema_id,value=>{cfg.schema_id=value;cfg.field_id='';cfg.remote_field_id='$record_code';renderField();})));
        grid.append(field('الحقل المراد نسخه',select([['',T('اختر حقلًا')],...pairs(sc).filter(({c,f})=>c.kind==='main'&&(f.type===type||['text','textarea'].includes(type))&&(!['spacer','field_group','file'].includes(f.type))&&(cfg.schema_id&&cfg.schema_id!==state.activeSchemaId||f.id!==state.editingFieldId)).map(({c,f})=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`])],cfg.field_id,value=>cfg.field_id=value)));
        grid.append(field('حقل المطابقة هنا',select([...sys(),...fieldOptions(state.draftSchema,state.editingFieldCategoryId,false,false,state.editingFieldId)],cfg.local_field_id,value=>cfg.local_field_id=value)));
        grid.append(field('حقل المطابقة في المصدر',select([...sys(),...fieldOptions(sc,'',false,true)],cfg.remote_field_id,value=>cfg.remote_field_id=value)));p.body.append(grid,el('p','muted-text',T('المطابقة المتعددة خطأ وليست اختيارًا تلقائيًا. عدم وجود تطابق يعطي قيمة فارغة.')));
      }
      host.append(p.root);
    }else fieldDraft=null;
    window.SCBuilderCompact?.routeFinanceField();
  }
  function collectField(){
    const ui=elements.fieldType.value,finance=['current_budget','calculation'].includes(ui);
    if(finance){
      const cfg=clone(fieldDraft);if(!cfg||cfg.operands.length<2)throw Error(T('اختر مصدرين على الأقل للحساب.'));
      for(const o of cfg.operands){if(o.kind==='constant')o.value=SCFieldLogic.constantNumber(o.value);if(o.kind==='field'&&!o.field_id)throw Error(T('اختر الحقل العددي لكل مصدر.'));if(o.kind==='aggregate'&&(!o.sources.length||o.sources.some(s=>!s.category_id||(o.operation!=='count'&&!s.value_field_id))))throw Error(T('أكمل جداول ومبالغ مصادر التجميع.'));}
      if(cfg.operation==='expression')SCFieldLogic.validateExpression(cfg.expression,cfg.operands.length);
      return {financial:cfg,exact_decimal:true};
    }
    if(fieldDraft?.mode==='lookup'){if(!fieldDraft.field_id)throw Error(T('اختر الحقل المراد نسخه.'));return {financial:clone(fieldDraft),...(selectedBuilderFieldType()==='number'&&exactDraft?{exact_decimal:true}:{})};}
    return selectedBuilderFieldType()==='number'&&exactDraft?{exact_decimal:true}:{};
  }
  function applyField(field,meta){delete field.financial;delete field.exact_decimal;Object.assign(field,meta);if(field.financial){field.auto_update=null;field.related_person_source_field_id=null;field.related_person_source_checkbox_id=null;if(field.type==='number')field.number_behavior={...field.number_behavior,storage_mode:'numeric',preserve_leading_zeros:false,allowed_special_characters:''};}}
  function remapOwner(owner,fieldMap,categoryMap=new Map()) {
    const convert=(obj)=>{
      if(Array.isArray(obj))return obj.map(convert);
      if(!obj||typeof obj!=='object')return obj;
      if(obj.schema_id&&obj.schema_id!==state.activeSchemaId){const result=clone(obj);if(result.local_field_id)result.local_field_id=fieldMap.get(result.local_field_id)||result.local_field_id;return result;}
      const out={};for(const [k,v] of Object.entries(obj)){
        if(['field_id','value_field_id','currency_field_id','local_field_id','remote_field_id'].includes(k)&&typeof v==='string')out[k]=fieldMap.get(v)||v;
        else if(k==='category_id')out[k]=categoryMap.get(v)||v;
        else if(k==='columns'&&Array.isArray(v)&&v.every(x=>typeof x==='string'))out[k]=v.map(x=>fieldMap.get(x)||x);
        else if(k==='fields'&&v&&typeof v==='object'&&!Array.isArray(v))out[k]=Object.fromEntries(Object.entries(v).map(([a,b])=>[a,fieldMap.get(b)||b]));
        else out[k]=convert(v);
      }return out;
    };
    for(const k of ['financial','view_table','table','record_options'])if(owner[k])owner[k]=convert(owner[k]);SCFieldRules.remap(owner,fieldMap,categoryMap);return owner;
  }
  function checkpoint(){return clone({fieldDraft,categoryDraft,exactDraft});}
  function restoreCheckpoint(value){fieldDraft=clone(value.fieldDraft);categoryDraft=clone(value.categoryDraft);exactDraft=value.exactDraft;}
  function setLookupEnabled(on){fieldDraft=on?(fieldDraft?.mode==='lookup'?fieldDraft:{mode:'lookup',schema_id:'',field_id:'',local_field_id:'$record_code',remote_field_id:'$record_code'}):null;renderField();}
  return {checkpoint,restoreCheckpoint,setLookupEnabled,remapOwner,T,clone,id,el,named,button,iconButton,select,input,field,check,panel,dialog,numeric,conditions,initCategory,renderCategory,collectCategory,initField,renderField,collectField,applyField,fetchSchemas,schemas,schema,fieldOptions,pairs};
})();
