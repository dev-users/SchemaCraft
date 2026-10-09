/* One Escape dismisses one dialog: use opening order, never DOM order.
 * Dispatch cancel so unsaved-work / busy-operation guards still run. */
window.SCDialogStack = (() => {
  'use strict';
  if (window.SCDialogStack) return window.SCDialogStack;
  const stack = [], proto = window.HTMLDialogElement?.prototype;
  function forget(dialog) { const i = stack.indexOf(dialog); if (i >= 0) stack.splice(i, 1); }
  function opened(dialog) { forget(dialog); stack.push(dialog); }
  function top() {
    for (let i = stack.length - 1; i >= 0; --i) {
      if (stack[i].isConnected && stack[i].open) return stack[i];
      stack.splice(i, 1);
    }
    // Fallback for declarative, initially open dialogs (normal calls are tracked).
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    return dialogs.at(-1) || null;
  }
  function requestCloseTop() {
    const dialog = top(); if (!dialog) return false;
    const cancel = new Event('cancel', {cancelable: true, bubbles: false});
    if (dialog.dispatchEvent(cancel) && dialog.open) dialog.close();
    return true;
  }
  if (proto) {
    for (const method of ['show', 'showModal']) {
      const native = proto[method];
      if (typeof native !== 'function') continue;
      proto[method] = function (...args) {
        const wasOpen = this.open;
        const result = Reflect.apply(native, this, args);
        if (this.open && !wasOpen) opened(this);
        return result;
      };
    }
    const nativeClose = proto.close;
    proto.close = function (...args) {
      const result = Reflect.apply(nativeClose, this, args);
      if (!this.open) forget(this);
      return result;
    };
  }
  document.addEventListener('close', event => {
    // close is queued by the browser; a dialog can have reopened before it fires.
    if (event.target.tagName === 'DIALOG' && !event.target.open) forget(event.target);
  }, true);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || !top()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Holding Escape must not close each ancestor while the key repeats.
    if (!event.repeat) requestCloseTop();
  }, true);
  // Guard against accidental/native cancel dispatch to an underlying dialog.
  window.addEventListener('cancel', event => {
    if (event.target.tagName === 'DIALOG' && top() && event.target !== top()) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  return {top, requestCloseTop};
})();
