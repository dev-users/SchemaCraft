/* Virtual categories export from the existing Export page and retain ordinary history/backups. */
const SCFinanceExports=(()=>{
 const {T,el,field,input,select,button}=SCFinance;
 let lastSchema='',chosen='',profile='',format='xlsx',destination='';
 function render(){
  const panel=document.getElementById('finance-export-view-panel'),host=document.getElementById('finance-export-view-controls');if(!panel||!host)return;
  const sid=selectedExportSchemaId(),schema=exchangeSchema(sid)||state.schema,views=(schema?.categories||[]).filter(c=>c.view_table);panel.hidden=!views.length;if(!views.length)return;
  if(lastSchema!==sid){lastSchema=sid;chosen='';destination='';profile=sid===state.activeSchemaId?(state.selectedRecordCode||''):'';}
  if(!views.some(c=>c.id===chosen))chosen=views[0].id;
  host.replaceChildren();const grid=el('div','finance-config-grid');grid.append(field('جدول العرض',select(views.map(c=>[c.id,displayLabel(c)]),chosen,v=>{chosen=v;})),field('معرّف السجل',input(profile,v=>profile=v)),field('صيغة التصدير',select([['xlsx','Excel'],['pdf','PDF']],format,v=>{format=v;destination='';render();})));host.append(grid);
  const status=el('p','muted-text');status.setAttribute('role','status');const location=el('p','muted-text');location.textContent=destination||T('لم يُحدّد مكان بعد.');
  host.append(el('p','muted-text',T('نسخة للقراءة فقط من البيانات المحفوظة وشروط التصميم. لا تشمل مرشحات الإدخال المؤقتة.')));
  const actions=el('div','finance-inline');actions.append(button('اختيار المكان',async()=>{const r=await fetch('/api/export/destination',{method:'POST',headers:exchangeHeaders(sid),body:JSON.stringify({type:'finance_view',format,schema_id:sid})}).then(responseJson);if(!r.cancelled){destination=r.destination;location.textContent=destination;}},'folder'),button('تصدير جدول العرض',async e=>{
    if(!profile.trim())throw Error(T('أدخل معرّف سجل محفوظ لجدول العرض.'));if(!destination)throw Error(T('اختر مكان الحفظ أولًا من الصفحة.'));
    const trigger=e.currentTarget;trigger.disabled=true;status.textContent=T('جارٍ إنشاء الملف…');try{const result=await fetch('/api/export/save',{method:'POST',headers:exchangeHeaders(sid),body:JSON.stringify({type:'finance_view',schema_id:sid,category_id:chosen,record_code:profile.trim(),format,destination})}).then(responseJson);if(result.ok){status.textContent=T('تم الحفظ')+' — '+result.filename;destination='';location.textContent=T('لم يُحدّد مكان بعد.');await loadExportHistory();}else status.textContent=T('أُلغي التصدير.');}catch(error){status.textContent=error.message;throw error;}finally{trigger.disabled=false;}
   },'download'));host.append(actions,location,status);
 }
 return {render};
})();
