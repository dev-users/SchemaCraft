/* Pure display-input helpers. These resolve defaults only; they never change
 * record data, option identities, or the server's authoritative validation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SCBuilderValueControls=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const empty=value=>value==null||(typeof value==='string'&&!value.trim())||(Array.isArray(value)&&!value.length);
  const normalized=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();
  function resolveDefault(text,type,options=[],labels={}){
    if(empty(text))return {enabled:false,value:''};
    if(type==='checkbox'){
      const yes=['true','1','نعم','محدد','بله',labels.checked].filter(Boolean).map(normalized);
      const no=['false','0','لا','غير محدد','خیر',labels.unchecked].filter(Boolean).map(normalized);
      const v=normalized(text),a=yes.includes(v),b=no.includes(v);
      if(a===b)throw Error('boolean');
      return {enabled:true,value:a};
    }
    if(['select','yes_no'].includes(type)&&!labels.recordChoices){
      const exact=options.find(o=>o.id===String(text));
      if(exact)return {enabled:true,value:exact.id};
      const matches=options.filter(o=>[o.label,...(o.aliases||[])].some(v=>v!=null&&normalized(v)===normalized(text)));
      if(matches.length!==1)throw Error(matches.length?'ambiguous':'choice');
      return {enabled:true,value:matches[0].id};
    }
    return {enabled:true,value:text};
  }
  function defaultText(value,type,options=[],labels={}){
    if(empty(value))return '';
    if(type==='checkbox')return value===true||value==='true'?(labels.checked||'true'):(labels.unchecked||'false');
    if(['select','yes_no'].includes(type))return options.find(o=>o.id===value)?.display||options.find(o=>o.id===value)?.label||String(value);
    return String(value);
  }
  return {empty,resolveDefault,defaultText};
});
