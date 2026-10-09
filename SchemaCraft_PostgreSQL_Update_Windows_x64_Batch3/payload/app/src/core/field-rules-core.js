/* Pure bounded field semantics shared by the native editors and entry controls. */
const SCFieldLogic = (() => {
  'use strict';
  const dates = new Set(['date_gregorian','date_persian','date_hijri']);
  const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length);
  const digits = v => String(v ?? '').replace(/[٠-٩۰-۹]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replaceAll('٫','.').replaceAll('−','-');
  const norm = v => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const numeric = f => f?.type === 'number' && f.number_behavior?.storage_mode !== 'text';
  function compatible(a,b) {
    if (!a || !b) return false;
    if(dates.has(a.type)||dates.has(b.type)) return dates.has(a.type)&&dates.has(b.type);
    if(numeric(a)||numeric(b)) return numeric(a)&&numeric(b);
    if(['checkbox','checkbox_group'].includes(a.type)||['checkbox','checkbox_group'].includes(b.type))return a.type===b.type;
    return ![a.type,b.type].some(t=>['file','spacer','field_group'].includes(t));
  }
  function gregDay(y,m,d) {
    const n=new Date(0); n.setUTCHours(0,0,0,0);n.setUTCFullYear(y,m-1,d);
    if(y<1||y>9999||n.getUTCFullYear()!==y||n.getUTCMonth()!==m-1||n.getUTCDate()!==d)throw Error('التاريخ غير صالح للتقويم المحدد.');
    return Math.floor(n.getTime()/86400000);
  }
  function persianStart(y) {
    if(y<1||y>3177)throw Error('التاريخ خارج نطاق التحويل.');
    const breaks=[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
    let previous=breaks[0],leap=-14,jump=0;for(const bound of breaks.slice(1)){jump=bound-previous;if(y<bound)break;leap+=Math.floor(jump/33)*8+Math.floor((jump%33)/4);previous=bound;}
    const n=y-previous;leap+=Math.floor(n/33)*8+Math.floor((n%33+3)/4);if(jump%33===4&&jump-n===4)leap++;
    const gy=y+621,lg=Math.floor(gy/4)-Math.floor((Math.floor(gy/100)+1)*3/4)-150;return gregDay(gy,3,20+leap-lg);
  }
  function parseDay(value,type) {
    const s=digits(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('التاريخ غير صالح للتقويم المحدد.');
    const [y,m,d]=s.split('-').map(Number);if(!dates.has(type)||m<1||m>12||y<1||d<1)throw Error('التاريخ غير صالح للتقويم المحدد.');
    if(type==='date_gregorian')return gregDay(y,m,d);
    if(type==='date_persian'){const start=persianStart(y),end=y<3177?persianStart(y+1):gregDay(3799,3,20),max=m<=6?31:m<12?30:end-start-336;if(d>max)throw Error('التاريخ غير صالح للتقويم المحدد.');return start+(m<=6?(m-1)*31:186+(m-7)*30)+d-1;}
    const leap=(11*y+14)%30<11;if(d>((m%2||m===12&&leap)?30:29))throw Error('التاريخ غير صالح للتقويم المحدد.');
    return 227015+(y-1)*354+Math.floor((3+11*y)/30)+Math.floor((59*(m-1)+1)/2)+d-1-719163;
  }
  const iso=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  function fromDay(day,type){
    if(type==='date_gregorian'){const d=new Date(day*86400000);const y=d.getUTCFullYear();if(y<1||y>9999)throw Error('التاريخ خارج نطاق التحويل.');return iso(y,d.getUTCMonth()+1,d.getUTCDate());}
    let lo=1,hi=type==='date_persian'?3176:9999;
    if(!dates.has(type)||day<parseDay(iso(1,1,1),type))throw Error('التاريخ خارج نطاق التحويل.');
    while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(parseDay(iso(mid,1,1),type)<=day)lo=mid;else hi=mid-1;}
    let m=1;while(m<12&&parseDay(iso(lo,m+1,1),type)<=day)m++;
    const result=iso(lo,m,day-parseDay(iso(lo,m,1),type)+1);if(parseDay(result,type)!==day)throw Error('التاريخ خارج نطاق التحويل.');return result;
  }
  function convert(value,source,target){return blank(value)?'':fromDay(parseDay(value,source),target);}
  function today(type,now=new Date()){return fromDay(gregDay(now.getFullYear(),now.getMonth()+1,now.getDate()),type);}
  function decimal(v){const m=digits(v).trim().match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d{1,2}))?$/);if(!m||String(v).length>100)throw Error('قيمة المقارنة الرقمية غير صالحة.');const [a,b='']=m[2].split('.');let scale=b.length-Number(m[3]||0),n=BigInt((a||'0')+b)*(m[1]==='-'?-1n:1n);if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,scale};}
  function numberCompare(a,b){a=decimal(a);b=decimal(b);const p=Math.max(a.scale,b.scale),x=a.n*10n**BigInt(p-a.scale),y=b.n*10n**BigInt(p-b.scale);return x===y?0:x<y?-1:1;}
  function canonical(value,f){if(f.type==='checkbox')return value===true||['true','1','yes','نعم','on'].includes(norm(value));return f.options?.find(o=>o.id===value)?.label??value;}
  function compare(a,b,fa,fb,operator){
    if(blank(a)||blank(b))return false;if(!compatible(fa,fb))return false;
    const op=({greater_than:'gt',greater_or_equal:'gte',less_than:'lt',less_or_equal:'lte',after:'gt',before:'lt',on_or_after:'gte',on_or_before:'lte'})[operator]||operator;
    let result;
    if(numeric(fa))result=numberCompare(a,b);
    else if(dates.has(fa.type)){a=parseDay(a,fa.type);b=parseDay(b,fb.type);result=a===b?0:a<b?-1:1;}
    else if(fa.type==='checkbox_group'){
      const list=(v,f)=>(Array.isArray(v)?v:String(v).split(' | ')).map(x=>norm(canonical(x,f)));
      const x=new Set(list(a,fa)),y=new Set(list(b,fb)),includes=[...y].every(v=>x.has(v));
      return ({equals:includes&&x.size===y.size,not_equals:!includes||x.size!==y.size,contains:includes,not_contains:!includes})[op]??false;
    }else{a=norm(canonical(a,fa));b=norm(canonical(b,fb));if(op==='contains')return a.includes(b);if(op==='not_contains')return !a.includes(b);result=a===b?0:a<b?-1:1;}
    return ({equals:result===0,not_equals:result!==0,gt:result>0,gte:result>=0,lt:result<0,lte:result<=0})[op]??false;
  }
  function formatNumber(value,field){
    if(blank(value))return '';const cfg=field.number_display||{};let raw=digits(value).replace(/[٬,]/g,'');if(field.number_behavior?.storage_mode==='text'&&/\s/.test(raw)&&!field.number_behavior?.format_thousands)return raw;raw=raw.replace(/\s/g,'');
    if(!/^[-+]?\d+(?:\.\d*)?$/.test(raw))return raw;
    const places=cfg.decimal_places;
    if(Number.isInteger(places)&&places>=0&&places<=12&&field.number_behavior?.storage_mode!=='text'){
      const d=decimal(raw),negative=raw.startsWith('-');let n=d.n<0n?-d.n:d.n;
      if(d.scale>places){const factor=10n**BigInt(d.scale-places);n=(n+factor/2n)/factor;}else n*=10n**BigInt(places-d.scale);
      const chars=n.toString().padStart(places+1,'0');raw=(negative?'-':'')+(places?chars.slice(0,-places)+'.'+chars.slice(-places):chars);
    }
    let [whole,fraction]=raw.split('.');if(field.number_behavior?.format_thousands)whole=whole.replace(/\B(?=(\d{3})+(?!\d))/g,cfg.group_separator||',');
    return whole+(fraction===undefined?'':(cfg.decimal_separator||'.')+fraction);
  }
  function initialValues(fields,existing={},now=new Date()){const values={...existing};for(const f of fields)if(!Object.hasOwn(values,f.id)){if(Object.hasOwn(f,'default_value'))values[f.id]=JSON.parse(JSON.stringify(f.default_value));else if(f.default_today&&dates.has(f.type))values[f.id]=today(f.type,now);}return values;}
  function constantNumber(value) {
    const text=digits(value).trim();
    if(text.length>80 || !/^[+-]?(?:\d+|\d{1,3}(?:[,٬]\d{3})+)(?:\.\d+)?$|^[+-]?\.\d+$/.test(text))throw Error('أدخل قيمة عددية فقط؛ الفواصل لتجميع الآلاف.');
    const raw=text.replace(/[,٬]/g,'');
    // Bound length without converting to binary floating point.
    if(raw.replace(/[^0-9]/g,'').length>28)throw Error('القيمة العددية تتجاوز الدقة المسموحة.');
    return raw;
  }
  function constantDisplay(value) {return formatNumber(constantNumber(value).replace(/^([+-]?)\./,'$10.'),{number_behavior:{format_thousands:true}});}
  function partialOption(value,options){const key=norm(value);if(!key)return null;const labels=o=>[o.label,...Object.values(o.i18n?.values||{}).map(v=>v?.label)].filter(Boolean);const exact=options.filter(o=>o.id===value||labels(o).some(l=>norm(l)===key));if(exact.length===1)return exact[0];if(exact.length>1)return null;const found=options.filter(o=>labels(o).some(l=>norm(l).includes(key)));return found.length===1?found[0]:null;}
  function sources(cfg){return cfg?.source_field_ids||[cfg?.source_field_id];}
  const token=tokens=>tokens.some(t=>t==null||t==='')?'':tokens.length===1?String(tokens[0]):JSON.stringify(tokens);
  function validateExpression(tokens, operandCount) {
    const functions=new Set(['sum','average','count','min','max']);
    const symbols=new Set(['+','-','*','/','(',')',',',...functions]);
    if(!Array.isArray(tokens)||!tokens.length||tokens.length>256)throw Error('أضف صيغة حساب صالحة؛ الحد الأقصى 256 عنصرًا.');
    for(const t of tokens){if(t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).length===1&&Object.hasOwn(t,'operand')){if(!Number.isInteger(t.operand)||t.operand<0||t.operand>=operandCount)throw Error('أحد مصادر صيغة الحساب محذوف أو غير صالح.');}else if(typeof t!=='string'||!symbols.has(t))throw Error('عنصر غير مسموح في صيغة الحساب.');}
    let pos=0,depth=0;const peek=()=>tokens[pos],take=()=>tokens[pos++];
    function expression(minimum){
      if(++depth>32)throw Error('تداخل صيغة الحساب يتجاوز الحد المسموح.');
      const t=take();
      if(t&&typeof t==='object'){}
      else if(t==='+'||t==='-')expression(30);
      else if(t==='('){expression(0);if(take()!==')')throw Error('أقواس صيغة الحساب غير متوازنة.');}
      else if(functions.has(t)){if(take()!=='(')throw Error('دالة الحساب تحتاج أقواسًا.');expression(0);while(peek()===','){take();expression(0);}if(take()!==')')throw Error('افصل معاملات الدالة بفواصل وأغلق الأقواس.');}
      else throw Error('صيغة الحساب غير مكتملة؛ اختر مصدر قيمة.');
      while(['+','-','*','/'].includes(peek())){const prec=['+','-'].includes(peek())?10:20;if(prec<minimum)break;take();expression(prec+1);}depth--;
    }
    expression(0);if(pos!==tokens.length)throw Error('الصيغة تحتاج عامل حساب بين المصادر أو أقواسًا متوازنة.');return true;
  }
  return {constantNumber,constantDisplay,validateExpression,dates,blank,digits,norm,numeric,compatible,parseDay,fromDay,convert,today,numberCompare,compare,formatNumber,initialValues,partialOption,sources,token};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SCFieldLogic;
