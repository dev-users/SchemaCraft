"""Arabic/Persian presentation metadata and durable, installation-local UI language.

The canonical schema names, option IDs and record values never pass through the
UI translator.  Aliases are optional metadata, carried with a schema on export.
This module has no third-party dependencies.
"""
from __future__ import annotations

import copy
import json
import os
import re
import tempfile
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

LANGUAGES = ("ar", "fa")
DEFAULT_LANGUAGE = "ar"
_LOCK = threading.RLock()


def normalize_language(value: Any) -> str:
    return value if isinstance(value, str) and value in LANGUAGES else DEFAULT_LANGUAGE


def read_language(data_dir: Path) -> str:
    """Missing/corrupt preferences are harmless, and always start in Arabic."""
    try:
        payload = json.loads((Path(data_dir) / "ui-language.json").read_text(encoding="utf-8"))
        return normalize_language(payload.get("language") if isinstance(payload, dict) else None)
    except (OSError, ValueError, TypeError):
        return DEFAULT_LANGUAGE


def save_language(data_dir: Path, language: Any) -> str:
    if not isinstance(language, str) or language not in LANGUAGES:
        raise ValueError("لغة الواجهة غير مدعومة.")
    directory = Path(data_dir)
    with _LOCK:
        directory.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".ui-language-", suffix=".json", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"version": 1, "language": language}, stream, ensure_ascii=False)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, directory / "ui-language.json")
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return language


def normalize_names(raw: Any, keys: tuple[str, ...] = ("label",)) -> dict[str, Any]:
    """Validate only explicitly supported display properties; never accept data values.

    ``source_language`` records the language of newly created user content. Legacy
    definitions have Arabic as their source. ``enabled`` is deliberately separate
    from the aliases, so turning them off does not delete the user's translations.
    Empty names are allowed and resolve using the other language, then the base.
    """
    raw = raw if isinstance(raw, dict) else {}
    result: dict[str, Any] = {
        "enabled": raw.get("enabled") is True,
        "source_language": normalize_language(raw.get("source_language")),
    }
    for language in LANGUAGES:
        values = raw.get(language)
        values = values if isinstance(values, dict) else {}
        result[language] = {
            key: values[key].strip()[:2000]
            for key in keys
            if isinstance(values.get(key), str) and values[key].strip()
        }
    return result


def display_text(entity: Any, language: str = "ar", key: str = "label") -> str:
    if not isinstance(entity, dict):
        return ""
    metadata = entity.get("i18n")
    if isinstance(metadata, dict) and metadata.get("enabled") is True:
        selected = normalize_language(language)
        for code in (selected, "fa" if selected == "ar" else "ar"):
            group = metadata.get(code)
            text = group.get(key) if isinstance(group, dict) else None
            if isinstance(text, str) and text.strip():
                return text.strip()
    value = entity.get(key)
    return str(value) if value is not None else ""


def name_variants(entity: Any, key: str = "label") -> tuple[str, ...]:
    """Recognize typed list labels in either language without changing option IDs."""
    if not isinstance(entity, dict):
        return ()
    values = [str(entity.get(key) or "")]
    metadata = entity.get("i18n")
    if isinstance(metadata, dict) and metadata.get("enabled") is True:
        for code in LANGUAGES:
            group = metadata.get(code)
            if isinstance(group, dict) and isinstance(group.get(key), str):
                values.append(group[key].strip())
    return tuple(dict.fromkeys(value for value in values if value))


@lru_cache(maxsize=4)
def _catalog(path: str, version: int) -> tuple[dict[str, str], tuple]:
    try:
        values = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}, ()
    exact = {key: value for key, value in values.items()
             if isinstance(key, str) and not key.startswith("_") and isinstance(value, str)}
    patterns = []
    # Patterns are generated from *source-code message templates*, not from
    # arbitrary response contents. Captured names and values stay untouched.
    for source, translated in exact.items():
        slots = re.findall(r"\{(\d+)\}", source)
        if not slots:
            continue
        pieces = re.split(r"(\{\d+\})", source)
        expression = "".join(r"([\s\S]*?)" if re.fullmatch(r"\{\d+\}", part) else re.escape(part)
                             for part in pieces)
        literal_length = sum(len(part) for part in pieces if not re.fullmatch(r"\{\d+\}", part))
        if literal_length >= 3:
            patterns.append((literal_length, re.compile(r"\A" + expression + r"\Z"), translated, slots))
    patterns.sort(key=lambda item: item[0], reverse=True)
    return exact, tuple(patterns)


def translate_message(value: str, language: str, catalog_path: Path, custom: dict | None = None) -> str:
    for source, texts in (custom or {}).items():
        replacement = texts.get(normalize_language(language)) if isinstance(texts, dict) else None
        if not isinstance(replacement, str):
            continue
        if value == source:
            return replacement
        slots = re.findall(r"\{(\d+)\}", source)
        if slots:
            pieces = re.split(r"(\{\d+\})", source)
            expression = "".join(r"([\s\S]*?)" if re.fullmatch(r"\{\d+\}", part) else re.escape(part) for part in pieces)
            match = re.fullmatch(expression, value)
            if match:
                captured = dict(zip(slots, match.groups()))
                return re.sub(r"\{(\d+)\}", lambda token: captured.get(token.group(1), token.group(0)), replacement)
    if normalize_language(language) != "fa" or not isinstance(value, str):
        return value
    try:
        stamp = catalog_path.stat().st_mtime_ns
    except OSError:
        return value
    exact, patterns = _catalog(str(catalog_path), stamp)
    if value in exact:
        return exact[value]
    for _, pattern, translated, slots in patterns:
        match = pattern.fullmatch(value)
        if match:
            captures = dict(zip(slots, match.groups()))
            return re.sub(r"\{(\d+)\}", lambda token: captures.get(token.group(1), token.group(0)), translated)
    return value


def translate_response_messages(body: dict[str, Any], language: str, catalog_path: Path, custom: dict | None = None) -> dict[str, Any]:
    """Translate designated UI-message slots only, never profiles or definitions."""
    if (language != "fa" and not custom) or not isinstance(body, dict):
        return body
    result = dict(body)
    for key in ("error", "message"):
        if isinstance(result.get(key), str):
            result[key] = translate_message(result[key], language, catalog_path, custom)
    for key in ("errors", "warnings", "issues"):
        if isinstance(result.get(key), list):
            messages = []
            for item in result[key]:
                if isinstance(item, str):
                    messages.append(translate_message(item, language, catalog_path, custom))
                elif isinstance(item, dict):
                    translated = dict(item)
                    for slot in ("error", "message", "reason"):
                        if isinstance(translated.get(slot), str):
                            translated[slot] = translate_message(translated[slot], language, catalog_path, custom)
                    messages.append(translated)
                else:
                    messages.append(item)
            result[key] = messages
    return result
