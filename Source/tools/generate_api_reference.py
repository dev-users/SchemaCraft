#!/usr/bin/env python3
"""Generate the complete SchemaCraft source API catalogue.

The reference is intentionally generated from source so line numbers,
signatures, HTML IDs, CSS tokens, and HTTP routes cannot silently drift from
the implementation. Third-party code under ``vendor/`` is excluded.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "API_REFERENCE.md"
PYTHON_SOURCES = [
    ROOT / "SchemaCraft.py",
    ROOT / "schemacraft_advanced.py",
    ROOT / "schemacraft_io.py",
    ROOT / "schemacraft_security.py",
    ROOT / "schemacraft_workspace.py",
    ROOT / "build_frontend.py",
    ROOT / "set-builder-password.py",
]


def first_line(text: str | None, fallback: str) -> str:
    """Return a compact Markdown-table description."""

    value = " ".join((text or "").strip().split()) or fallback
    return value.replace("|", "\\|")


def python_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """Render a named Python callable without its implementation body."""

    prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
    returns = f" -> {ast.unparse(node.returns)}" if node.returns is not None else ""
    return f"{prefix}{node.name}({ast.unparse(node.args)}){returns}"


def python_reference(path: Path) -> tuple[list[str], int, int, int]:
    """Build tables for one first-party Python module."""

    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    relative = path.relative_to(ROOT).as_posix()
    constants: list[tuple[str, int]] = []
    callables: list[tuple[str, int, str]] = []
    classes = 0

    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and target.id.isupper():
                    constants.append((target.id, node.lineno))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            fallback = "Internal helper." if node.name.startswith("_") else "Module function."
            callables.append(
                (python_signature(node), node.lineno, first_line(ast.get_docstring(node), fallback))
            )
        if isinstance(node, ast.ClassDef):
            classes += 1
            callables.append(
                (
                    f"class {node.name}",
                    node.lineno,
                    first_line(ast.get_docstring(node), "Module class."),
                )
            )
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    fallback = "Internal method." if child.name.startswith("_") else "Class method."
                    callables.append(
                        (
                            f"{node.name}.{python_signature(child)}",
                            child.lineno,
                            first_line(ast.get_docstring(child), fallback),
                        )
                    )

    lines = [f"### `{relative}`", ""]
    if constants:
        lines.extend(
            [
                "Public/module constants: "
                + ", ".join(f"`{name}` (L{line})" for name, line in constants),
                "",
            ]
        )
    lines.extend(["| Callable | Line | Purpose |", "| --- | ---: | --- |"])
    for signature, line, description in callables:
        lines.append(f"| `{signature.replace('|', '\\|')}` | {line} | {description} |")
    lines.append("")
    return lines, len(callables), classes, len(constants)


JS_FUNCTION = re.compile(
    r"(?ms)^(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\((.*?)\)\s*\{"
)
JS_ARROW = re.compile(
    r"(?m)^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>"
)


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def javascript_reference(path: Path) -> tuple[list[str], int]:
    """Catalogue named JavaScript declarations in one source module."""

    text = path.read_text(encoding="utf-8")
    entries: list[tuple[int, str, str]] = []
    for match in JS_FUNCTION.finditer(text):
        async_prefix, name, arguments = match.groups()
        signature = f"{'async ' if async_prefix else ''}{name}({' '.join(arguments.split())})"
        entries.append((line_number(text, match.start()), signature, "Named function."))
    for match in JS_ARROW.finditer(text):
        name, parenthesized, single = match.groups()
        arguments = " ".join((parenthesized or single or "").split())
        entries.append((line_number(text, match.start()), f"{name}({arguments})", "Named arrow function."))
    entries.sort()
    relative = path.relative_to(ROOT).as_posix()
    lines = [f"### `{relative}`", "", "| Function | Line | Kind |", "| --- | ---: | --- |"]
    for line, signature, kind in entries:
        lines.append(f"| `{signature.replace('|', '\\|')}` | {line} | {kind} |")
    lines.append("")
    return lines, len(entries)


class ElementIndex(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.elements: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if values.get("id"):
            self.elements.append((values["id"], tag, values.get("class", "")))


def html_reference(paths: Iterable[Path]) -> tuple[list[str], int]:
    lines = ["## HTML element API", ""]
    count = 0
    for path in paths:
        parser = ElementIndex()
        parser.feed(path.read_text(encoding="utf-8"))
        if not parser.elements:
            continue
        relative = path.relative_to(ROOT).as_posix()
        lines.extend([f"### `{relative}`", "", "| ID | Tag | Classes |", "| --- | --- | --- |"])
        for element_id, tag, classes in parser.elements:
            lines.append(f"| `{element_id}` | `{tag}` | `{classes}` |")
            count += 1
        lines.append("")
    return lines, count


def http_routes() -> tuple[list[str], int]:
    """Extract API route literals from each HTTP verb handler."""

    tree = ast.parse((ROOT / "SchemaCraft.py").read_text(encoding="utf-8"))
    entries: list[tuple[str, str]] = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "DataEntryRequestHandler":
            continue
        for method in node.body:
            if not isinstance(method, ast.FunctionDef) or not method.name.startswith("do_"):
                continue
            verb = method.name.removeprefix("do_")
            seen: set[str] = set()
            for child in ast.walk(method):
                if isinstance(child, ast.Constant) and isinstance(child.value, str):
                    route = child.value
                    if route.startswith("/api/") and route != "/api/" and route not in seen:
                        seen.add(route)
                        entries.append((verb, route))
    public = {
        ("GET", "/api/health"),
        ("GET", "/api/startup/status"),
        ("GET", "/api/session/bootstrap"),
        ("POST", "/api/session/login"),
    }
    lines = [
        "## HTTP API route index",
        "",
        "Production data routes require the HttpOnly browser session. Startup routes require the per-launch capability token.",
        "",
        "| Method | Route/prefix | Access |",
        "| --- | --- | --- |",
    ]
    for verb, route in entries:
        access = "Health" if route == "/api/health" else "Launch token" if (verb, route) in public else "Browser session"
        lines.append(f"| `{verb}` | `{route}` | {access} |")
    lines.append("")
    return lines, len(entries)


def css_reference() -> tuple[list[str], int]:
    path = ROOT / "app" / "src" / "styles" / "application.css"
    text = path.read_text(encoding="utf-8")
    tokens = sorted(set(re.findall(r"--[A-Za-z0-9_-]+", text)))
    sections = re.findall(r"/\*\s*(\d{2}\.[^*]+?)\s*\*/", text)
    lines = ["## CSS API", "", "Canonical source: `app/src/styles/application.css`.", "", "### Sections", ""]
    lines.extend(f"- {section.strip()}" for section in sections)
    lines.extend(["", "### Custom properties", "", ", ".join(f"`{token}`" for token in tokens), ""])
    return lines, len(tokens)


def main() -> None:
    python_lines: list[str] = ["## Python API", ""]
    python_callables = python_classes = python_constants = 0
    for path in PYTHON_SOURCES:
        lines, callables, classes, constants = python_reference(path)
        python_lines.extend(lines)
        python_callables += callables
        python_classes += classes
        python_constants += constants

    javascript_lines: list[str] = ["## JavaScript API", ""]
    javascript_functions = 0
    for path in sorted((ROOT / "app" / "src").rglob("*.js")):
        lines, count = javascript_reference(path)
        javascript_lines.extend(lines)
        javascript_functions += count

    html_lines, html_elements = html_reference(
        sorted((ROOT / "app" / "src").rglob("*.html"))
    )
    route_lines, route_count = http_routes()
    css_lines, css_tokens = css_reference()

    summary = [
        "# SchemaCraft API Reference",
        "",
        "> Generated by `python tools/generate_api_reference.py`. Do not edit this file manually.",
        "",
        "Third-party code under `vendor/`, generated bundles under `app/`, tests, and anonymous callbacks are intentionally excluded.",
        "",
        "| Surface | Catalogued items |",
        "| --- | ---: |",
        f"| Python callables/classes | {python_callables} |",
        f"| Python classes | {python_classes} |",
        f"| Python module constants | {python_constants} |",
        f"| Named JavaScript functions | {javascript_functions} |",
        f"| HTML elements with stable IDs | {html_elements} |",
        f"| HTTP routes/prefixes | {route_count} |",
        f"| CSS custom properties | {css_tokens} |",
        "",
    ]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        "\n".join(summary + route_lines + python_lines + javascript_lines + html_lines + css_lines).rstrip() + "\n",
        encoding="utf-8",
    )
    print(f"Generated {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
