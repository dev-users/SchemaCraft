"""Single authoritative matching configuration on the source field.

Legacy category settings are read-only compatibility input. Once an owner field
is configured, even a disabled field setting overrides the legacy category.
No relationship is inferred from matching text or from a name-only suggestion.
"""
from __future__ import annotations

FIELD_KEY = 'transaction_linking'


def owners(category: dict) -> list[dict]:
    return [f for f in category.get('fields', []) if FIELD_KEY in f]


def owner(category: dict) -> dict | None:
    fields = owners(category)
    if len(fields) > 1:
        raise ValueError('اختر حقل مطابقة واحدًا لامتلاك إعداد ربط الحركة في الفئة.')
    return fields[0] if fields else None


def config(category: dict | None) -> dict:
    if not category:
        return {}
    field = owner(category)
    value = field.get(FIELD_KEY) if field is not None else category.get('profile_linking')
    return value if isinstance(value, dict) else {}


def has_config(category: dict) -> bool:
    return bool(owners(category)) or bool(category.get('profile_linking'))
