/* Live saved-data alerts. User rule names/messages are never UI translations. */
const SCAlerts = (() => {
  'use strict';
  const drafts = {field: [], category: []};
  let editing = null, busy = false, timer = null, refreshTimer = null, lastTotal = null, pendingFull = false;
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const t = source => scText(source);
  const DATE_TYPES = ['date_gregorian', 'date_hijri', 'date_persian'];
  const LABELS = {
    empty:'القيمة فارغة', not_empty:'القيمة غير فارغة', equals:'القيمة تساوي', not_equals:'القيمة لا تساوي', contains:'القيمة تحتوي',
    gt:'أكبر من', gte:'أكبر من أو يساوي', lt:'أصغر من', lte:'أصغر من أو يساوي',
    expired:'انتهى التاريخ — بعد يومه', due_soon:'خلال عدد أيام قبل التاريخ — يشمل يومه', on_date:'في يوم التاريخ',
    after_days:'بعد التاريخ بعدد أيام أو أكثر', date_window:'ضمن فترة نسبية إلى التاريخ',
    count_eq:'عدد البطاقات يساوي', count_lt:'عدد البطاقات أقل من', count_lte:'عدد البطاقات أقل من أو يساوي',
    count_gt:'عدد البطاقات أكبر من', count_gte:'عدد البطاقات أكبر من أو يساوي',
  };
  const TYPE_LABELS = {unassigned:'مرفقات غير مسندة',missing:'قيم فارغة', value:'قيمة محددة', threshold:'حدود رقمية', expired:'تواريخ منتهية', date:'مواعيد وتواريخ', count:'عدد البطاقات'};
  function node(tag, text = '', cls = '') {
    const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text; return el;
  }
  function userNode(tag, text = '', cls = '') {
    const el = node(tag, text, cls); el.dataset.i18nSkip = 'true'; el.setAttribute('translate', 'no'); return el;
  }
  function button(label, action, icon = '', cls = 'button button-secondary') {
    const el = node('button', '', cls); el.type = 'button'; el.title = t(label); el.setAttribute('aria-label', t(label));
    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class','action-icon'); svg.setAttribute('aria-hidden','true');
      const use = document.createElementNS(svg.namespaceURI,'use'); use.setAttribute('href','#icon-'+icon); svg.append(use); el.append(svg);
    } else el.textContent = t(label);
    el.addEventListener('click', action); return el;
  }
  function owner(kind) {
    if (kind === 'category') return {kind: elements.categoryKind.value};
    const typ = selectedBuilderFieldType();
    let options = state.fieldOptionsDraft || [];
    if (['select','checkbox_group'].includes(typ) && !elements.optionFilterSource.value) options = reconcileFieldOptions();
    if (typ==='yes_no' && !options.length) options = [{id:'نعم',label:'نعم'},{id:'لا',label:'لا'}];
    return {id:state.editingFieldId,type: typ, options,record_options:SCRecordChoices.enabled()?{}:null, number_behavior: typ === 'number' ? collectNumberBehavior(typ) : {}};
  }
  function allowed(subject, category = false) {
    if (category) return subject.kind === 'repeatable' ? Object.keys(LABELS).filter(k=>k.startsWith('count_')) : [];
    if (['spacer','separator','horizontal_line','field_group'].includes(subject.type)) return [];
    const ops = ['empty','not_empty','equals','not_equals'];
    if (['text','textarea','select','checkbox_group','yes_no','user_name','file','system_record_code'].includes(subject.type)) ops.push('contains');
    if (subject.type === 'number' && subject.number_behavior?.storage_mode !== 'text') ops.push('gt','gte','lt','lte');
    if (DATE_TYPES.includes(subject.type)) ops.push('expired','due_soon','on_date','after_days','date_window','gt','gte','lt','lte');
    return ops;
  }
  function brief(rule) {
    const parts = [t(LABELS[rule.operator] || rule.operator)];
    if(rule.compare_field_id)parts.push(displayLabel(fieldById(rule.compare_field_id))||t('حقل محذوف'));
    if (Object.hasOwn(rule,'value')) {
      const subject = (typeof state!=='undefined' ? (state.draftSchema?.categories||[]).flatMap(c=>c.fields||[]).find(f=>(f.alerts||[]).some(r=>r.id===rule.id)) : null);
      const option = subject?.options?.find(o=>o.id===rule.value);
      parts.push(option ? displayLabel(option) : /^opt_[a-f0-9]+$/i.test(String(rule.value)) ? t('قيمة قائمة') : String(rule.value));
    }
    if(rule.conditions?.length)parts.push(`${t(rule.condition_mode==='any'?'أو':'و')} ${rule.conditions.length} ${t('شروط إضافية')}`);
    if (Object.hasOwn(rule,'days')) parts.push(String(rule.days));
    if (rule.operator === 'date_window') parts.push(`${rule.from_days} … ${rule.to_days}`);
    return parts.join(' · ');
  }
  function checkpoint(kind){return clone(drafts[kind]);}
  function restoreCheckpoint(kind, value){drafts[kind]=clone(value);renderDraft(kind);}
  function reset(kind, subject) { drafts[kind] = clone(subject?.alerts || []); renderDraft(kind); }
  function update(kind) {
    const panel = $(kind+'-alerts-panel'); if (!panel) return;
    const enabled = allowed(owner(kind), kind==='category').length > 0;
    panel.hidden = !enabled && !drafts[kind].length;
    $(kind+'-add-alert').disabled = !enabled;
  }
  function renderDraft(kind) {
    const list = $(kind+'-alerts-list'); if (!list) return;
    list.replaceChildren();
    if (!drafts[kind].length) list.append(node('p',t('لا يوجد تنبيهات لهذا العنصر'),'muted-text compact-empty-alerts'));
    drafts[kind].forEach(rule => {
      const row = node('div','','alert-rule-row');
      const desc = node('div','','alert-rule-description');
      desc.append(userNode('strong',displayLabel(rule,'name') || rule.name), node('small', brief(rule), 'muted-text'));
      if (rule.enabled === false) desc.append(node('small',t('غير مفعّل'),'muted-text'));
      const actions = node('div','','alert-rule-actions');
      actions.append(button('تعديل التنبيه',()=>openRule(kind,rule.id),'edit','button button-secondary workflow-icon-only'),
        button('حذف التنبيه',()=>{ drafts[kind] = drafts[kind].filter(r=>r.id!==rule.id); renderDraft(kind); },'trash','button button-danger-quiet workflow-icon-only'));
      row.append(desc,actions); list.append(row);
    });
    update(kind);
  }
  function openRule(kind, id = '') {
    if (!builderUnlocked() || window.SchemaCraftUITextEditor?.active) return;
    const subject = owner(kind), ops = allowed(subject,kind==='category');
    if (!ops.length) return;
    if (!id && drafts[kind].length >= 32) return showToast(t('الحد الأقصى 32 تنبيهًا لكل حقل أو فئة.'),'error');
    const rule = drafts[kind].find(r=>r.id===id) || {id: randomDefinitionId('alt'),name:'',message:'',operator:ops[0],enabled:true};
    editing = {kind,id:rule.id,subject,compare:rule.compare_field_id||''};
    window.SCAlertWorkbench?.editExtras(rule, kind, subject);
    $('alert-rule-name').value = rule.name;
    $('alert-rule-message').value = rule.message || '';
    $('alert-rule-enabled').checked = rule.enabled !== false;
    $('alert-rule-operator').replaceChildren(...ops.map(op=>new Option(t(LABELS[op]),op)));
    $('alert-rule-operator').value = ops.includes(rule.operator) ? rule.operator : ops[0];
    renderValue(rule);
    renderLanguageNameEditor($('alert-rule-language'),rule,[['name',t('اسم التنبيه')],['message',t('رسالة التنبيه')]],
      {name:()=>$('alert-rule-name').value,message:()=>$('alert-rule-message').value});
    SCAlertMessageFields.setup(rule, kind);
    window.SCBuilderConditionPolish?.prepareAlertLanguage();
    $('alert-rule-error').textContent = '';
    $('alert-rule-dialog').showModal(); $('alert-rule-name').focus();
  }
  function renderValue(rule = {}) {
    if (!editing) return;
    const subject = editing.subject, op = $('alert-rule-operator').value;
    const wrap = $('alert-rule-value-slot'); wrap.replaceChildren();
    if(editing.kind==='field'&&SCFieldRules.alertCompare(wrap,subject,{...rule,compare_field_id:editing.compare},v=>editing.compare=v,()=>renderValue(rule)))return;
    const input = (id,label,type,value) => {
      const row = node('label','','field'); row.append(node('span',t(label)));
      const el = node('input','','control'); el.id=id; el.type=type; el.value=value??'';
      if (type==='number') {el.step='any';el.dir='ltr';}
      row.append(el);wrap.append(row);return el;
    };
    if (op.startsWith('count_')) {const el=input('alert-rule-value','عدد البطاقات','number',rule.value??0);el.min='0';el.step='1';el.max='1000000';}
    else if (['equals','not_equals','contains','gt','gte','lt','lte'].includes(op)) {
      if (subject.type==='checkbox' || (['select','checkbox_group','yes_no'].includes(subject.type)&&!subject.record_options&&op!=='contains')) {
        const row=node('label','','field');row.append(node('span',t('القيمة')));const select=node('select','','control');select.id='alert-rule-value';
        const options=subject.type==='checkbox'?[{id:'true',label:t('محدد')},{id:'false',label:t('غير محدد')}]:subject.options;
        select.replaceChildren(...options.map(o=>new Option(o.label,String(o.id))));select.value=String(rule.value??options[0]?.id??'');row.append(select);wrap.append(row);
      } else {
        const typ=subject.type==='number'&&subject.number_behavior?.storage_mode!=='text'?'number':subject.type==='date_gregorian'?'date':'text';
        const el=input('alert-rule-value','القيمة',typ,rule.value??'');el.maxLength=4000;
        if (DATE_TYPES.includes(subject.type)) { el.dir='ltr';el.placeholder='YYYY-MM-DD';wrap.append(node('small',t('أدخل التاريخ بتقويم الحقل وبصيغة YYYY-MM-DD.'),'muted-text')); }
      }
    } else if (['due_soon','after_days'].includes(op)) {
      const el=input('alert-rule-days','عدد الأيام','number',rule.days??14);el.min='0';el.max='36500';el.step='1';
    } else if (op==='date_window') {
      for (const [id,label,value] of [['from','من إزاحة الأيام',rule.from_days??-14],['to','إلى إزاحة الأيام',rule.to_days??0]]) {
        const el=input('alert-rule-'+id,label,'number',value);el.min='-36500';el.max='36500';el.step='1';
      }
      wrap.append(node('p',t('السالب قبل التاريخ، والصفر في يومه، والموجب بعده. تشمل الفترة الطرفين.'),'muted-text'));
    }
    $('alert-calendar-note').hidden = !DATE_TYPES.includes(subject.type);
    $('alert-repeat-note').hidden = editing.kind !== 'category';
  }
  function validateRule(rule, subject, category = false) {
    if (!rule.name?.trim() || rule.name.length>160) throw Error(t('اسم التنبيه مطلوب وبحد أقصى 160 حرفًا.'));
    if (!allowed(subject,category).includes(rule.operator)) throw Error(t('شرط التنبيه لا يتوافق مع نوع الحقل أو الفئة.'));
    const op=rule.operator;
    if (!rule.compare_field_id&&['equals','not_equals','contains','gt','gte','lt','lte'].includes(op)&&String(rule.value??'').trim()==='') throw Error(t('أدخل قيمة للتنبيه.'));
    if (op.startsWith('count_')&&(String(rule.value??'').trim()===''||!Number.isInteger(Number(rule.value))||Number(rule.value)<0||Number(rule.value)>1000000)) throw Error(t('أدخل عدد بطاقات صحيحًا غير سالب.'));
    if (!rule.compare_field_id&&subject.type==='number'&&['gt','gte','lt','lte'].includes(op)&&!Number.isFinite(Number(rule.value))) throw Error(t('أدخل رقمًا صالحًا.'));
    if (['due_soon','after_days'].includes(op)&&(!Number.isInteger(rule.days)||rule.days<0||rule.days>36500)) throw Error(t('أدخل عدد أيام صحيحًا بين 0 و36500.'));
    if (op==='date_window'&&(!Number.isInteger(rule.from_days)||!Number.isInteger(rule.to_days)||rule.from_days < -36500||rule.to_days>36500||rule.from_days>rule.to_days)) throw Error(t('بداية فترة التنبيه يجب أن تسبق نهايتها.'));
    return rule;
  }
  function saveRule() {
    if (!editing) return;
    try {
      const rule={id:editing.id,name:$('alert-rule-name').value.trim(),message:$('alert-rule-message').value.trim(),enabled:$('alert-rule-enabled').checked,operator:$('alert-rule-operator').value,i18n:readLanguageNameEditor('alert-rule-language')};
      const op=rule.operator;
      if(editing.kind==='field'&&editing.compare&&['equals','not_equals','contains','gt','gte','lt','lte'].includes(op))rule.compare_field_id=editing.compare;
      if ($('alert-rule-value')) rule.value=editing.subject.type==='checkbox'?$('alert-rule-value').value==='true':$('alert-rule-value').value;
      if ($('alert-rule-days')) rule.days=$('alert-rule-days').value.trim()===''?NaN:Number($('alert-rule-days').value);
      if (op==='date_window') {rule.from_days=$('alert-rule-from').value.trim()===''?NaN:Number($('alert-rule-from').value);rule.to_days=$('alert-rule-to').value.trim()===''?NaN:Number($('alert-rule-to').value);}
      Object.assign(rule, window.SCAlertWorkbench?.collectExtras() || {});
      SCAlertMessageFields.collect(rule);
      validateRule(rule,editing.subject,editing.kind==='category');
      const index=drafts[editing.kind].findIndex(r=>r.id===rule.id);
      if(index<0) drafts[editing.kind].push(rule);else drafts[editing.kind][index]=rule;
      renderDraft(editing.kind);$('alert-rule-dialog').close();
    } catch(error) {$('alert-rule-error').textContent=error.message;}
  }
  function validateDraft(kind) { for(const rule of drafts[kind])validateRule(rule,owner(kind),kind==='category'); }
  function collect(kind) {validateDraft(kind);return clone(drafts[kind]);}
  function orderedBuilderRules() {
    const rows = [];
    for (const category of state.draftSchema?.categories || []) {
      for (const subject of [category, ...(category.fields || [])]) {
        for (const rule of subject.alerts || []) rows.push({category, subject, rule});
      }
    }
    // Stable sort retains existing row order for legacy rules with equal priority.
    return rows.sort((a, b) => (Number(b.rule.priority) || 0) - (Number(a.rule.priority) || 0));
  }
  function moveBuilderRule(id, step) {
    if (!builderUnlocked()) return;
    const rows = orderedBuilderRules(), index = rows.findIndex(item => item.rule.id === id);
    const next = index + step;
    if (index < 0 || next < 0 || next >= rows.length) return;
    [rows[index], rows[next]] = [rows[next], rows[index]];
    // Priority is an implementation detail, never a numeric user setting.
    // Schema validation limits total rules to 2000, so all ranks are distinct.
    rows.forEach((item, position) => { item.rule.priority = rows.length - position; });
    markDirty(); renderBuilder();
    const row = [...$('builder-alerts-list').children].find(el => el.dataset.alertRule === id);
    row?.querySelector('[data-move-alert="' + step + '"]:not(:disabled)')?.focus();
  }
  function renderBuilderList() {
    const list=$('builder-alerts-list'); if(!list)return;
    list.replaceChildren();
    const rows = orderedBuilderRules();
    rows.forEach(({category, subject, rule}, index) => {
      const row=node('div','','alert-rule-row'); row.dataset.alertRule=rule.id;
      const desc=node('div','','alert-rule-description');
      desc.append(userNode('strong',displayLabel(rule,'name')||rule.name),userNode('small',`${displayLabel(category)}${subject===category?'':' · '+displayLabel(subject)}`),node('small',brief(rule),'muted-text'));
      if(rule.enabled===false)desc.append(node('small',t('غير مفعّل'),'muted-text'));
      const actions=node('div','','alert-rule-actions builder-actions');
      for (const [step,label,icon] of [[-1,'رفع أولوية التنبيه','up'],[1,'خفض أولوية التنبيه','down']]) {
        const move=button(label,()=>moveBuilderRule(rule.id,step),icon,'button button-secondary workflow-icon-only');
        move.dataset.moveAlert=String(step);move.disabled=step<0?index===0:index===rows.length-1;actions.append(move);
      }
      actions.append(button('تعديل التنبيه',()=>{subject===category?openCategoryDialog(category.id):openFieldDialog(category.id,subject.id);openRule(subject===category?'category':'field',rule.id);},'edit','button button-secondary workflow-icon-only'),
        button('حذف التنبيه',async()=>{if(!builderUnlocked())return;if(!await requestConfirmation(t('هل تريد حذف هذا التنبيه من المسودة؟'),{title:t('حذف التنبيه'),confirmLabel:t('حذف')}))return;subject.alerts=(subject.alerts||[]).filter(r=>r.id!==rule.id);markDirty();renderBuilder();},'trash','button button-danger-quiet workflow-icon-only'));
      row.append(desc,actions); list.append(row);
    });
    if(!list.childElementCount)list.append(node('p',t('أضف التنبيهات من نافذة الحقل أو الفئة المتكررة.'),'muted-text'));
  }
  async function request(params = {}) {
    const response=await fetch('/api/alerts?'+new URLSearchParams(params),{cache:'no-store'});
    return responseJson(response);
  }
  function badge(data,failed = false) {
    const dot=$('alerts-indicator'), control=$('alerts-button');if(!dot||!control)return;
    if(failed) {control.dataset.alertStatus='error';control.title=t('تعذّر تحديث التنبيهات. اضغط للمحاولة.');return;}
    lastTotal=data.overall_total ?? data.total;dot.hidden=!(lastTotal>0);control.dataset.alertStatus=(data.unavailable_schemas?.length||data.skipped_values)?'partial':'ready';
    control.setAttribute('aria-label',`${t('التنبيهات')} · ${lastTotal}`);control.title=`${t('التنبيهات')} · ${lastTotal}`;
  }
  function active() {return typeof state!=='undefined' && state.schema && !window.SchemaCraftUITextEditor?.active && !state.startupIntent?.readonly && !$('audit-user-dialog')?.open;}
  async function refresh(full = false) {
    if(!active())return;
    if(busy){pendingFull ||= full;return;}
    busy=true;
    if(full)$('alerts-status').textContent=t('جارٍ فحص التنبيهات...');
    try {
      const data=await request(full?(window.SCAlertWorkbench?.query() || {}):{summary:'1'});badge(data);
      if(full){if(window.SCAlertWorkbench)window.SCAlertWorkbench.render(data);else renderLive(data);}
    } catch(error) {badge(null,true);if(full){$('alerts-status').textContent=error.message;$('alerts-status').classList.add('message-error');}}
    finally {busy=false;if(pendingFull){pendingFull=false;void refresh(true);}}
  }
  function schedule() {window.clearTimeout(refreshTimer);refreshTimer=window.setTimeout(()=>refresh($('alerts-dialog')?.open),700);}
  function renderLive(data) {
    const list=$('alerts-groups');list.replaceChildren();
    $('alerts-status').classList.remove('message-error');
    $('alerts-status').textContent=`${t('تنبيهات نشطة')}: ${data.total} · ${t('تاريخ الفحص')}: ${data.date}`;
    const issue=$('alerts-issues');issue.hidden=!(data.unavailable_schemas?.length||data.skipped_values);
    issue.textContent=issue.hidden?'':`${t('بعض البيانات لم تُفحص؛ راجع التواريخ أو التصاميم غير المتاحة.') } (${data.skipped_values||0} / ${data.unavailable_schemas?.length||0})`;
    if(!data.groups.length)list.append(node('p',t(issue.hidden?'لا توجد تنبيهات نشطة.':'لا توجد نتائج مؤكدة لهذا الفحص.'),'alerts-empty'));
    for(const group of data.groups)list.append(groupNode(group));
  }
  function noticeKind(group) {
    if (['missing', 'expired', 'unassigned'].includes(group.color_type)) return 'danger';
    if (group.color_type === 'date') return 'warning';
    if (group.color_type === 'count' && group.operator === 'count_eq' &&
        group.items?.length && group.items.every(item => Number(item.value) === 0)) return 'danger';
    return 'info';
  }
  function noticeIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'alert-notice-icon'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', kind === 'danger' ? 'M12 3 2.5 21h19L12 3ZM12 9v5m0 3v.1' :
      kind === 'warning' ? 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v6m0 3v.1' :
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6m0-10v.1');
    svg.append(path); return svg;
  }
  function groupNode(group) {
    const section=node('section','','alert-live-group');section.dataset.alertType=group.color_type;section.dataset.alertGroup=group.id;section.dataset.notice=noticeKind(group);
    const head=node('header','','alert-live-heading');head.append(userNode('h3',group.name),node('span',String(group.total),'alert-group-count'));
    const description=userNode('p',`${group.schema_name} · ${group.category_name}${group.field_name?' · '+group.field_name:''}`,'alert-live-origin');
    section.append(head,description,node('small',t(TYPE_LABELS[group.color_type]||'تنبيه'),'alert-type-caption'));
    const cards=node('div','','alert-cards');section.append(cards);
    appendCards(cards,group);
    if(group.has_more) {
      const more=button('عرض المزيد',async()=>{
        more.disabled=true;
        try {const data=await request({group:group.id,offset:String(cards.childElementCount)});const current=data.groups[0];
          if(!current){schedule();return;}
          appendCards(cards,current);head.querySelector('.alert-group-count').textContent=String(current.total);if(!current.has_more)more.remove();
        }catch(error){showToast(error.message,'error');}finally{more.disabled=false;}
      });section.append(more);
    }
    return section;
  }
  function appendCards(container,group) {
    for(const item of group.items) {
      const card=node('article','','alert-live-card');card.dataset.notice=noticeKind(group);
      const body=node('div','','alert-card-copy');body.append(userNode('strong',item.record_title||item.record_code));
      body.append(userNode('small',item.record_code,'alert-record-code'));
      if(item.message??group.message)body.append(userNode('p',item.message??group.message));
      const value=node('p','','alert-value');value.append(node('span',t(group.field_id?'القيمة':'عدد البطاقات')+': '),userNode('span',item.value||t('فارغة')));body.append(value);
      if(item.days_remaining!==undefined)body.append(node('small',item.days_remaining<0?`${t('أيام بعد التاريخ')}: ${-item.days_remaining}`:`${t('الأيام المتبقية')}: ${item.days_remaining}`,'muted-text'));
      if(item.child_id||item.parent_child_id)body.append(userNode('small',`${t(item.child_id?'البطاقة':'البطاقة الأم')}: ${item.child_id||item.parent_child_id}`,'muted-text'));
      const open=button('فتح السجل',()=>openRecord(group,item),'open-record','button button-secondary workflow-icon-only');
      card.append(noticeIcon(noticeKind(group)),body,open);container.append(card);
    }
  }
  async function openRecord(group,item) {
    if(hasUnsavedWorkspaceChanges())return showToast(t('احفظ التغييرات أو تجاهلها قبل فتح سجل التنبيه.'),'error');
    $('alerts-dialog').close();
    const ok=await switchActiveSchema(group.schema_id,{mode:'entry'});if(!ok)return;
    await performLoadRecord(item.record_code,{skipNavigationGuard:true});
    if (group.color_type === 'unassigned') elements.attachmentGallery?.scrollIntoView({block:'nearest'});
    // Opening always targets the live record, never a stale alert snapshot.
    if(group.category_id) {
      selectMainCategoryTab(group.category_id);
      const section=document.querySelector(`[data-entry-category="${CSS.escape(group.category_id)}"]`);
      section?.scrollIntoView({block:"nearest"});
    }
  }
  function open() {if(!active())return;$('alerts-dialog').showModal();void refresh(true);}
  function init() {
    for(const kind of ['field','category'])$(kind+'-add-alert')?.addEventListener('click',()=>openRule(kind));
    $('alert-rule-operator')?.addEventListener('change',()=>renderValue());
    $('alert-rule-save')?.addEventListener('click',saveRule);
    $('alerts-button')?.addEventListener('click',open);
    $('alerts-refresh')?.addEventListener('click',()=>refresh(true));
    elements.fieldType?.addEventListener('change',()=>update('field'));
    elements.categoryKind?.addEventListener('change',()=>update('category'));
    timer=window.setInterval(()=>refresh($('alerts-dialog')?.open),60000);
    window.setTimeout(()=>refresh(),2500);
    window.addEventListener('focus',schedule);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    document.addEventListener('schemacraft-data-changed',schedule);
  }
  return {checkpoint,restoreCheckpoint,init,reset,update,openRule,collect,validateDraft,renderBuilderList,orderedBuilderRules,moveBuilderRule,schedule,refresh,open,allowed,validateRule,brief,noticeKind,LABELS,TYPE_LABELS,noticeIcon,openRecord};
})();
