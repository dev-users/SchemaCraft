"""Read-only calendar/conversion and a paged due-date view of existing alerts.

Persian dates deliberately use the same Jalaali year-start calculation as the
alert evaluator. No record, preference or workbook is changed by these helpers.
"""
from __future__ import annotations

import calendar as gregorian_calendar
import re
from collections import Counter
from datetime import date, timedelta
from typing import Any

import schemacraft_alerts as Alerts


class ToolError(ValueError):
    """A safe, translatable input error."""


MIN_DAY = Alerts._persian_start(1)
MAX_DAY = Alerts._persian_start(3177) - timedelta(days=1)
SYSTEMS = {"gregorian", "persian"}


def integer(value: Any, low: int, high: int) -> int:
    raw = str(value).strip().translate(Alerts.DIGITS)
    if not re.fullmatch(r"\d{1,8}", raw) or not low <= int(raw) <= high:
        raise ToolError("أدخل سنة وشهرًا ويومًا صحيحًا ضمن النطاق المدعوم.")
    return int(raw)


def check_system(system: str) -> str:
    if system not in SYSTEMS:
        raise ToolError("اختر التقويم الميلادي أو الشمسي الفارسي.")
    return system


def persian_parts(day: date) -> tuple[int, int, int]:
    if not MIN_DAY <= day <= MAX_DAY:
        raise ToolError("التاريخ خارج نطاق التحويل: السنوات الشمسية من 1 إلى 3176.")
    year = min(day.year - 621, 3176)
    if day < Alerts._persian_start(year):
        year -= 1
    offset = (day - Alerts._persian_start(year)).days
    if offset < 186:
        return year, offset // 31 + 1, offset % 31 + 1
    offset -= 186
    return year, offset // 30 + 7, offset % 30 + 1


def parts(day: date, system: str) -> tuple[int, int, int]:
    check_system(system)
    return (day.year, day.month, day.day) if system == "gregorian" else persian_parts(day)


def iso(values: tuple[int, int, int]) -> str:
    return f"{values[0]:04d}-{values[1]:02d}-{values[2]:02d}"


def parse_day(system: str, year: Any, month: Any, day: Any) -> date:
    check_system(system)
    y, m, d = integer(year, 1, 9999), integer(month, 1, 12), integer(day, 1, 31)
    try:
        if system == "persian" and y > 3176:
            raise ToolError("التاريخ خارج نطاق التحويل: السنوات الشمسية من 1 إلى 3176.")
        result = Alerts.day_value(iso((y, m, d)), "date_" + system)
    except (ValueError, OverflowError) as exc:
        if isinstance(exc, ToolError):
            raise
        raise ToolError("التاريخ غير صالح لهذا الشهر أو لهذه السنة.") from None
    persian_parts(result)  # validate the shared conversion range
    return result


def conversion(system: str, year: Any, month: Any, day: Any) -> dict:
    result = parse_day(system, year, month, day)
    p = persian_parts(result)
    return {"gregorian": result.isoformat(), "persian": iso(p),
            "gregorian_parts": [result.year, result.month, result.day],
            "persian_parts": list(p), "weekday": (result.weekday() + 2) % 7}


def month_window(system: str, year: int, month: int) -> tuple[date, date]:
    check_system(system)
    y, m = integer(year, 1, 9999), integer(month, 1, 12)
    if system == "gregorian":
        first = date(y, m, 1)
        last = date(y, m, gregorian_calendar.monthrange(y, m)[1])
    else:
        if y > 3176:
            raise ToolError("التاريخ خارج نطاق التحويل: السنوات الشمسية من 1 إلى 3176.")
        first = parse_day(system, y, m, 1)
        last = (Alerts._persian_start(y+1) if m == 12 else parse_day(system, y, m+1, 1)) - timedelta(days=1)
    if first < MIN_DAY or last > MAX_DAY:
        raise ToolError("الشهر خارج نطاق التقويم المدعوم.")
    return first, last


def month_model(system: str = "gregorian", year: Any = None, month: Any = None,
                *, today: date | None = None) -> dict:
    check_system(system)
    today = today or date.today()
    if (year is None) != (month is None):
        raise ToolError("أدخل السنة والشهر معًا.")
    y, m = parts(today, system)[:2] if year is None else (integer(year, 1, 9999), integer(month, 1, 12))
    first, last = month_window(system, y, m)
    days = []
    for n in range((last - first).days + 1):
        current = first + timedelta(days=n)
        days.append({"date": current.isoformat(), "day": n+1,
                     "persian": iso(persian_parts(current)), "today": current == today})
    def adjacent(delta):
        index = y * 12 + m - 1 + delta
        ny, nm = index // 12, index % 12 + 1
        try:
            month_window(system, ny, nm)
            return {"year": ny, "month": nm}
        except (ValueError, OverflowError):
            return None
    return {"system": system, "year": y, "month": m, "first": first.isoformat(),
            "last": last.isoformat(), "today": today.isoformat(),
            "today_persian": iso(persian_parts(today)), "week_start": "saturday",
            "leading_days": (first.weekday()+2) % 7, "days": days,
            "previous": adjacent(-1), "next": adjacent(1)}


def calendar_alerts(response: dict, model: dict, *, selected_day: str = "", offset: int = 0, limit: int = 50) -> dict:
    """Filter/count ALL matched dates before paging; never paginate rule-by-rule.

    A notice with no concrete triggering Gregorian date has no calendar position.
    Existing date rules use their primary due date, not the day a scan was run.
    """
    offset, limit = integer(offset, 0, 10000000), integer(limit, 1, 100)
    if selected_day:
        try:
            selected_day = date.fromisoformat(selected_day).isoformat()
        except (ValueError, TypeError):
            raise ToolError("اليوم المحدد غير صالح.") from None
        if not model["first"] <= selected_day <= model["last"]:
            raise ToolError("اختر يومًا داخل الشهر المعروض.")
    items = []
    for group in response.get("groups", []):
        meta = {k: group.get(k, "") for k in ("id", "name", "schema_id", "schema_name", "category_id", "category_name", "field_name", "color_type", "color", "operator", "icon")}
        for original in group.get("items", []):
            due = original.get("gregorian_date", "")
            try:
                due = date.fromisoformat(due).isoformat()
            except (ValueError, TypeError):
                continue
            if not model["first"] <= due <= model["last"]:
                continue
            items.append({**original, "rule": {**meta, "message": original.get("message", group.get("message", ""))},
                          "display_date": iso(parts(date.fromisoformat(due), model["system"]))})
    items.sort(key=lambda i: (i["gregorian_date"], i["rule"]["name"], i.get("record_title", ""), i.get("key", "")))
    counts = dict(Counter(i["gregorian_date"] for i in items))
    monthly_total = len(items)
    selected = [i for i in items if not selected_day or i["gregorian_date"] == selected_day]
    page = selected[offset:offset+limit]
    return {**model, "selected_day": selected_day, "counts": counts, "month_total": monthly_total,
            "total": len(selected), "items": page, "offset": offset,
            "has_more": offset+len(page) < len(selected),
            "skipped_values": response.get("skipped_values", 0),
            "unavailable_schemas": [{"name": x.get("name", "")} for x in response.get("unavailable_schemas", [])],
            "scope": "active_saved_due_alerts"}
