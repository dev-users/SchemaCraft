// One styled hover surface. Native titles are retained as accessible labels,
// but duplicate labels are only shown when text is clipped (or icon-only).
function installAppHoverCards() {
  const titles = new WeakMap();
  const surface = document.createElement('div');
  surface.id = 'app-hover-card';
  surface.className = 'app-hover-card';
  surface.setAttribute('role','tooltip');
  surface.setAttribute('popover','manual');
  surface.hidden = true;
  document.body.append(surface);
  let current = null, timer = null, previousDescription = null;
  const rememberTitle = node => {
    if (!(node instanceof Element) || !node.hasAttribute('title')) return;
    const title = node.getAttribute('title');
    if (title) titles.set(node, title);
    if (title && node.matches('button,a,input,select,textarea') && !node.textContent.trim() && !node.hasAttribute('aria-label')) node.setAttribute('aria-label',title);
    node.removeAttribute('title');
  };
  const scan = node => {
    if (!(node instanceof Element)) return;
    rememberTitle(node);
    node.querySelectorAll('[title]').forEach(rememberTitle);
  };
  scan(document.documentElement);
  new MutationObserver(records => records.forEach(record => {
    if (record.type === 'attributes') rememberTitle(record.target);
    else record.addedNodes.forEach(scan);
  })).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
  const hide = () => {
    clearTimeout(timer);
    if (current) {
      if (previousDescription === null) current.removeAttribute('aria-describedby');
      else current.setAttribute('aria-describedby',previousDescription);
    }
    current = null;
    try { surface.hidePopover?.(); } catch (_) {}
    surface.hidden = true;
  };
  const valueControl = node => node.matches('#record-form input.control:not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), #record-form select.control, #record-form textarea.control');
  const controlText = node => node.matches('select') ? [...node.selectedOptions].map(option => option.textContent).join('، ') : node.value;
  // Native inputs/selects do not consistently expose clipped text via scrollWidth.
  const textMeasure = document.createElement('span');
  textMeasure.setAttribute('aria-hidden', 'true');
  textMeasure.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;width:max-content;';
  document.body.append(textMeasure);
  const clipped = node => {
    if (!node.clientWidth) return false;
    if (valueControl(node) && !node.matches('textarea,select[multiple]')) {
      const style = getComputedStyle(node);
      const text = controlText(node) || '';
      if (text) {
        textMeasure.style.font = style.font || `${style.fontSize} ${style.fontFamily}`;
        textMeasure.style.letterSpacing = style.letterSpacing;
        textMeasure.style.textTransform = style.textTransform;
        textMeasure.textContent = text;
        const available = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (node.matches('select') ? 20 : 0);
        return textMeasure.getBoundingClientRect().width > available + 1;
      }
    }
    return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
  };
  const truncated = node => clipped(node) || [...node.querySelectorAll('span,strong,label,h1,h2,h3')].some(clipped);
  const hoverDisabled = target =>
    (['entry','builder','readonly'].includes(state.mode) && Boolean(target.closest('#category-navigator'))) ||
    Boolean(target.closest('[data-preview-select^="field:"]')) ||
    Boolean(target.closest('.builder-preview-selected') && !target.closest('[data-preview-actions]'));

  const show = target => {
    hide();
    if (!target?.isConnected || target.closest('[hidden],[inert]') || hoverDisabled(target)) return;
    rememberTitle(target);
    const card = target._categoryHoverCard?.() || target._fieldHoverCard?.() || target._chartHoverCard?.() || target._attachmentHoverCard?.();
    const text = (valueControl(target) ? controlText(target) : target.dataset.hoverLabel || (target.matches('input,textarea') ? target.value : target.textContent) || '').trim();
    const label = valueControl(target) ? text : target.dataset.hoverLabel || (text ? text : target.getAttribute('aria-label') || titles.get(target) || '');
    const iconOnly = !text && Boolean(label) && target.matches('button,a,[role="button"]');
    if (!card && (!label || (!truncated(target) && !iconOnly))) return;
    surface.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = card?.name || label;
    surface.append(title);
    surface.classList.toggle('app-hover-category',Boolean(card));
    if (card) {
      const details = document.createElement('p');
      details.textContent = card.details;
      surface.append(details);
      if (card.fields?.length) {
        const fields = document.createElement('ul');
        card.fields.forEach(name => { const item=document.createElement('li'); item.textContent=name; fields.append(item); });
        surface.append(fields);
      }
    }
    if (card?.metadata) {
      const list = document.createElement('dl');
      list.className = 'app-hover-metadata';
      for (const [label, value] of card.metadata) {
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = value;
        list.append(term, detail);
      }
      surface.append(list);
    }
    if (card?.legend) {
      const legend = document.createElement('div');
      legend.className = 'app-hover-chart-legend';
      for (const item of card.legend) {
        const row = document.createElement('div');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = item.color;
        const label = document.createElement('span');
        label.textContent = displayLabel(item);
        const count = document.createElement('b');
        count.textContent = `${item.count} (${item.percentage}%)`;
        row.append(swatch, label, count);
        legend.append(row);
      }
      surface.append(legend);
    }
    current = target;
    previousDescription = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [previousDescription,surface.id].filter(Boolean).join(' '));
    surface.hidden = false;
    if (!surface.showPopover) (target.closest("dialog[open]") || document.body).append(surface);
    try { surface.showPopover?.(); } catch (_) {}
    const bounds = target.getBoundingClientRect();
    const width = surface.offsetWidth || 280;
    const height = surface.offsetHeight || 80;
    surface.style.left = `${Math.max(8, Math.min(bounds.right-width,window.innerWidth-width-8))}px`;
    surface.style.top = `${Math.max(8, bounds.bottom+height+12 > window.innerHeight ? bounds.top-height-8 : bounds.bottom+8)}px`;
  };
  const candidate = target => {
    if (!(target instanceof Element) || hoverDisabled(target)) return null;
    const attachment = target.closest('.gallery-card, .attachment-control');
    if (attachment?._attachmentHoverCard && !target.closest('button')) return attachment;
    const chart = target.closest('.home-schema-chart-button');
    if (chart?._chartHoverCard) return chart;
    const name = target.closest('[data-preview-select]');
    if (name?._categoryHoverCard || name?._fieldHoverCard) return name;
    // Preview inputs are inert; their surrounding field owns the detail card.
    // Action buttons keep their own action labels.
    if (!target.closest('[data-preview-actions]')) {
      const field = target.closest('.builder-preview-field');
    if (field?._fieldHoverCard) return field;
    }
    if (valueControl(target)) return target;
    for (let node=target instanceof Element ? target : null; node && node !== document.body; node=node.parentElement) {
      if (node._categoryHoverCard || node._fieldHoverCard || node.dataset.hoverLabel || node.matches('button,a,label,h1,h2,h3,th,td,[role="button"]') || titles.has(node) || node.hasAttribute('title')) return node;
    }
    return null;
  };
  document.addEventListener('pointerover',event => {
    if (surface.contains(event.target)) { clearTimeout(timer); return; }
    const target = candidate(event.target);
    if (!target) { hide(); return; }
    if (target === current) return;
    clearTimeout(timer);
    timer=setTimeout(() => show(target),250);
  });
  document.addEventListener('pointerout',event => {
    if (current?.contains(event.relatedTarget) || surface.contains(event.relatedTarget)) return;
    clearTimeout(timer);
    timer=setTimeout(hide,100);
  });
  let pointerFocus = false;
  document.addEventListener('pointerdown',() => { pointerFocus = true; hide(); },true);
  document.addEventListener('keydown',() => { pointerFocus = false; },true);
  document.addEventListener('focusin',event => { if(pointerFocus)return;const target=candidate(event.target); if(target) show(target); });
  document.addEventListener('focusout',hide);
  document.addEventListener('input',event => { if (current === event.target) hide(); });
  document.addEventListener('keydown',event => { if(event.key === 'Escape') hide(); });
  document.addEventListener('scroll',event => { if(!surface.contains(event.target)) hide(); },true);
  window.addEventListener('resize',hide);
  return {show,hide,surface};
}
const appHoverCards = installAppHoverCards();
