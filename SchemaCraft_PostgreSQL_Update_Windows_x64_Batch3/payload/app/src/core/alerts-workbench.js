/* Alert condition authoring and live presentation. Plain text only; IDs are keys,
 * never labels. Filters/order/grouping are evaluated on the server before paging. */
window.SCAlertWorkbench = (() => {
  'use strict';
  const $=id=>document.getElementById(id),t=s=>scText(s),clone=x=>JSON.parse(JSON.stringify(x));
  let editingPriority=0, editingIcon='auto', activeFilters={};
  let formatModel={parts:[],separators:[],prefix:'',suffix:''};
  let extraKind='field', extraOwner={}, extraClauses=[], latest=null, layoutDraft=null, layoutSchema='', layoutItems=[];
  const collapsed=new Set(), expanded=new Set();let collapsedDefault=false, debounce=null, queryGeneration=0;
  const CONTENT_PARTS=['profile','rule','schema','message','cause','time'];
  const PART_LABELS={profile:'طريقة عرض السجل',rule:'عنوان التنبيه',schema:'اسم التصميم',message:'نص التنبيه',cause:'الحقل والقيمة المسببة',time:'وقت آخر تعديل'};
  const TOKENS={alert:'اسم التنبيه',message:'رسالة التنبيه',profile:'عنوان السجل',id:'معرّف السجل',schema:'اسم التصميم',field:'اسم الحقل',category:'اسم الفئة',value:'القيمة',date:'تاريخ الاستحقاق',edited:'وقت آخر تعديل',card:'البطاقة',remaining:'الأيام المتبقية'};
  const DEFAULT_LAYOUT={show_id:true,show_title:true,show_rule:true,show_schema:true,show_message:true,show_cause:true,show_time:false,show_icon:true,compact:false,profile_templates:{},content_order:CONTENT_PARTS,layout_mode:'stack',message_mode:'preserve',text_align:'start',icon_side:'left',title_size:'normal',text_size:'normal',line_spacing:'normal',padding:14,corner_radius:10,border_width:1,card_gap:10,heading_template:'{alert}',message_template:'{message}',use_content_template:false,card_template:'',icon_choice:'auto'};

  const CARD_PARTS=['profile','schema','message','cause','time'];
  const CARD_LABELS={profile:'طريقة عرض السجل',schema:'اسم التصميم',message:'رسالة التنبيه',cause:'الحقل والقيمة المسببة',time:'وقت آخر تعديل'};
  const PART_SWITCH={schema:'show_schema',message:'show_message',cause:'show_cause',time:'show_time'};
  function selectedParts(layout) {return (layout.content_order||CONTENT_PARTS).filter(key=>CARD_PARTS.includes(key)&&(key==='profile'?(layout.show_id||layout.show_title):layout[PART_SWITCH[key]]));}
  function cardTemplateNames(value) {return String(value||'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key&&CARD_LABELS[key]?'{'+t(CARD_LABELS[key])+'}':all);}
  function cardTemplateKeys(value) {const keys=new Map();for(const [key,label]of Object.entries(CARD_LABELS)){keys.set(key,key);keys.set(label,key);keys.set(t(label),key);}return String(value||'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key&&keys.has(key.trim())?'{'+keys.get(key.trim())+'}':all);}
  function validCardTemplate(value,layout) {
    const parts=[]; let end=0;const matches=String(value||'').matchAll(/\{\{|\}\}|\{([^{}]+)\}/g);
    for(const m of matches){if(/[{}]/.test(value.slice(end,m.index)))return false;if(m[1]!==undefined){if(!CARD_PARTS.includes(m[1]))return false;parts.push(m[1]);}end=m.index+m[0].length;}
    return !/[{}]/.test(value.slice(end)) && JSON.stringify(parts)===JSON.stringify(selectedParts(layout));
  }
  // Content tokens are DOM labels, not editable text. Only the separate
  // separator inputs accept typing/paste; the serialized textarea is readonly.
  function loadFormatModel(value,layout) {
    const wanted=selectedParts(layout),raw=String(value||'');
    const matches=[...raw.matchAll(/\{\{|\}\}|\{([^{}]+)\}/g)].filter(m=>m[1]!==undefined);
    if(validCardTemplate(raw,layout)&&matches.length){
      formatModel={parts:wanted,prefix:raw.slice(0,matches[0].index),suffix:raw.slice(matches.at(-1).index+matches.at(-1)[0].length),separators:matches.slice(1).map((m,i)=>raw.slice(matches[i].index+matches[i][0].length,m.index))};
    }else formatModel={parts:wanted,prefix:'',suffix:'',separators:wanted.slice(1).map(()=> '\n')};
    renderFormatEditor();captureText();
  }
  function syncCardTemplate(oldParts) {
    const wanted=selectedParts(layoutDraft.layout),old=formatModel.separators;
    formatModel={...formatModel,parts:wanted,separators:wanted.slice(1).map((_,i)=>old[i]??'\n')};
    renderFormatEditor();captureText();
  }
  function renderFormatEditor() {
    const host=$('alerts-content-format');host.replaceChildren();
    const text=literal=>literal.replaceAll('{{','{').replaceAll('}}','}');
    if(formatModel.prefix)host.append(node('span',text(formatModel.prefix),'alert-format-legacy-literal',true));
    formatModel.parts.forEach((key,index)=>{
      if(index){
        const separator=node('textarea','','control alert-format-separator');separator.rows=2;separator.maxLength=500;
        separator.value=text(formatModel.separators[index-1]||'');separator.dataset.separatorIndex=String(index-1);
        separator.setAttribute('aria-label',t('الفاصل بين')+' '+t(CARD_LABELS[formatModel.parts[index-1]])+' / '+t(CARD_LABELS[key]));
        separator.placeholder=t('فاصل أو مسافة أو سطر جديد');
        // Text may include punctuation and line breaks, but no field tokens.
        let previous=separator.value;
        separator.addEventListener('beforeinput',event=>{if(event.data&&/[{}]/.test(event.data)){event.preventDefault();$('alerts-layout-error').textContent=t('العناصر ثابتة؛ عدّل الفواصل بينها فقط.');}});
        separator.addEventListener('paste',event=>{if(/[{}]/.test(event.clipboardData?.getData('text/plain')||'')){event.preventDefault();$('alerts-layout-error').textContent=t('العناصر ثابتة؛ عدّل الفواصل بينها فقط.');}});
        separator.addEventListener('input',()=>{
          if(/[{}]/.test(separator.value)){separator.value=previous;return;}
          previous=separator.value;formatModel.separators[index-1]=previous;renderLayoutPreview();
        });
        host.append(separator);
      }
      const token=node('span',t(CARD_LABELS[key]),'alert-format-token');token.dataset.contentToken=key;token.setAttribute('draggable','false');token.setAttribute('aria-readonly','true');
      token.addEventListener('dragstart',event=>event.preventDefault());host.append(token);
    });
    if(formatModel.suffix)host.append(node('span',text(formatModel.suffix),'alert-format-legacy-literal',true));
    if(!formatModel.parts.length)host.append(node('small',t('اختر المحتوى من القائمة أعلاه.'),'muted-text'));
  }
  function selectedIcon(kind,choice='auto') {
    if(['auto','info','warning','error'].includes(choice))return SCAlerts.noticeIcon(choice==='auto'?kind:choice==='error'?'danger':choice);
    const paths={bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',calendar:'M4 5h16v16H4ZM8 2v6m8-6v6M4 11h16',document:'M5 2h10l4 4v16H5ZM14 2v6h5M8 12h8m-8 4h8',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v6l4 2',check:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM7 12l3 3 7-7'};
    const svg=SCAlerts.noticeIcon(kind);svg.querySelector('path').setAttribute('d',paths[choice]||paths.bell);return svg;
  }
  const FILTERS=[['schema','alerts-schema-filter','التصميم'],['rule_id','alerts-rule-filter','اسم التنبيه'],['field_exact','alerts-field-filter','اسم الحقل أو الفئة'],['profile','alerts-profile-filter','السجل — الاسم أو المعرّف'],['type','alerts-type-filter','النوع'],['operator','alerts-operator-filter','شرط التنبيه'],['pin','alerts-pin-filter','التثبيت'],['message','alerts-message-filter','رسالة توضيحية'],['from','alerts-from','آخر تعديل من'],['to','alerts-to','آخر تعديل إلى'],['due_from','alerts-due-from','تاريخ الاستحقاق من'],['due_to','alerts-due-to','تاريخ الاستحقاق إلى']];
  const node=(tag,text='',cls='',user=false)=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;if(user){n.dataset.i18nSkip='true';n.setAttribute('translate','no');}return n;};
  function btn(label,fn,icon='',danger=false){const b=node('button',icon?'':t(label),'button '+(danger?'button-danger-quiet':'button-secondary')+(icon?' workflow-icon-only':''));b.type='button';b.title=t(label);b.setAttribute('aria-label',t(label));if(icon){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','action-icon');s.setAttribute('aria-hidden','true');s.setAttribute('viewBox','0 0 24 24');if(['pin','copy'].includes(icon)){s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.8');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',icon==='pin'?'M8 3h8l-1 7 4 4v2h-6v5l-1 1-1-6H5v-2l4-4-1-7Z':'M8 7V3h12v14h-4M4 7h12v14H4Z');s.append(p);}else{const u=document.createElementNS(s.namespaceURI,'use');u.setAttribute('href','#icon-'+icon);s.append(u);}b.append(s);}b.onclick=fn;return b;}
  function subjects(){const list=[];for(const c of state.draftSchema?.categories||[]){if(c.kind==='repeatable')list.push({key:'category:'+c.id,id:c.id,kind:'category',owner:c,category:c,label:displayLabel(c)+' · '+t('عدد البطاقات')});for(const f of c.fields||[])if(SCAlerts.allowed(f).length)list.push({key:'field:'+f.id,id:f.id,kind:'field',owner:f,category:c,label:displayLabel(c)+' / '+displayLabel(f)});}return list;}
  function select(options,value,change){const s=node('select','','control');for(const [v,label] of options)s.append(new Option(label,v));s.value=value;if(!s.value&&options.length)s.value=options[0][0];s.onchange=()=>change(s.value);return s;}
  function labelled(label,input){const l=node('label','','field');l.append(node('span',t(label)),input);return l;}
  function renderRuleIcons(){
    const root=$('alert-rule-icons');root.replaceChildren();
    const choices=[['auto','تلقائي حسب النوع'],['info','معلومات'],['warning','تحذير'],['error','خطر'],['bell','جرس'],['calendar','تقويم'],['document','مستند'],['clock','ساعة'],['check','علامة تحقق']];
    for(const [key,label]of choices){
      const b=node('button','','button button-secondary alert-rule-icon-option');b.type='button';b.title=t(label);b.setAttribute('aria-label',t(label));b.setAttribute('role','radio');b.setAttribute('aria-checked',String(editingIcon===key));b.tabIndex=editingIcon===key?0:-1;b.dataset.ruleIcon=key;b.append(selectedIcon('info',key));
      b.onclick=()=>{editingIcon=key;renderRuleIcons();$('alert-icon-dropdown').open=false;$('alert-icon-trigger').focus();};
      b.onkeydown=event=>{const i=choices.findIndex(c=>c[0]===key);let next;
        if(['ArrowRight','ArrowDown'].includes(event.key))next=(i+1)%choices.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(i+choices.length-1)%choices.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=choices.length-1;else return;
        event.preventDefault();editingIcon=choices[next][0];renderRuleIcons();root.querySelector('[data-rule-icon="'+editingIcon+'"]').focus();};
      root.append(b);
    }
    $('alert-icon-selected').replaceChildren(selectedIcon('info',editingIcon));
    $('alert-icon-trigger').title=t(choices.find(c=>c[0]===editingIcon)?.[1]||'تلقائي حسب النوع');
  }
  function editExtras(rule,kind,owner){extraKind=kind;extraOwner=owner;extraClauses=clone(rule.conditions||[]);$('alert-condition-mode').value=rule.condition_mode||'all';$('alert-rule-auto-color').checked=!rule.color;$('alert-rule-color').value=rule.color||'#286ba3';$('alert-rule-color').disabled=!rule.color;editingPriority=Number(rule.priority)||0;editingIcon=rule.icon||'auto';$('alert-rule-hide-cause').checked=!!rule.hide_cause;renderRuleIcons();renderExtras();window.SCBuilderConditionPolish?.prepareAlert();}
  function renderExtras(){
    const root=$('alert-extra-conditions');root.replaceChildren();const available=subjects();
    extraClauses.forEach((clause,index)=>{
      const row=node('div','','alert-extra-row');row.dataset.clauseIndex=String(index);
      const target=available.find(s=>s.kind===clause.target_kind&&s.id===clause.target_id);
      const targets=[['',t('اختيار الحقل أو الفئة')],...available.map(s=>[s.key,s.label])];
      const source=select(targets,target?.key||'',value=>{const s=available.find(s=>s.key===value);extraClauses[index]=s?{target_kind:s.kind,target_id:s.id,operator:SCAlerts.allowed(s.owner,s.kind==='category')[0],scope:'any'}:{};renderExtras();});source.dataset.i18nSkip='true';row.append(labelled('مصدر الشرط',source));
      if(target){
        const ops=SCAlerts.allowed(target.owner,target.kind==='category');if(!ops.includes(clause.operator))clause.operator=ops[0];
        row.append(labelled('شرط التنبيه',select(ops.map(op=>[op,t(SCAlerts.LABELS[op])]),clause.operator,value=>{clause.operator=value;delete clause.value;renderExtras();})));
        const op=clause.operator;
        const valueInput=(key,label,typ='text',initial='')=>{const n=node('input','','control');n.type=typ;n.value=clause[key]??initial;n.maxLength=4000;if(typ==='number')n.step='any';n.oninput=()=>{clause[key]=['days','from_days','to_days','count_value'].includes(key)?(n.value===''?NaN:Number(n.value)):n.value;};row.append(labelled(label,n));if(clause[key]===undefined)clause[key]=['days','from_days','to_days','count_value'].includes(key)?Number(initial):initial;};
        const fieldCompare=target.kind==='field'&&['equals','not_equals','contains','gt','gte','lt','lte'].includes(op);
        if(fieldCompare){const toggle=SCFinance.check('مقارنة مع قيمة حقل آخر',!!clause.compare_field_id,on=>{clause.compare_field_id=on?(SCFieldRules.compareOptions(target.owner,target.category.id)[0]?.[0]||''):'';renderExtras();});row.append(toggle);if(clause.compare_field_id)row.append(labelled('الحقل المقارن',select([['',t('اختر حقلًا')],...SCFieldRules.compareOptions(target.owner,target.category.id)],clause.compare_field_id,v=>clause.compare_field_id=v)));}else delete clause.compare_field_id;
        if(clause.compare_field_id){}
        else if(op.startsWith('count_'))valueInput('value','عدد البطاقات','number',0);
        else if(['equals','not_equals','contains','gt','gte','lt','lte'].includes(op)){
          if(target.owner.type==='checkbox'){
            if(typeof clause.value!=='boolean')clause.value=true;
            row.append(labelled('القيمة',select([['true',t('محدد')],['false',t('غير محدد')]],String(clause.value),v=>clause.value=v==='true')));
          }else if(['select','checkbox_group','yes_no'].includes(target.owner.type)&&op!=='contains'){
            const options=(target.owner.options||[]).map(o=>[String(o.id),displayLabel(o)]);if(!options.some(o=>o[0]===clause.value))clause.value=options[0]?.[0]||'';
            const control=select(options,clause.value,v=>clause.value=v);control.dataset.i18nSkip='true';row.append(labelled('القيمة',control));
          }else valueInput('value','القيمة',target.owner.type==='number'&&target.owner.number_behavior?.storage_mode!=='text'?'number':target.owner.type==='date_gregorian'?'date':'text');
        }
        if(['due_soon','after_days'].includes(op))valueInput('days','عدد الأيام','number',14);
        if(op==='date_window'){valueInput('from_days','من إزاحة الأيام','number',-14);valueInput('to_days','إلى إزاحة الأيام','number',0);}
        if(target.kind==='field'&&target.category.kind==='repeatable'){
          const scopes=[['any',t('أي بطاقة')],['all',t('جميع البطاقات')],['matching_count',t('عدد البطاقات المطابقة')]];
          if(extraKind==='field'&&state.editingFieldCategoryId===target.category.id)scopes.push(['this_card',t('البطاقة نفسها')]);
          if(!scopes.some(o=>o[0]===clause.scope))clause.scope='any';
          row.append(labelled('نطاق البطاقات',select(scopes,clause.scope,v=>{clause.scope=v;renderExtras();})));
          if(clause.scope==='matching_count'){
            clause.count_operator ||= 'count_gte';row.append(labelled('مقارنة العدد',select(Object.entries(SCAlerts.LABELS).filter(([k])=>k.startsWith('count_')).map(([k,v])=>[k,t(v)]),clause.count_operator,v=>clause.count_operator=v)));valueInput('count_value','عدد البطاقات','number',1);
          }
        }else clause.scope='any';
      }
      const body=node('div','','builder-two-columns alert-clause-body');while(row.firstChild)body.append(row.firstChild);row.append(body);const remove=btn('حذف الشرط',()=>{extraClauses.splice(index,1);renderExtras();},'trash',true);remove.classList.add('alert-clause-delete');row.append(remove);root.append(row);
    });
  }
  function collectExtras(){
    const all=subjects();for(const clause of extraClauses){const s=all.find(s=>s.id===clause.target_id&&s.kind===clause.target_kind);if(!s)throw Error(t('اختر مصدرًا لكل شرط إضافي.'));SCAlerts.validateRule({...clause,name:'condition'},s.owner,s.kind==='category');if(clause.scope==='matching_count'&&(!Number.isInteger(clause.count_value)||clause.count_value<0||clause.count_value>1000000))throw Error(t('أدخل عدد بطاقات صحيحًا غير سالب.'));}
    return {conditions:clone(extraClauses),condition_mode:$('alert-condition-mode').value,color:$('alert-rule-auto-color').checked?'':$('alert-rule-color').value,priority:editingPriority,icon:editingIcon,hide_cause:$('alert-rule-hide-cause').checked};
  }
  function query(extra={}) {
    const result={view:'1',sort:$('alerts-sort')?.value||'type',direction:$('alerts-direction')?.value||'asc',group_by:$('alerts-group-by')?.value||'rule',...activeFilters};
    const q=$('alerts-query')?.value.trim(); if(q)result.q=q;
    return {...result,...extra};
  }
  async function api(body){return responseJson(await fetch('/api/alerts/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
  async function copyCode(code) {
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const input=node('textarea');input.value=code;input.style.position='fixed';input.style.opacity='0';
        const host=$('alerts-dialog')?.open?$('alerts-dialog'):document.body;host.append(input);input.select();
        try {if(!document.execCommand('copy'))throw Error(t('تعذّر النسخ'));} finally {input.remove();}
      }
      showToast(t('نُسخ معرّف السجل.'));
    } catch(_) {showToast(t('تعذّر النسخ؛ حدد معرّف السجل وانسخه يدويًا.'),'error');}
  }
  function appendCopyable(host,text,code) {
    const parts=code?String(text||'').split(code):[String(text||'')];
    parts.forEach((part,index)=>{
      if(index){const button=btn('نسخ معرّف السجل',event=>{event.stopPropagation();void copyCode(code);});button.textContent=code;button.dir='ltr';button.className='alert-copy-id';button.dataset.i18nSkip='true';button.onkeydown=event=>event.stopPropagation();host.append(button);}
      host.append(document.createTextNode(part));
    });
    return host;
  }
  const safeColor=value=>/^#[a-f0-9]{6}$/i.test(String(value||''))?value:'';
  function ruleColor(card,rule) {
    const color=safeColor(rule.color);if(!color)return;
    card.style.setProperty('--alert-border',color);card.style.setProperty('--alert-color',color);
    card.style.setProperty('--alert-fill',`color-mix(in srgb, ${color} 10%, var(--surface))`);
  }
  function templateNames(template) {
    return String(template??'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key!==undefined&&TOKENS[key]?'{'+t(TOKENS[key])+'}':all);
  }
  function templateKeys(template) {
    const map=new Map();for(const [key,label]of Object.entries(TOKENS)){map.set(label,key);map.set(t(label),key);map.set(key,key);}
    return String(template??'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key!==undefined&&map.has(key.trim())?'{'+map.get(key.trim())+'}':all);
  }
  function formatTemplate(template,values) {
    return String(template??'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>all==='{{'?'{':all==='}}'?'}':String(values[key]??''));
  }
  function renderCard(item,sourceLayout=latest?.layout||DEFAULT_LAYOUT,preview=false) {
    const layout={...DEFAULT_LAYOUT,...sourceLayout};const rule=item.rule||{};
    const kind=SCAlerts.noticeKind({...rule,items:[item]}),unassigned=rule.color_type==='unassigned';
    const card=node('article','','alert-live-card'+(unassigned?' alert-unassigned-line':'')+(layout.compact?' alert-card-compact':''));
    card.dataset.notice=kind;card.dataset.alertKey=item.key||'';ruleColor(card,rule);
    for(const [key,allowed]of Object.entries({layout_mode:['stack','inline','columns'],message_mode:['preserve','wrap','single'],text_align:['start','center','end'],icon_side:['left','right'],title_size:['small','normal','large'],text_size:['small','normal','large'],line_spacing:['tight','normal','relaxed']}))card.setAttribute('data-'+key.replaceAll('_','-'),allowed.includes(layout[key])?layout[key]:DEFAULT_LAYOUT[key]);
    for(const [key,low,high] of [['padding',6,28],['corner_radius',0,24],['border_width',1,3]])card.style.setProperty('--card-'+key.replaceAll('_','-'),Math.max(low,Math.min(high,Number(layout[key])||DEFAULT_LAYOUT[key]))+'px');
    // Zero-radius is intentional, unlike other values where zero is invalid.
    if(layout.corner_radius===0)card.style.setProperty('--card-corner-radius','0px');
    const body=node('div','','alert-card-copy');
    const profile=node('div','','alert-profile-line');profile.dataset.cardPart='profile';
    if(layout.show_id){const code=node('span','','alert-record-code',true);appendCopyable(code,item.record_code,item.record_code);profile.append(code);}
    if(layout.show_title){if(layout.use_content_template&&profile.childElementCount)profile.append(document.createTextNode(' · '));const title=node('strong','','alert-card-profile-title',true);appendCopyable(title,item.profile_display||item.record_title||(!layout.show_id?item.record_code:''),item.record_code);profile.append(title);}
    if(unassigned) {
      if(profile.childElementCount)body.append(profile);
      const file=node('span',item.value||'','alert-unassigned-name',true);file.title=[item.value,item.notes].filter(Boolean).join('\n');body.append(file);
    } else {
      const values={alert:rule.name||'',message:rule.message||'',profile:item.profile_display||item.record_title||'',id:item.record_code||'',schema:rule.schema_name||'',field:rule.field_name||'',category:rule.category_name||'',value:item.value??'',date:item.gregorian_date||'',edited:item.updated_at?formatRecordTimestamp(item.updated_at):'',card:item.card_name||'',remaining:item.days_remaining??''};
      const parts={profile:profile.childElementCount?profile:null};
      const heading=formatTemplate(layout.heading_template,values);
      if(layout.show_rule&&heading){parts.rule=node('strong','','alert-card-rule-name',true);appendCopyable(parts.rule,heading,item.record_code);}
      if(layout.show_schema&&rule.schema_name)parts.schema=node('small',rule.schema_name,'alert-card-schema',true);
      const message=layout.use_content_template?(rule.message||''):formatTemplate(layout.message_template,values);
      if(layout.show_message&&message){parts.message=node('p','','alert-card-message',true);appendCopyable(parts.message,message,item.record_code);parts.message.title=message;}
      if(layout.show_cause&&!(rule.hide_cause&&!!rule.message)){
        const cause=node('div','','alert-card-cause');
        const names=[...new Set([rule.category_name,rule.field_name,...(rule.condition_names||[])].filter(Boolean))];
        if(names.length)cause.append(node('small',names.join(' · '),'',true));
        const value=node('p','','alert-value');value.append(node('span',t(rule.field_id?'القيمة':'عدد البطاقات')+': '),node('span',String(item.value??'')||t('فارغة'),'',true));cause.append(value);
        if(item.days_remaining!==undefined)cause.append(node('small',t(item.days_remaining<0?'أيام بعد التاريخ':'الأيام المتبقية')+': '+Math.abs(item.days_remaining),'muted-text'));
        if(item.card_name)cause.append(node('small',t('البطاقة')+' '+item.card_name,'muted-text',true));parts.cause=cause;
      }
      if(layout.show_time&&item.updated_at)parts.time=node('small',formatRecordTimestamp(item.updated_at),'alert-card-time',true);
      if(layout.use_content_template){
        body.classList.add('alert-formatted-content');
        const template=String(layout.card_template||'');let end=0;
        for(const match of template.matchAll(/\{\{|\}\}|\{([^{}]+)\}/g)){
          body.append(document.createTextNode(template.slice(end,match.index)));
          if(match[0]==='{{'||match[0]==='}}')body.append(document.createTextNode(match[0][0]));
          else if(CARD_PARTS.includes(match[1])&&parts[match[1]]){parts[match[1]].dataset.cardPart=match[1];body.append(parts[match[1]]);}
          end=match.index+match[0].length;
        }
        body.append(document.createTextNode(template.slice(end)));
      }else{
        const order=Array.isArray(layout.content_order)?[...new Set([...layout.content_order,...CONTENT_PARTS])]:CONTENT_PARTS;
        for(const key of order)if(parts[key]){parts[key].dataset.cardPart=key;body.append(parts[key]);}
      }
    }
    const actions=node('div','','alert-card-actions');
    const pin=btn(item.pinned?'إلغاء التثبيت':'تثبيت التنبيه',async()=>{
      if(preview)return;pin.disabled=true;try{await api({action:'pin',key:item.key,pinned:!item.pinned});await SCAlerts.refresh(true);}catch(e){showToast(e.message,'error');}finally{pin.disabled=false;}
    },'pin');pin.setAttribute('aria-pressed',String(!!item.pinned));
    actions.append(pin,btn('فتح السجل',()=>{if(!preview)SCAlerts.openRecord(rule,item);},'open-record'));
    if(layout.show_icon)card.append(selectedIcon(kind,rule.icon||layout.icon_choice||'auto'));else card.classList.add('alert-no-notice-icon');
    card.append(body,actions);return card;
  }
  function paletteFor(group) {
    if(group.colors?.length)return group.colors;
    const colors=new Map();for(const item of group.items||[]){const r=item.rule||{},notice=SCAlerts.noticeKind({...r,items:[item]}),color=safeColor(r.color),key=[r.color_type,notice,color].join(':');const p=colors.get(key)||{type:r.color_type,notice,color,count:0};p.count++;colors.set(key,p);}return [...colors.values()];
  }
  function renderGroup(group) {
    const details=node('details','','alert-live-group alert-view-group');details.dataset.alertGroup=group.id;
    details.open=expanded.has(group.id)||(!collapsed.has(group.id)&&!collapsedDefault);
    const head=node('summary','','alert-live-heading'),title=node('h3','','',true);
    appendCopyable(title,group.name,group.profile_code);head.append(title);
    const palette=paletteFor(group);
    const fallback={danger:'#b12639',warning:'#995100',info:'#225cb0'};
    head.append(node('span',String(group.total),'alert-group-count'));
    if(palette.length){const shades=palette.map(item=>safeColor(item.color)||fallback[item.notice]||fallback.info);
      head.style.setProperty('--group-colors',shades.length===1?`linear-gradient(${shades[0]},${shades[0]})`:`linear-gradient(90deg,${shades.map((c,i)=>`${c} ${i*100/shades.length}%,${c} ${(i+1)*100/shades.length}%`).join(',')})`);
      details.dataset.mixedTypes=String(palette.length>1);
      if(palette.length===1){head.style.setProperty('--group-tint',`color-mix(in srgb, ${shades[0]} 7%, var(--surface))`);head.style.setProperty('--group-color',shades[0]);}
    }
    details.append(head);const cards=node('div','','alert-cards');group.items.forEach(item=>cards.append(renderCard(item)));details.append(cards);
    details.ontoggle=()=>{if(details.open){collapsed.delete(group.id);expanded.add(group.id);}else{collapsed.add(group.id);expanded.delete(group.id);}updateGroupToggle();};
    if(group.has_more){const more=btn('عرض المزيد',async()=>{
      more.disabled=true;const expected=queryGeneration;
      try{const data=await responseJson(await fetch('/api/alerts?'+new URLSearchParams(query({group:group.id,offset:String(cards.childElementCount)})),{cache:'no-store'}));if(expected!==queryGeneration)return;const current=data.groups[0];if(!current){void SCAlerts.refresh(true);return;}current.items.forEach(item=>cards.append(renderCard(item)));head.querySelector('.alert-group-count').textContent=String(current.total);if(!current.has_more)more.remove();}
      catch(e){showToast(e.message,'error');}finally{more.disabled=false;}
    });details.append(more);}
    return details;
  }
  function render(data) {
    latest=data;queryGeneration++;const root=$('alerts-groups');root.replaceChildren();
    root.style.setProperty('--alert-card-gap',Math.max(4,Math.min(24,Number(data.layout?.card_gap)||10))+'px');
    $('alerts-status').classList.remove('message-error');$('alerts-status').replaceChildren();const scanDate=node('bdi',data.date,'',true);scanDate.dir='ltr';const count=node('span',String(data.total),'alerts-header-count',true);count.setAttribute('aria-label',t('عدد التنبيهات')+': '+data.total);$('alerts-status').append(scanDate,document.createTextNode(' · '),count);
    const issue=$('alerts-issues');issue.hidden=!(data.unavailable_schemas?.length||data.skipped_values||data.layout_warnings?.length);issue.textContent=issue.hidden?'':t('بعض البيانات لم تُفحص؛ راجع التواريخ أو التصاميم غير المتاحة.');
    if(!data.groups?.length)root.append(node('p',t('لا توجد تنبيهات مطابقة للترشيح.'),'alerts-empty'));else data.groups.forEach(g=>root.append(renderGroup(g)));
    renderFilterChips();updateGroupToggle();
  }

  function openFilters() {
    const schemas=$('alerts-schema-filter');schemas.replaceChildren(new Option(t('كل التصاميم'),''));
    for(const item of latest?.filter_options?.schemas||[])schemas.append(new Option(item.label,item.id));
    const rules=$('alerts-rule-filter');rules.replaceChildren(new Option(t('الكل'),''));
    for(const item of latest?.filter_options?.rules||[])rules.append(new Option(item.label,item.id));
    const fields=$('alerts-field-filter');fields.replaceChildren(new Option(t('الكل'),''));
    for(const name of latest?.filter_options?.fields||[])fields.append(new Option(name,name));
    for(const [key,id]of FILTERS){const input=$(id);if(activeFilters[key]&&input.tagName==='SELECT'&&![...input.options].some(o=>o.value===activeFilters[key]))input.append(new Option(t('اختيار غير متاح'),activeFilters[key]));input.value=activeFilters[key]||'';}
    $('alerts-filter-error').textContent='';$('alerts-filters-dialog').showModal();
  }
  function applyFilters() {
    const draft={};for(const [key,id]of FILTERS){const value=$(id).value.trim();if(value)draft[key]=value;}
    if([['from','to'],['due_from','due_to']].some(([from,to])=>draft[from]&&draft[to]&&draft[from]>draft[to])){$('alerts-filter-error').textContent=t('بداية فترة الترشيح يجب أن تسبق نهايتها.');return;}
    activeFilters=draft;renderFilterChips();$('alerts-filters-dialog').close();void SCAlerts.refresh(true);
  }
  function filterText(key,value) {
    const id=FILTERS.find(f=>f[0]===key)?.[1],input=id?$(id):null;
    if(key==='rule_id')return latest?.filter_options?.rules?.find(r=>r.id===value)?.label||t('اختيار غير متاح');
    if(key==='schema')return latest?.filter_options?.schemas?.find(s=>s.id===value)?.label||t('تصميم غير متاح');
    if(input?.tagName==='SELECT')return [...input.options].find(o=>o.value===value)?.textContent||t('غير متاح');
    return value;
  }
  function renderFilterChips() {
    const root=$('alerts-filter-chips');root.replaceChildren();const entries=Object.entries(activeFilters).filter(([,v])=>v);
    $('alerts-applied-filters').hidden=!entries.length;$('alerts-filter-count').textContent=String(entries.length);
    for(const [key,value] of entries){const label=FILTERS.find(f=>f[0]===key)?.[2]||'';const chip=node('span','','selection-chip');chip.append(node('span',t(label)+': '+filterText(key,value),'',true));
      const remove=btn('إزالة المرشح',()=>{delete activeFilters[key];renderFilterChips();void SCAlerts.refresh(true);},'clear');chip.append(remove);root.append(chip);}
  }
  function schemas(){const rows=activeWorkspaceSchemas();return rows.length?rows:[{id:state.activeSchemaId||'',name:state.schema?.app?.title||t('التصميم')}];}
  function definition(id){return state.workspaceDefinitions?.[id]||state.schema;}
  function captureTemplate(){if(!layoutDraft)return;const raw=$('alerts-profile-template').value;layoutDraft.layout.profile_templates[layoutSchema]={template:SCDefinitionPicker.toKeys(raw,layoutItems)};}
  function loadTemplate(){layoutSchema=$('alerts-layout-schema').value;layoutItems=SCDefinitionPicker.mainItems(definition(layoutSchema));$('alerts-profile-template').value=SCDefinitionPicker.toNames(layoutDraft.layout.profile_templates[layoutSchema]?.template||'',layoutItems);renderLayoutPreview();}

  function layoutOptions() {
    const root=$('alerts-layout-options');root.replaceChildren();
    const row=node('div','','alert-design-order-row'),label=node('label','','check-field'),check=node('input');check.type='checkbox';check.checked=layoutDraft.layout.show_icon;check.dataset.layoutOption='show_icon';check.onchange=()=>{layoutDraft.layout.show_icon=check.checked;renderLayoutPreview();};label.append(check,node('span',t('إظهار أيقونة التنبيه')));row.append(label);root.append(row);
  }
  function movePart(key,delta){
    const order=layoutDraft.layout.content_order.filter(k=>CARD_PARTS.includes(k)),index=order.indexOf(key),old=selectedParts(layoutDraft.layout);
    if(index+delta<0||index+delta>=order.length)return;
    [order[index],order[index+delta]]=[order[index+delta],order[index]];layoutDraft.layout.content_order=[...order,'rule'];syncCardTemplate(old);renderOrder();renderLayoutPreview();
  }

  function renderOrder() {
    const root=$('alerts-content-order');root.replaceChildren();const order=layoutDraft.layout.content_order.filter(k=>CARD_PARTS.includes(k));
    order.forEach((key,index)=>{
      const row=node('div','','alert-design-order-row');row.dataset.contentPart=key;
      const choices=node('div','','alert-content-checks');
      const option=(switchKey,label)=>{const wrap=node('label','','check-field'),control=node('input');control.type='checkbox';control.checked=!!layoutDraft.layout[switchKey];control.dataset.layoutOption=switchKey;control.onchange=()=>{const old=selectedParts(layoutDraft.layout);layoutDraft.layout[switchKey]=control.checked;syncCardTemplate(old);renderLayoutPreview();};wrap.append(control,node('span',t(label)));return wrap;};
      if(key==='profile'){choices.append(option('show_id','معرّف السجل'),option('show_title','عنوان السجل أو القالب'));}else choices.append(option(PART_SWITCH[key],CARD_LABELS[key]));
      const controls=node('div','','compact-option-actions');
      for(const [delta,label,icon]of [[-1,'نقل الجزء لأعلى','up'],[1,'نقل الجزء لأسفل','down']]){const b=btn(label,()=>movePart(key,delta),icon);b.disabled=index+delta<0||index+delta>=order.length;controls.append(b);}row.append(choices,controls);root.append(row);
    });
  }

  function designerOptions() {
    const root=$('alerts-designer-options');root.replaceChildren();
    const choices=[['message_mode','التفاف المحتوى',[['preserve','الحفاظ على الأسطر'],['wrap','التفاف تلقائي للنص'],['single','سطر واحد مختصر']]],['text_align','محاذاة النص',[['start','البداية'],['center','الوسط'],['end','النهاية']]],['icon_side','موضع الأيقونة',[['left','اليسار'],['right','اليمين']]],['title_size','حجم اسم السجل',[['small','صغير'],['normal','عادي'],['large','كبير']]],['text_size','حجم النص',[['small','صغير'],['normal','عادي'],['large','كبير']]],['line_spacing','تباعد الأسطر',[['tight','متقارب'],['normal','عادي'],['relaxed','متباعد']]]];
    for(const [key,label,options] of choices){const control=select(options.map(([k,l])=>[k,t(l)]),layoutDraft.layout[key],v=>{layoutDraft.layout[key]=v;renderLayoutPreview();});control.dataset.designSetting=key;root.append(labelled(label,control));}
    for(const [key,label,low,high]of [['padding','المساحة الداخلية',6,28],['corner_radius','استدارة الزوايا',0,24],['border_width','سمك الإطار',1,3],['card_gap','المسافة بين البطاقات',4,24]]){const control=node('input','','control');control.type='number';control.min=low;control.max=high;control.step=1;control.value=layoutDraft.layout[key];control.dataset.designSetting=key;control.oninput=()=>{if(control.value!==''&&control.checkValidity()){layoutDraft.layout[key]=Number(control.value);renderLayoutPreview();}};root.append(labelled(label,control));}
    $('alerts-compact').checked=layoutDraft.layout.compact;$('alerts-compact').onchange=()=>{layoutDraft.layout.compact=$('alerts-compact').checked;renderLayoutPreview();};
    $('alerts-text-tokens').replaceChildren();
  }

  function captureText(){
    if(!layoutDraft)return;
    const value=formatModel.prefix+formatModel.parts.map((key,i)=>(i?(formatModel.separators[i-1]??'\n'):'')+'{'+key+'}').join('')+formatModel.suffix;
    layoutDraft.layout.card_template=value;$('alerts-message-template').value=cardTemplateNames(value);
  }

  function renderLayoutPreview() {
    if(!layoutDraft)return;captureTemplate();captureText();
    const sample={record_code:'A1234567',record_title:t('عنوان السجل'),profile_display:$('alerts-profile-template').value.replace(/\{([^{}]+)\}/g,(_,key)=>key===t('معرّف السجل')?'A1234567':key),key:'',updated_at:new Date().toISOString(),value:t('قيمة توضيحية'),gregorian_date:'2026-09-25',days_remaining:7,rule:{name:t('اسم التنبيه'),message:t('رسالة توضيحية للتنبيه تُكتب في إعداد التنبيه نفسه.'),schema_name:schemas().find(s=>s.id===layoutSchema)?.name||t('التصميم'),field_name:t('الحقل'),field_id:'sample',color_type:'value'}};
    const host=$('alerts-layout-preview');host.style.setProperty('--alert-card-gap',layoutDraft.layout.card_gap+'px');host.replaceChildren();
    for(const [type,label]of Object.entries(SCAlerts.TYPE_LABELS)){
      const example={...sample,value:type==='unassigned'?'passport.pdf':type==='count'?'0':sample.value,rule:{...sample.rule,name:t(label),color_type:type,icon:'auto',operator:type==='count'?'count_eq':''}};
      const heading=node('h4',t(label),'alert-preview-type-label');host.append(heading,renderCard(example,layoutDraft.layout,true));
    }
    $('alerts-layout-error').textContent=validCardTemplate(layoutDraft.layout.card_template,layoutDraft.layout)?'':t('تُضاف عناصر البطاقة وتُحذف وتُرتّب من القائمة. احتفظ بعناصر الصيغة كما هي وأضف الفواصل بينها فقط.');
  }
  async function openLayout() {
    if(!builderUnlocked())return;
    try{layoutDraft=clone(await responseJson(await fetch('/api/alerts/settings',{cache:'no-store'})));layoutDraft.layout={...clone(DEFAULT_LAYOUT),...layoutDraft.layout};
      const select=$('alerts-layout-schema');select.replaceChildren(...schemas().map(item=>new Option(displayLabel({name:item.name,i18n:definition(item.id)?.i18n},'name')||t('التصميم'),item.id)));select.value=state.activeSchemaId||select.options[0]?.value||'';
      if(!layoutDraft.layout.use_content_template)layoutDraft.layout.card_template=selectedParts(layoutDraft.layout).map(key=>'{'+key+'}').join('\n');
      layoutDraft.layout.use_content_template=true;layoutDraft.layout.show_rule=false;layoutDraft.layout.layout_mode='stack';
      loadFormatModel(layoutDraft.layout.card_template,layoutDraft.layout);
      layoutOptions();renderOrder();designerOptions();loadTemplate();$('alerts-layout-error').textContent='';$('alerts-layout-dialog').showModal();
    }catch(e){showToast(e.message,'error');}
  }
  async function saveLayout(){try{captureTemplate();captureText();if(!validCardTemplate(layoutDraft.layout.card_template,layoutDraft.layout))throw Error(t('تُضاف عناصر البطاقة وتُحذف وتُرتّب من القائمة. احتفظ بعناصر الصيغة كما هي وأضف الفواصل بينها فقط.'));$('alerts-layout-save').disabled=true;await api({action:'save',revision:layoutDraft.revision,layout:layoutDraft.layout});$('alerts-layout-dialog').close();if($('alerts-dialog').open)await SCAlerts.refresh(true);showToast(t('حُفظ تصميم بطاقات التنبيهات.'));}catch(e){$('alerts-layout-error').textContent=e.message;}finally{$('alerts-layout-save').disabled=false;}}

  function updateGroupToggle(){const button=$('alerts-toggle-groups');if(!button)return;const groups=[...$('alerts-groups').querySelectorAll(':scope > details')];const anyOpen=groups.some(g=>g.open);button.disabled=!groups.length;button.title=t(anyOpen?'طي المجموعات':'توسيع المجموعات');button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',String(anyOpen));button.querySelector('use').setAttribute('href','#icon-'+(anyOpen?'collapse':'expand'));}
  function toggleGroups(){const groups=[...$('alerts-groups').querySelectorAll(':scope > details')];const anyOpen=groups.some(g=>g.open);collapsedDefault=anyOpen;collapsed.clear();expanded.clear();for(const group of groups){group.open=!anyOpen;if(anyOpen)collapsed.add(group.dataset.alertGroup);else expanded.add(group.dataset.alertGroup);}updateGroupToggle();}
  function closeMenus(except=null){document.querySelectorAll('#alerts-dialog .alerts-menu[open]').forEach(menu=>{if(menu!==except)menu.open=false;});}
  function init() {
    $('alert-rule-auto-color').onchange=()=>{$('alert-rule-color').disabled=$('alert-rule-auto-color').checked;};
    $('alert-condition-add').onclick=()=>{if(extraClauses.length>=16)return showToast(t('الحد الأقصى 16 شرطًا إضافيًا لكل تنبيه.'),'error');extraClauses.push({target_kind:'field',target_id:'',scope:'any'});renderExtras();};
    for(const [type,label] of Object.entries(SCAlerts.TYPE_LABELS))$('alerts-type-filter').append(new Option(t(label),type));
    for(const [op,label]of Object.entries(SCAlerts.LABELS))$('alerts-operator-filter').append(new Option(t(label),op));$('alerts-operator-filter').append(new Option(t('مرفقات غير مسندة'),'unassigned'));
    for(const id of ['alerts-sort','alerts-direction','alerts-group-by'])$(id).onchange=()=>{if(id==='alerts-sort')$('alerts-direction').value=$('alerts-sort').value==='edited'?'desc':'asc';closeMenus();void SCAlerts.refresh(true);};
    $('alerts-query').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>SCAlerts.refresh(true),250);};
    $('alerts-filters-open').onclick=()=>{closeMenus();openFilters();};$('alerts-filters-apply').onclick=applyFilters;
    $('alerts-filters-clear').onclick=()=>{FILTERS.forEach(([,id])=>$(id).value='');$('alerts-filter-error').textContent='';};
    $('alerts-toggle-groups').onclick=toggleGroups;
    document.addEventListener('click',event=>{const menu=event.target.closest('#alerts-dialog .alerts-menu');closeMenus(menu);});
    $('alerts-dialog').addEventListener('cancel',event=>{if($('alerts-dialog').querySelector('.alerts-menu[open]')){event.preventDefault();closeMenus();}});
    for(const id of ['alerts-settings-open','global-alerts-settings-open'])$(id)?.addEventListener('click',event=>{event.stopPropagation();void openLayout();});$('alerts-layout-save').onclick=saveLayout;
    $('alerts-layout-schema').onchange=()=>{captureTemplate();loadTemplate();};$('alerts-profile-template').oninput=renderLayoutPreview;
    $('alerts-layout-fields').onclick=()=>SCDefinitionPicker.open({items:layoutItems,title:t('اختيار حقول السجل'),onSelect:ids=>SCDefinitionPicker.insert($('alerts-profile-template'),ids,layoutItems)});
  }
  init();return {editExtras,collectExtras,query,render,renderCard,openLayout,templateNames,templateKeys,formatTemplate,cardTemplateNames,cardTemplateKeys,validCardTemplate,selectedParts};
})();
