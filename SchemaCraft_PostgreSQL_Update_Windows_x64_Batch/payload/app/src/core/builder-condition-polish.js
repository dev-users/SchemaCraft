/* Builder-only presentation helpers. These controls keep the existing rule,
 * schema, composition and draft collectors as the source of truth. */
const SCBuilderConditionPolish = (() => {
  'use strict';
  const COLORS=Object.freeze(['#286ba3','#dc2626','#d97706','#16a34a','#0d9488','#0284c7','#4f46e5','#9333ea','#db2777','#475569']);
  if(typeof document==='undefined')return {COLORS};
  const $=id=>document.getElementById(id),T=text=>scText(text);
  let languageSnapshot=null, messageSnapshot=null;
  const color=$('alert-rule-color'),automatic=$('alert-rule-auto-color');
  function refreshColor(){
    const value=color.value.toLowerCase(),auto=automatic.checked;
    color.disabled=false;
    const sample=$('alert-color-trigger').querySelector('.alert-color-sample');
    sample.style.background=auto?'linear-gradient(90deg,#286ba3 33%,#d97706 33% 66%,#dc2626 66%)':value;
    $('alert-color-trigger').title=auto?T('لون تلقائي حسب النوع'):value;
    $('alert-color-presets').querySelectorAll('[data-alert-color]').forEach(b=>{const selected=!auto&&b.dataset.alertColor===value;b.setAttribute('aria-checked',String(selected));b.classList.toggle('is-selected',selected);});
  }
  function chooseColor(value){color.value=value;automatic.checked=false;refreshColor();$('alert-color-dropdown').open=false;$('alert-color-trigger').focus();}
  function prepareAlert(){
    for(const id of ['alert-color-dropdown','alert-icon-dropdown'])$(id).open=false;
    refreshColor();
  }
  const palette=$('alert-color-presets');
  COLORS.forEach((value,index)=>{
    const b=document.createElement('button');b.type='button';b.className='alert-color-preset';b.dataset.noAutoIcon='';b.dataset.alertColor=value;b.style.background=value;b.setAttribute('role','radio');
    b.setAttribute('aria-label',T('لون')+' '+(index+1)+' — '+value);b.title=value;b.setAttribute('aria-checked','false');
    b.onclick=()=>chooseColor(value);
    b.onkeydown=event=>{let n=index;if(['ArrowRight','ArrowDown'].includes(event.key))n=(index+1)%COLORS.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))n=(index+COLORS.length-1)%COLORS.length;else if(event.key==='Home')n=0;else if(event.key==='End')n=COLORS.length-1;else return;event.preventDefault();palette.children[n].focus();};
    palette.append(b);
  });
  color.addEventListener('input',()=>{automatic.checked=false;refreshColor();});automatic.addEventListener('change',refreshColor);
  // Native details work without a global portal or trapping the parent dialog.
  // Escape inside a dropdown closes it, not the containing alert rule.
  for(const id of ['alert-color-dropdown','alert-icon-dropdown']){
    const dropdown=$(id);
    dropdown.addEventListener('toggle',()=>{
      dropdown.querySelector('summary').setAttribute('aria-expanded',String(dropdown.open));
      if(dropdown.open){const body=$('alert-rule-dialog').querySelector('.dialog-content'),popup=dropdown.querySelector('.builder-palette-popover,.alert-rule-icon-choices');dropdown.classList.remove('opens-up');const bounds=body.getBoundingClientRect(),anchor=dropdown.getBoundingClientRect();dropdown.classList.toggle('opens-up',bounds.bottom-anchor.bottom<popup.getBoundingClientRect().height+8&&anchor.top-bounds.top>popup.getBoundingClientRect().height+8);}
      if(dropdown.open)for(const other of ['alert-color-dropdown','alert-icon-dropdown'])if(other!==id)$(other).open=false;
    });
    dropdown.addEventListener('keydown',event=>{if(event.key==='Escape'&&dropdown.open){event.preventDefault();event.stopPropagation();dropdown.open=false;dropdown.querySelector('summary').focus();}});
  }
  // The central stack dispatches cancel on the newest dialog. An open visual
  // dropdown consumes that cancellation without closing its parent rule.
  $('alert-rule-dialog').addEventListener('cancel',event=>{
    const menu=$('alert-rule-dialog').querySelector('.builder-visual-dropdown[open]');
    if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}
  });
  document.addEventListener('click',event=>{for(const id of ['alert-color-dropdown','alert-icon-dropdown']){const d=$(id);if(d.open&&!d.contains(event.target))d.open=false;}});
  function languageSync(){const enabled=$('alert-rule-language').scLanguageEditor?.read()?.enabled===true;$('alert-rule-language-enabled').checked=enabled;$('alert-rule-language-open').hidden=!enabled;}
  function prepareAlertLanguage(){
    languageSnapshot=null;const root=$('alert-rule-language');root.querySelector('details').open=true;
    root.querySelector('.localized-names-toggle').hidden=true;root.querySelector('summary').hidden=true;
    // Names remain one-line inputs; messages keep their line breaks as textareas.
    for(const old of root.querySelectorAll('input[data-localized-property="message"]')){
      // Keep the native node/editor model: changing its tag would break read().
      old.classList.add('alert-language-message');
    }
    languageSync();
  }
  function openLanguage(enable){
    const root=$('alert-rule-language'),dialog=$('alert-rule-language-dialog');if(dialog.open)return;
    languageSnapshot=root.scLanguageEditor.read();messageSnapshot=SCAlertMessageFields.checkpoint();
    if(enable){const toggle=root.querySelector('[data-localized-names-enabled]');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));}
    root.querySelector('details').open=true;languageSync();dialog.showModal();root.querySelector('input:not([type=checkbox])')?.focus();
  }
  function closeLanguage(save){
    if(!save&&languageSnapshot){$('alert-rule-language').scLanguageEditor.restore(languageSnapshot);SCAlertMessageFields.restoreCheckpoint(messageSnapshot);}
    languageSnapshot=null;$('alert-rule-language-dialog').close();languageSync();$('alert-rule-language-open').focus();
  }
  $('alert-rule-language-enabled').addEventListener('change',e=>{
    if(e.target.checked)openLanguage(true);
    else{const toggle=$('alert-rule-language').querySelector('[data-localized-names-enabled]');toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));languageSync();}
  });
  $('alert-rule-language-open').onclick=()=>openLanguage(false);
  $('alert-language-save').onclick=()=>closeLanguage(true);
  for(const id of ['alert-language-close','alert-language-cancel'])$(id).onclick=()=>closeLanguage(false);
  $('alert-rule-language-dialog').addEventListener('cancel',event=>{event.preventDefault();closeLanguage(false);});
  $('alert-rule-language-dialog').addEventListener('close',()=>{if(languageSnapshot){$('alert-rule-language').scLanguageEditor.restore(languageSnapshot);SCAlertMessageFields.restoreCheckpoint(messageSnapshot);languageSnapshot=null;languageSync();}});
  $('alert-rule-dialog').addEventListener('close',()=>{if($('alert-rule-language-dialog').open)closeLanguage(false);});
  return {COLORS,prepareAlert,prepareAlertLanguage,refreshColor};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SCBuilderConditionPolish;
if(typeof window!=='undefined')window.SCBuilderConditionPolish=SCBuilderConditionPolish;
