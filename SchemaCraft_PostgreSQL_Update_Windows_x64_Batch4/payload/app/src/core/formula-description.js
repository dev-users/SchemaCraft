/* Display-only descriptions for the same typed AST used by the report engine. */
(() => {
'use strict';
const words = {"ar": {"count": "عدد الصفوف", "profile_count": "عدد الملفات المميزة", "nonempty": "عدد القيم غير الفارغة", "distinct": "عدد القيم المميزة", "sum": "المجموع", "average": "المتوسط", "min": "الأدنى", "max": "الأعلى", "median": "الوسيط", "profiles": "الملفات المحددة", "cards": "بطاقات الملفات المحددة", "current_cards": "بطاقات الملف الحالي", "current_profile": "الملف الحالي", "current_card": "البطاقة الحالية", "current_row": "الصف الحالي", "current_group": "المجموعة الحالية", "eq": "يساوي", "ne": "لا يساوي", "contains": "يحتوي", "includes": "يتضمن", "empty": "فارغ", "not_empty": "غير فارغ", "gt": "أكبر من", "gte": "أكبر أو يساوي", "lt": "أصغر من", "lte": "أصغر أو يساوي", "all": "و", "any": "أو", "where": "حيث", "exists": "توجد بطاقة", "parameter": "معامل", "field": "حقل غير محدد", "reference": "حساب مرجعي", "unknown": "حساب غير مكتمل", "age": "العمر بالسنوات المكتملة", "days": "فرق الأيام", "until": "حتى", "today": "تاريخ إنشاء التقرير", "true": "نعم", "false": "لا"}, "fa": {"count": "تعداد ردیف‌ها", "profile_count": "تعداد پرونده‌های یکتا", "nonempty": "تعداد مقادیر غیرخالی", "distinct": "تعداد مقادیر یکتا", "sum": "مجموع", "average": "میانگین", "min": "کمینه", "max": "بیشینه", "median": "میانه", "profiles": "پرونده‌های انتخاب‌شده", "cards": "کارت‌های پرونده‌های انتخاب‌شده", "current_cards": "کارت‌های پرونده جاری", "current_profile": "پرونده جاری", "current_card": "کارت جاری", "current_row": "ردیف جاری", "current_group": "گروه جاری", "eq": "برابر با", "ne": "نابرابر با", "contains": "شامل", "includes": "دارای", "empty": "خالی", "not_empty": "غیرخالی", "gt": "بزرگ‌تر از", "gte": "بزرگ‌تر یا مساوی", "lt": "کوچک‌تر از", "lte": "کوچک‌تر یا مساوی", "all": "و", "any": "یا", "where": "با شرط", "exists": "وجود کارت", "parameter": "پارامتر", "field": "فیلد انتخاب نشده", "reference": "محاسبه ارجاعی", "unknown": "محاسبه ناقص", "age": "سن بر حسب سال کامل", "days": "اختلاف روزها", "until": "تا", "today": "تاریخ ایجاد گزارش", "true": "بله", "false": "خیر"}};
function describe(calculation, schema={}, template={}, locale) {
  const i18n=window.SchemaCraftI18n, lang=locale||i18n?.language||'ar', w=words[lang]||words.ar;
  const word=k=> !(k in words.ar) ? undefined : lang === (i18n?.language||'ar') ? (i18n?.t(words.ar[k])||w[k]) : w[k];
  const categories=new Map((schema.categories||[]).map(c=>[c.id,c]));
  const fields=new Map([...(schema.categories||[]).flatMap(c=>c.fields||[]),...(schema.fields||[])].map(f=>[f.id,f]));
  const label=e=>i18n?.display(e||{},'label',lang)||e?.label||'';
  const ref=r=>label(fields.get(r?.field))||word('field');
  const parameter=id=>word('parameter')+' «'+(label((template.parameters||[]).find(p=>p.id===id))||id||'')+'»';
  const value=(v,r)=>v&&typeof v==='object'&&'parameter' in v?parameter(v.parameter):typeof v==='boolean'?word(String(v)):label((fields.get(r?.field)?.options||[]).find(o=>o.id===v))||String(v??'');
  function condition(n,depth=0) {
    if(!n||depth>12)return '';
    if(['all','any'].includes(n.kind))return(n.items||[]).map(c=>condition(c,depth+1)).filter(Boolean).map(c=>'('+c+')').join(' '+word(n.kind)+' ');
    if(n.kind==='exists')return word('exists')+' «'+label(categories.get(n.category))+'» '+condition(n.where,depth+1);
    if(n.kind==='rule')return ref(n.ref)+' '+(word(n.op)||n.op)+(['empty','not_empty'].includes(n.op)?'':' '+value(n.value,n.ref));
    return '';
  }
  function calc(c,stack=[],depth=0) {
    if(!c||depth>20)return word('unknown');
    if(c.kind==='literal')return String(c.value??'—');
    if(c.kind==='parameter')return parameter(c.id);
    if(c.kind==='ref') {const target=template.calculations?.[c.id];if(stack.includes(c.id)||!target)return word('reference');const detail=calc(target,[...stack,c.id],depth+1);return(target.title&&detail!==word('reference')?target.title+': ':'')+detail;}
    if(['add','subtract','multiply','ratio','percentage'].includes(c.kind)) {const exp='('+calc(c.left,stack,depth+1)+') '+({add:'+',subtract:'−',multiply:'×',ratio:'÷',percentage:'÷'}[c.kind])+' ('+calc(c.right,stack,depth+1)+')';return c.kind==='percentage'?'('+exp+') × 100':exp;}
    if(['age','days'].includes(c.kind))return word(c.kind)+': '+ref(c.ref)+' '+word('until')+' '+(c.end||word('today'));
    if(c.kind==='aggregate') {const source=c.source||{};let scope=word(source.kind||'profiles')||word('profiles');if(source.category)scope+=' «'+label(categories.get(source.category))+'»';let text=(word(c.op)||word('unknown'))+(['count','profile_count'].includes(c.op)?'':' «'+ref(c.ref)+'»')+' — '+scope;const where=condition(c.filter);if(where)text+='؛ '+word('where')+' '+where;return text;}
    return word('unknown');
  }
  return calc(calculation);
}
window.SchemaCraftFormula=Object.freeze({describe});
})();
