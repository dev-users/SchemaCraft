/* UI-only operator adapter. It never rewrites stored rules on opening. */
const SCAppearanceCondition = (() => {
  'use strict';
  const LEGACY_PREFIX = '__preserved_not__:';
  function selection(condition) {
    const op = String(condition?.operator || '');
    return condition?.negate ? LEGACY_PREFIX + op : op;
  }
  function decode(value) {
    const key = String(value || '');
    const negate = key.startsWith(LEGACY_PREFIX);
    return { operator: negate ? key.slice(LEGACY_PREFIX.length) : key, negate };
  }
  function requiresValue(value) {
    return !['empty', 'not_empty'].includes(decode(value).operator);
  }
  return { LEGACY_PREFIX, selection, decode, requiresValue };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SCAppearanceCondition;
