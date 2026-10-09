/* Local-only arithmetic. Token parser, not eval/Function or executable input. */
(function (root) {
  'use strict';
  const ERR = {
    input: 'أدخل عملية حسابية صحيحة.', limit: 'العملية أطول أو أعقد من الحد المسموح.',
    zero: 'لا يمكن القسمة على صفر.', real: 'لا توجد نتيجة حقيقية لهذه العملية.',
    range: 'النتيجة خارج النطاق العددي المدعوم.',
    values: 'أدخل أرقامًا صالحة فقط؛ لا يتم تجاهل القيم غير الصالحة.',
    empty: 'أدخل قيمة واحدة على الأقل.', many: 'الحد الأقصى 10000 قيمة.'
  };
  function digits(value) {
    return String(value).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
      .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/٫/g,'.').replace(/[−–]/g,'-');
  }
  function fail(key) { throw new Error(ERR[key]); }
  function finite(n) { if (Number.isNaN(n)) fail('real'); if (!Number.isFinite(n)) fail('range'); return Object.is(n,-0)?0:n; }
  function calculate(raw, answer=0) {
    if (String(raw).length>1000) fail('limit');
    const source=digits(raw).replace(/×/g,'*').replace(/÷/g,'/').replace(/π/g,'pi').replace(/√/g,'sqrt');
    const tokens=[]; let pos=0;
    while(pos<source.length){
      const rest=source.slice(pos); const ws=/^\s+/.exec(rest); if(ws){pos+=ws[0].length;continue;}
      const match=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|sqrt|ans|pi|[+\-*/^()%])/.exec(rest);
      if(!match)fail('input'); tokens.push(match[0]);pos+=match[0].length;if(tokens.length>256)fail('limit');
    }
    if(!tokens.length)fail('input');
    let index=0,depth=0;
    const peek=()=>tokens[index], eat=x=>peek()===x?(index++,true):false;
    function guarded(fn){if(++depth>64)fail('limit');try{return fn();}finally{depth--;}}
    function primary(){return guarded(()=>{
      if(eat('(')){const n=add();if(!eat(')'))fail('input');return n;}
      if(eat('sqrt')){if(!eat('('))fail('input');const n=add();if(!eat(')'))fail('input');if(n<0)fail('real');return finite(Math.sqrt(n));}
      if(eat('pi'))return Math.PI;if(eat('ans'))return finite(answer);
      const value=peek();if(!value||! /^(?:\d|\.)/.test(value))fail('input');index++;return finite(Number(value));
    });}
    function postfix(){let n=primary();while(eat('%'))n=finite(n/100);return n;}
    function power(){let n=postfix();if(eat('^')){const exponent=unary();if(n===0&&exponent<=0)fail(exponent===0?'real':'zero');n=finite(Math.pow(n,exponent));}return n;}
    function unary(){return guarded(()=>eat('+')?unary():eat('-')?finite(-unary()):power());}
    function multiply(){let n=unary();while(peek()==='*'||peek()==='/'){const op=tokens[index++],r=unary();if(op==='/'&&r===0)fail('zero');n=finite(op==='*'?n*r:n/r);}return n;}
    function add(){let n=multiply();while(peek()==='+'||peek()==='-'){const op=tokens[index++],r=multiply();n=finite(op==='+'?n+r:n-r);}return n;}
    const result=add();if(index!==tokens.length)fail('input');return finite(result);
  }
  function average(raw){
    if(String(raw).length>150000)fail('many');
    const input=digits(raw).trim();if(!input)fail('empty');
    const pieces=input.split(/[\s,،;؛]+/).filter(Boolean);if(pieces.length>10000)fail('many');
    const values=pieces.map(s=>{if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))fail('values');const n=Number(s);if(!Number.isFinite(n))fail('values');return n;});
    if(!values.length)fail('empty');
    const scale=Math.max(...values.map(Math.abs));let sum=0,correction=0;
    // Scale before summation to avoid overflow when the mean itself is finite.
    for(const n of values){const value=scale===0?0:n/scale,y=value-correction,t=sum+y;correction=(t-sum)-y;sum=t;}
    const mean=finite((sum/values.length)*scale),total=sum*scale;
    return {count:values.length,mean,total:Number.isFinite(total)?total:null,min:Math.min(...values),max:Math.max(...values)};
  }
  const GRADE_ERRORS = {
    rows: 'أضف درجة واحدة على الأقل.',
    many: 'الحد الأقصى 1000 درجة.',
    incomplete: 'أدخل الدرجة وحدها الأعلى في هذا الصف.',
    numeric: 'أدخل رقمًا صالحًا؛ استخدم النقطة أو ٫ للكسور.',
    maximum: 'الحد الأعلى يجب أن يكون أكبر من صفر.',
    score: 'الدرجة يجب أن تكون بين صفر وحدها الأعلى.',
    target: 'مقياس النتيجة يجب أن يكون رقمًا أكبر من صفر.',
    range: 'القيمة أو المجموع خارج النطاق العددي المدعوم.'
  };
  function gradeError(key, row = null, field = null) {
    const error = new Error(GRADE_ERRORS[key]);
    error.gradeCode = key; error.gradeRow = row; error.gradeField = field;
    throw error;
  }
  function gradeNumber(raw, row, field) {
    if (typeof raw !== 'string' && typeof raw !== 'number') gradeError('numeric', row, field);
    const text = digits(raw).trim();
    if (text.length > 64 || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) gradeError('numeric', row, field);
    const value = Number(text);
    if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(text.split(/[eE]/)[0]))) gradeError('range', row, field);
    return value;
  }
  // Total-points weighting: sum(earned) / sum(maximum) * requested scale.
  // A /60 assessment contributes three times as much as a /20 assessment.
  // This is deliberately NOT the equally weighted mean of percentages.
  function gradeAverage(rows, outOf = 20) {
    if (!Array.isArray(rows) || !rows.length) gradeError('rows');
    if (rows.length > 1000) gradeError('many');
    let target;
    try { target = gradeNumber(outOf, null, 'target'); } catch (_) { gradeError('target', null, 'target'); }
    if (target <= 0) gradeError('target', null, 'target');
    const clean = [];
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') gradeError('incomplete', index);
      const blankScore = row.score == null || String(row.score).trim() === '';
      const blankMax = row.maximum == null || String(row.maximum).trim() === '';
      if (blankScore && blankMax) return; // Unused blank rows are not zero grades.
      if (blankScore || blankMax) gradeError('incomplete', index, blankScore ? 'score' : 'maximum');
      const score = gradeNumber(row.score, index, 'score');
      const maximum = gradeNumber(row.maximum, index, 'maximum');
      if (maximum <= 0) gradeError('maximum', index, 'maximum');
      if (score > maximum) gradeError('score', index, 'score');
      clean.push({score, maximum});
    });
    if (!clean.length) gradeError('rows');
    // Kahan summation avoids needlessly losing low-order grade digits.
    function sum(key) {
      let total = 0, correction = 0;
      for (const row of clean) {
        const value = row[key] - correction, next = total + value;
        correction = (next - total) - value; total = next;
      }
      if (!Number.isFinite(total)) gradeError('range');
      return total;
    }
    const earned = sum('score'), possible = sum('maximum');
    const ratio = Math.min(1, Math.max(0, earned / possible));
    const mean = finite(ratio * target);
    return {count: clean.length, earned, possible, outOf: target, ratio, percentage: ratio * 100, mean};
  }
  function format(value){return String(Number(finite(value).toPrecision(15)));}
  const api={calculate,average,gradeAverage,digits,format,ERR,GRADE_ERRORS};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SCEntryMath=api;
})(typeof window!=='undefined'?window:null);
