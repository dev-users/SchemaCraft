"""Human-readable descriptions of typed report calculations (no evaluation).

The same AST drives the result and this description. Stable IDs resolve display
names; creating a description never changes records, formulas or stored values.
"""
from __future__ import annotations
from typing import Any
from schemacraft_i18n import display_text

WORDS = {
    'ar': {
        'count': 'عدد الصفوف', 'profile_count': 'عدد الملفات المميزة',
        'nonempty': 'عدد القيم غير الفارغة', 'distinct': 'عدد القيم المميزة',
        'sum': 'المجموع', 'average': 'المتوسط', 'min': 'الأدنى', 'max': 'الأعلى', 'median': 'الوسيط',
        'profiles': 'الملفات المحددة', 'cards': 'بطاقات الملفات المحددة',
        'current_cards': 'بطاقات الملف الحالي', 'current_profile': 'الملف الحالي',
        'current_card': 'البطاقة الحالية', 'current_row': 'الصف الحالي', 'current_group': 'المجموعة الحالية',
        'eq': 'يساوي', 'ne': 'لا يساوي', 'contains': 'يحتوي', 'includes': 'يتضمن',
        'empty': 'فارغ', 'not_empty': 'غير فارغ', 'gt': 'أكبر من', 'gte': 'أكبر أو يساوي',
        'lt': 'أصغر من', 'lte': 'أصغر أو يساوي', 'all': 'و', 'any': 'أو',
        'where': 'حيث', 'exists': 'توجد بطاقة', 'parameter': 'معامل',
        'field': 'حقل غير محدد', 'reference': 'حساب مرجعي', 'unknown': 'حساب غير مكتمل',
        'age': 'العمر بالسنوات المكتملة', 'days': 'فرق الأيام', 'until': 'حتى', 'today': 'تاريخ إنشاء التقرير',
        'true': 'نعم', 'false': 'لا',
    },
    'fa': {
        'count': 'تعداد ردیف‌ها', 'profile_count': 'تعداد پرونده‌های یکتا',
        'nonempty': 'تعداد مقادیر غیرخالی', 'distinct': 'تعداد مقادیر یکتا',
        'sum': 'مجموع', 'average': 'میانگین', 'min': 'کمینه', 'max': 'بیشینه', 'median': 'میانه',
        'profiles': 'پرونده‌های انتخاب‌شده', 'cards': 'کارت‌های پرونده‌های انتخاب‌شده',
        'current_cards': 'کارت‌های پرونده جاری', 'current_profile': 'پرونده جاری',
        'current_card': 'کارت جاری', 'current_row': 'ردیف جاری', 'current_group': 'گروه جاری',
        'eq': 'برابر با', 'ne': 'نابرابر با', 'contains': 'شامل', 'includes': 'دارای',
        'empty': 'خالی', 'not_empty': 'غیرخالی', 'gt': 'بزرگ‌تر از', 'gte': 'بزرگ‌تر یا مساوی',
        'lt': 'کوچک‌تر از', 'lte': 'کوچک‌تر یا مساوی', 'all': 'و', 'any': 'یا',
        'where': 'با شرط', 'exists': 'وجود کارت', 'parameter': 'پارامتر',
        'field': 'فیلد انتخاب نشده', 'reference': 'محاسبه ارجاعی', 'unknown': 'محاسبه ناقص',
        'age': 'سن بر حسب سال کامل', 'days': 'اختلاف روزها', 'until': 'تا', 'today': 'تاریخ ایجاد گزارش',
        'true': 'بله', 'false': 'خیر',
    },
}


def describe_calculation(calculation: Any, schema: dict, template: dict | None = None,
                         locale: str = 'ar') -> str:
    """Describe a calculation safely, including its operands, scope and filters."""
    locale = locale if locale in WORDS else 'ar'
    words = WORDS[locale]
    template = template or {}
    categories = {c['id']: c for c in schema.get('categories', [])}
    fields = {f['id']: f for c in categories.values() for f in c.get('fields', [])}
    # Also accept the flattened catalog supplied to the browser.
    fields.update({f['id']: f for f in schema.get('fields', [])})
    def label(entity): return display_text(entity, locale)
    def ref_name(ref): return label(fields.get((ref or {}).get('field'), {})) or words['field']
    def parameter(key):
        item = next((p for p in template.get('parameters', []) if p.get('id') == key), {})
        return words['parameter'] + ' «' + (label(item) or str(key or '')) + '»'
    def value_text(value, ref=None):
        if isinstance(value, dict) and 'parameter' in value: return parameter(value['parameter'])
        if isinstance(value, bool): return words[str(value).lower()]
        field = fields.get((ref or {}).get('field'), {})
        option = next((o for o in field.get('options', []) if o.get('id') == value), None)
        return label(option) if option else str(value if value is not None else '')
    def condition(node, depth=0):
        if not isinstance(node, dict) or depth > 12: return ''
        kind = node.get('kind')
        if kind in {'all', 'any'}:
            children = [condition(child, depth + 1) for child in node.get('items', [])]
            return (' ' + words[kind] + ' ').join('(' + child + ')' for child in children if child)
        if kind == 'exists':
            return words['exists'] + ' «' + label(categories.get(node.get('category'), {})) + '» ' + condition(node.get('where'), depth+1)
        if kind == 'rule':
            op = node.get('op', '')
            return (ref_name(node.get('ref')) + ' ' + words.get(op, str(op)) +
                    ('' if op in {'empty', 'not_empty'} else ' ' + value_text(node.get('value'), node.get('ref'))))
        return ''
    def describe(calc, stack=(), depth=0):
        if not isinstance(calc, dict) or depth > 20: return words['unknown']
        kind = calc.get('kind')
        if kind == 'literal': return str(calc.get('value', '—'))
        if kind == 'parameter': return parameter(calc.get('id'))
        if kind == 'ref':
            key = calc.get('id')
            if key in stack: return words['reference']
            target = template.get('calculations', {}).get(key)
            if not isinstance(target, dict): return words['reference']
            detail = describe(target, stack + (key,), depth + 1)
            # Do not add titles around a cycle marker.
            return (str(target.get('title')) + ': ' if target.get('title') and detail != words['reference'] else '') + detail
        if kind in {'add', 'subtract', 'multiply', 'ratio', 'percentage'}:
            left, right = describe(calc.get('left'), stack, depth+1), describe(calc.get('right'), stack, depth+1)
            symbol = {'add': '+', 'subtract': '−', 'multiply': '×', 'ratio': '÷', 'percentage': '÷'}[kind]
            expression = f'({left}) {symbol} ({right})'
            return '(' + expression + ') × 100' if kind == 'percentage' else expression
        if kind in {'age', 'days'}:
            return words[kind] + ': ' + ref_name(calc.get('ref')) + ' ' + words['until'] + ' ' + str(calc.get('end') or words['today'])
        if kind == 'aggregate':
            source = calc.get('source') or {}
            scope = words.get(source.get('kind', 'profiles'), words['profiles'])
            if source.get('category'): scope += ' «' + label(categories.get(source['category'], {})) + '»'
            expression = words.get(calc.get('op'), words['unknown'])
            if calc.get('op') not in {'count', 'profile_count'}: expression += ' «' + ref_name(calc.get('ref')) + '»'
            expression += ' — ' + scope
            where = condition(calc.get('filter'))
            if where: expression += '؛ ' + words['where'] + ' ' + where
            return expression
        return words['unknown']
    return describe(calculation)
