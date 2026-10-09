/* Contextual controls for the original repeated row, never a duplicate table.
 * The same visual toolbar as history/Builder; mutations keep Save/Discard rules.
 */
const SCTransactionControls = (() => {
  'use strict';
  let active=null,menu=null,target=null;
  const T=text=>scText(text);
  function hide(refocus=false){
    const row=active?.row;
    if(row){row.classList.remove('transaction-row-selected');row.setAttribute('aria-expanded','false');}
    if(menu){if(menu.matches(':popover-open'))menu.hidePopover();menu.hidden=true;}
    active=null;
    if(refocus&&row?.isConnected)row.focus({preventScroll:true});
  }
  function getMenu(){
    if(menu)return menu;
    menu=document.createElement('div');menu.id='transaction-row-controls';menu.hidden=true;
    menu.className='search-history-context-controls history-context-controls transaction-row-controls';
    menu.setAttribute('role','toolbar');menu.setAttribute('aria-label',T('إجراءات الصف'));
    if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');
    document.body.append(menu);
    menu.addEventListener('keydown',event=>{
      const buttons=[...menu.querySelectorAll('button:not([disabled])')];
      if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&buttons.length){
        event.preventDefault();const index=buttons.indexOf(document.activeElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?1:buttons.length-1))%buttons.length].focus();
      }
    });
    document.addEventListener('pointerdown',event=>{
      if(active&&!menu.contains(event.target)&&!active.row.contains(event.target))hide();
    },true);
    // Capture before ordinary Escape handlers, but never consume an event meant
    // for a more recently opened modal confirmation.
    window.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||!active)return;
      const top=window.SCDialogStack?.top();
      if(top&&top!==active.dialog){hide();return;}
      event.preventDefault();event.stopImmediatePropagation();hide(true);
    },true);
    document.addEventListener('scroll',event=>{if(active&&!menu.contains(event.target))hide();},true);
    window.addEventListener('resize',()=>hide());
    new MutationObserver(()=>{if(active&&(!active.row.isConnected||!active.row.getClientRects().length))hide();}).observe(document.body,{childList:true,subtree:true});
    return menu;
  }
  function position(){
    if(!active?.row.isConnected)return hide();
    const r=active.row.getBoundingClientRect(),m=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(r.right-m.width,innerWidth-m.width-8))+'px';
    menu.style.top=(r.bottom+m.height+8<=innerHeight?r.bottom+3:Math.max(8,r.top-m.height-3))+'px';
  }
  function fill(actions){
    menu.replaceChildren();
    for(const button of actions()){
      button.addEventListener('click',()=>hide(true),true);menu.append(button);
    }
  }
  function toggle(row,actions,keyboard=false){
    if(active?.row===row)return hide();
    hide();const popup=getMenu();
    const top=window.SCDialogStack?.top();(top||document.body).append(popup);
    fill(actions);
    if(!popup.children.length)return;
    active={row,dialog:top};row.classList.add('transaction-row-selected');row.setAttribute('aria-expanded','true');
    popup.hidden=false;
    if(popup.hasAttribute('popover'))popup.showPopover();
    position();if(keyboard)popup.querySelector('button:not([disabled])')?.focus();
  }
  function prepare(row,actions){
    row.classList.add('transaction-context-row');row.tabIndex=0;
    row.setAttribute('aria-controls','transaction-row-controls');row.setAttribute('aria-expanded','false');
    row.title=T('اضغط لإظهار الإجراءات');
    row.addEventListener('click',event=>{if(!event.target.closest('button,a,input,select,textarea'))toggle(row,actions);});
    row.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target===row){event.preventDefault();toggle(row,actions,true);}});
    // Calculations/incoming-link reads can redraw the same table while the user
    // is choosing an action. Reattach by stable identity, not row position.
    if(active && active.row.dataset.financeCategory===row.dataset.financeCategory && active.row.dataset.financeChild===row.dataset.financeChild){
      active.row=row;row.classList.add('transaction-row-selected');row.setAttribute('aria-expanded','true');
      fill(actions);requestAnimationFrame(position);
    }
    if(target&&target.category===row.dataset.financeCategory&&target.child===row.dataset.financeChild)row.classList.add('transaction-linked-target');
  }
  function markTarget(category,child){
    target={category,child};document.querySelectorAll('.transaction-linked-target').forEach(n=>n.classList.remove('transaction-linked-target'));
    const row=[...document.querySelectorAll('tr[data-finance-child]')].find(n=>n.dataset.financeCategory===category&&n.dataset.financeChild===child);
    if(row){row.classList.add('transaction-linked-target');row.scrollIntoView({block:'nearest',inline:'nearest'});row.focus({preventScroll:true});}
    return row;
  }
  function reset(){hide();target=null;}
  function closeForEscape(top){if(active&&(!top||active.dialog===top)){hide(true);return true;}return false;}
  return {prepare,hide,reset,markTarget,closeForEscape};
})();
