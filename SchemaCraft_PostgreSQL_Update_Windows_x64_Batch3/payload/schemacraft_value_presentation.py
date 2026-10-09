"""Transport and display only; never mutate a stored date, number or money value.

JSON uses ISO text for each date's already-normalized calendar representation.
Number grouping works on decimal text, not a lossy float conversion. Arithmetic,
matching and currency checks must always use the original unformatted values.
"""
from __future__ import annotations

import copy
import re
from datetime import date, datetime
from decimal import Decimal, localcontext, ROUND_HALF_UP
from typing import Any


def json_default(value: Any) -> str:
    """Allow the scalar types produced by validators, rejecting unknown objects."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal) and value.is_finite():
        return format(value, 'f')
    raise TypeError(f'Unsupported JSON value type: {type(value).__name__}')


def wire_value(value: Any) -> Any:
    if isinstance(value, (date, datetime, Decimal)):
        return json_default(value)
    if isinstance(value, dict):
        return {key: wire_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire_value(item) for item in value]
    return value


def field_format(field: dict) -> dict:
    """Small, shared presentation descriptor; no rules or internal lookup graph."""
    keys = ('type', 'label', 'i18n', 'number_behavior', 'number_display',
            'checkbox_true_label', 'checkbox_false_label', 'checkbox_checked_label',
            'checkbox_unchecked_label', 'checkbox_labels', 'options')
    return {key: copy.deepcopy(field[key]) for key in keys if key in field}


def format_number(value: Any, field: dict) -> str:
    if value is None or value == '':
        return ''
    if isinstance(value, bool):
        return str(value)
    text = str(wire_value(value)).translate(str.maketrans(
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫−', '01234567890123456789.-'))
    # Scientific notation in a validated numeric field is expanded exactly.
    # Numeric-looking text identifiers are never reinterpreted as exponents.
    if field.get('number_behavior', {}).get('storage_mode') != 'text' and re.fullmatch(
            r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d{1,2}', text):
        text = format(Decimal(text), 'f')
    if not re.fullmatch(r'[+-]?\d+(?:\.\d*)?', text):
        return text
    config = field.get('number_display') or {}
    places = config.get('decimal_places')
    if type(places) is int and 0 <= places <= 12 and field.get('number_behavior', {}).get('storage_mode') != 'text':
        with localcontext() as ctx:
            ctx.prec = max(64, len(text) + places + 4)
            text = format(Decimal(text).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP), 'f')
    whole, dot, fraction = text.partition('.')
    if field.get('number_behavior', {}).get('format_thousands'):
        whole = re.sub(r'\B(?=(\d{3})+(?!\d))', config.get('group_separator') or ',', whole)
    return whole + ((config.get('decimal_separator') or '.') + fraction if dot else '')


def display_value(field: dict, value: Any) -> str:
    # Import lazily; finance itself uses these presentation functions.
    from schemacraft_finance import label
    if field.get('type') == 'number':
        return format_number(value, field)
    return label(field, wire_value(value))
