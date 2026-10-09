"""Bounded, read-only evidence collection. Never import SchemaCraft or connect to SQL."""
from __future__ import annotations

import argparse
import ast
import codecs
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone

MAX_JSON = 2 * 1024 * 1024
MAX_SOURCE = 4 * 1024 * 1024
MAX_LOG = 2 * 1024 * 1024
KNOWN_DLLS = (
    "libcrypto-3-x64-62ef03561cdc339644c11de55c99266c.dll",
    "libpq-93fce7a3bbf0a511a31ea98dd9eeaf8c.dll",
    "libssl-3-x64-bfe48e27113227da00f226f5f8c712a1.dll",
    "_psycopg.cp313-win_amd64.pyd", "pq.cp313-win_amd64.pyd",
)
STATUSES = {"preflight", "backing_up", "staged", "blocked", "ready", "moving_original",
            "original_moved", "published", "completed", "recovered", "verified_source",
            "activated", "verified_backup", "verified_postgresql"}
EXCEPTIONS = {"StorageError", "StorageConflict", "MigrationBlocked", "PostgresRuntimeError",
              "ImportError", "ModuleNotFoundError", "OSError", "PermissionError", "FileNotFoundError",
              "UnicodeDecodeError", "JSONDecodeError", "ValueError", "TypeError", "RuntimeError",
              "OperationalError", "ProgrammingError", "InternalError", "DatabaseError",
              "InterfaceError", "DataError", "IntegrityError", "NotSupportedError"}
PHASES = {"preflight", "runtime_start", "store_initialize", "export_snapshot", "migration",
          "activate", "connect", "initialize", "driver_import", "setup", "source_validation",
          "postgres_start", "postgres_initialize", "postgres_export_snapshot", "verify_source",
          "validate_source", "store_create", "store_setup", "start_postgresql", "seed_validation"}


class DiagnosticError(ValueError):
    pass


def clean_path(value):
    return Path(os.path.abspath(Path(str(value).strip().strip('"')).expanduser()))


def allowed_value(value, allowed):
    return isinstance(value, str) and value in allowed


def linked(path):
    """Reject symlinks and Windows junction/reparse points, including ancestors."""
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            return True
    return False


def read_bytes(path, limit, tail=False):
    if linked(path):
        raise DiagnosticError("Linked paths are not inspected")
    with path.open("rb") as stream:
        if tail:
            stream.seek(max(0, path.stat().st_size - limit))
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise DiagnosticError("Evidence file exceeds the read limit")
    return data


def read_json(path):
    document = json.loads(read_bytes(path, MAX_JSON).decode("utf-8-sig"))
    if not isinstance(document, dict):
        raise DiagnosticError("Expected a JSON object")
    return document


def path_info(path):
    result = {"exists": False, "characters": len(str(path)),
              "over_259_characters": len(str(path)) > 259}
    try:
        result.update(exists=path.exists(), linked=linked(path))
    except OSError as exc:
        result.update(error=type(exc).__name__, errno=exc.errno,
                      winerror=getattr(exc, "winerror", None))
    return result


def safe_error(exc):
    # Never include str(exc), filenames from exceptions, query text, or connection info.
    return {"error_type": type(exc).__name__ if type(exc).__name__ in EXCEPTIONS else "OtherError",
            "errno": getattr(exc, "errno", None), "winerror": getattr(exc, "winerror", None)}


def inspect_json(path):
    result = {"file": path.name, "path": path_info(path)}
    if not path.is_file():
        return result
    try:
        data = read_json(path)
        result["status"] = data.get("status") if allowed_value(data.get("status"), STATUSES) else "other_or_missing"
        for field in ("activated", "native_execution_verified", "recovered_publication"):
            if type(data.get(field)) is bool:
                result[field] = data[field]
        for field in ("version", "format_version"):
            if type(data.get(field)) is int:
                result[field] = data[field]
        issues = data.get("issues")
        if isinstance(issues, list):
            result["issue_count"] = len(issues)
            result["migration_setup_failed"] = any(isinstance(i, dict) and i.get("code") == "migration_setup_failed" for i in issues)
            result["exception_types"] = sorted({i.get("location") for i in issues
                                                if isinstance(i, dict) and allowed_value(i.get("location"), EXCEPTIONS)})
        # Enhanced reports may carry safe structured diagnostics. Free-form messages,
        # traceback text, SQL diagnostics, credentials, records, and issue locations are omitted.
        result["safe_exception_diagnostics"] = extract_diagnostics(data)
    except (OSError, ValueError, UnicodeError) as exc:
        result.update(safe_error(exc))
    return result


def extract_diagnostics(data):
    found = []
    def visit(item, depth=0):
        if depth > 7 or len(found) >= 20:
            return
        if isinstance(item, dict):
            safe = {}
            for key in ("type", "exception_type", "error_type", "root_cause_type", "cause_type"):
                if allowed_value(item.get(key), EXCEPTIONS):
                    safe[key] = item[key]
            for key in ("errno", "winerror"):
                if type(item.get(key)) is int:
                    safe[key] = item[key]
            for key in ("sqlstate", "sql_state"):
                value = item.get(key)
                if isinstance(value, str) and re.fullmatch(r"[0-9A-Z]{5}", value):
                    safe[key] = value
            if allowed_value(item.get("phase"), PHASES):
                safe["phase"] = item["phase"]
            if safe and safe not in found:
                found.append(safe)
            for key in ("diagnostics", "diagnostic", "exception", "exceptions", "error", "cause", "causes", "chain", "exception_chain", "issues"):
                value = item.get(key)
                if isinstance(value, (dict, list)):
                    visit(value, depth + 1)
        elif isinstance(item, list):
            for value in item[:50]:
                visit(value, depth + 1)
    visit(data)
    return found


def inspect_deployment(path):
    result = {"path": path_info(path)}
    if not path.is_file():
        return result
    try:
        # Do not load deployment JSON: it contains managed passwords. Select only
        # numeric, nonsecret top-level fields from bytes; never decode credential values.
        raw = read_bytes(path, 65536)
        result["bytes"] = len(raw)
        result["encoding_marker"] = ("UTF-8 BOM" if raw.startswith(codecs.BOM_UTF8) else
                                      "UTF-16 BOM" if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)) else "no BOM")
        # Validate byte sequences without decoding the password-bearing document.
        result["utf8_compatible"] = bool(re.fullmatch(
            rb"(?:[\x00-\x7f]|[\xc2-\xdf][\x80-\xbf]|\xe0[\xa0-\xbf][\x80-\xbf]|"
            rb"[\xe1-\xec\xee\xef][\x80-\xbf]{2}|\xed[\x80-\x9f][\x80-\xbf]|"
            rb"\xf0[\x90-\xbf][\x80-\xbf]{2}|[\xf1-\xf3][\x80-\xbf]{3}|"
            rb"\xf4[\x80-\x8f][\x80-\xbf]{2})*", raw))
        for key in ("format_version", "major", "port"):
            match = re.search(rb'"' + key.encode("ascii") + rb'"\s*:\s*(\d+)\s*[,}]', raw)
            if match:
                result[key] = int(match.group(1))
    except (OSError, ValueError) as exc:
        result.update(safe_error(exc))
    return result


def inspect_log(path):
    result = {"path": path_info(path)}
    if not path.is_file():
        return result
    try:
        raw = read_bytes(path, MAX_LOG, tail=True)
        result["tail_only"] = path.stat().st_size > MAX_LOG
        result["bytes_examined"] = len(raw)
        result["log_has_server_ready"] = b"database system is ready to accept connections" in raw.lower()
        result["log_has_server_shutdown"] = b"database system is shut down" in raw.lower()
        result["error_lines"] = len(re.findall(rb"(?:^|\n)[^\n]*\bERROR:", raw))
        result["fatal_lines"] = len(re.findall(rb"(?:^|\n)[^\n]*\bFATAL:", raw))
        result["panic_lines"] = len(re.findall(rb"(?:^|\n)[^\n]*\bPANIC:", raw))
        result["runtime_starting_present"] = bool(re.search(rb'"event"\s*:\s*"starting"', raw))
        result["runtime_ready_present"] = bool(re.search(rb'"event"\s*:\s*"ready"', raw))
        result["runtime_stopped_present"] = bool(re.search(rb'"event"\s*:\s*"stopped"', raw))
        # No raw log text is retained: logs may contain SQL statements and values.
    except (OSError, ValueError) as exc:
        result.update(safe_error(exc))
    return result


def inspect_source(path):
    result = {"file": path.name, "path": path_info(path)}
    if not path.is_file():
        return result
    try:
        raw = read_bytes(path, MAX_SOURCE)
        result["sha256"] = hashlib.sha256(raw).hexdigest()
        tree = ast.parse(raw.decode("utf-8-sig"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "FORMAT_VERSION" for t in node.targets):
                if isinstance(node.value, ast.Constant) and type(node.value.value) is int:
                    result["storage_format_version"] = node.value.value
        result["has_postgres_initialize"] = any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "initialize" for n in ast.walk(tree))
        result["has_export_snapshot"] = any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "export_snapshot" for n in ast.walk(tree))
        result["has_structured_exception_diagnostics"] = any(token in raw for token in (b'"exception_chain"', b'"root_cause_type"', b'"safe_exception_diagnostics"', b'"diagnostics"'))
    except (OSError, ValueError, UnicodeError, SyntaxError) as exc:
        result.update(safe_error(exc))
    return result


# Runs only psycopg imports. No SchemaCraft import, connection, subprocess, or file write.
# The probe prints allowlisted types/codes and known DLL basenames, never error messages.
PROBE = r'''
import json, os, re, sys
known = %r
allowed = %r
out = {"python_version": list(sys.version_info[:3]), "environment_variable_names": sorted(k for k in os.environ if k.upper().startswith("PG") or k.upper() == "PSYCOPG_IMPL")}
try:
    import psycopg
    from psycopg import pq
    out.update(import_ok=True, implementation=pq.__impl__ if pq.__impl__ in ("binary", "c", "python") else "other")
    version = getattr(psycopg, "__version__", "")
    if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[a-z0-9.]+)?", version): out["psycopg_version"] = version
    try: out["libpq_version"] = int(pq.version())
    except Exception: pass
except Exception as exc:
    out["import_ok"] = False
    chain, seen = [], set()
    cursor = exc
    while cursor is not None and id(cursor) not in seen and len(chain) < 8:
        seen.add(id(cursor))
        typename = type(cursor).__name__
        item = {"type": typename if typename in allowed else "OtherError"}
        for key in ("errno", "winerror"):
            value = getattr(cursor, key, None)
            if type(value) is int: item[key] = value
        message = str(cursor)
        item["known_driver_dlls"] = [name for name in known if name.lower() in message.lower()]
        item["dll_load_failure"] = "dll load failed" in message.lower() or "specified module could not be found" in message.lower()
        item["no_pq_wrapper"] = "no pq wrapper available" in message.lower()
        item["libpq_library_not_found"] = "libpq library not found" in message.lower()
        chain.append(item)
        cursor = cursor.__cause__ if cursor.__cause__ is not None else cursor.__context__
    out["exception_chain"] = chain
print(json.dumps(out, ensure_ascii=True))
''' % (KNOWN_DLLS, sorted(EXCEPTIONS))


def probe_driver(root):
    executable = root / "vendor/python/python.exe"
    result = {"interpreter": path_info(executable)}
    if not executable.is_file() or linked(root) or linked(executable):
        result["probe_status"] = "bundled_python_missing_or_linked"
        return result
    try:
        child = subprocess.run([str(executable), "-X", "utf8", "-B", "-c", PROBE],
                               cwd=root, capture_output=True, timeout=30, check=False)
        result["exit_code"] = child.returncode
        if child.returncode == 0 and len(child.stdout) < 65536:
            data = json.loads(child.stdout.decode("utf-8"))
            # Output is from the fixed probe; no raw stdout/stderr ever enters a report.
            if isinstance(data, dict) and type(data.get("import_ok")) is bool:
                result["driver"] = data
                result["probe_status"] = "completed"
            else:
                result["probe_status"] = "unexpected_output"
        else:
            result["probe_status"] = "interpreter_failed"
    except subprocess.TimeoutExpired:
        result["probe_status"] = "import_timed_out"
    except (OSError, ValueError, UnicodeError) as exc:
        result.update(safe_error(exc))
    return result


def driver_paths(root):
    site = root / "vendor/python/Lib/site-packages"
    paths = [("python.exe", root / "vendor/python/python.exe")]
    for basename in KNOWN_DLLS:
        folder = "psycopg_binary" if basename.endswith(".pyd") else "psycopg_binary.libs"
        paths.append((basename, site / folder / basename))
    result = [{"file": name, **path_info(path)} for name, path in paths]
    return {"files": result, "over_259_characters_count": sum(i["over_259_characters"] for i in result)}


def select_journal(selection):
    if linked(selection):
        raise DiagnosticError("Selected path is linked; choose a real folder or journal")
    if selection.is_file():
        if not re.fullmatch(r"\.schemacraft-update-journal-[0-9a-f]{20}\.json", selection.name):
            raise DiagnosticError("Choose the .schemacraft-update-journal-*.json file")
        return selection
    candidates = []
    # Only immediate journals in the chosen parent or application folder's parent.
    for parent in (selection, selection.parent):
        if parent.is_dir() and not linked(parent):
            candidates.extend(p for p in parent.glob(".schemacraft-update-journal-*.json")
                              if re.fullmatch(r"\.schemacraft-update-journal-[0-9a-f]{20}\.json", p.name) and not linked(p))
    candidates = sorted(set(candidates), key=lambda p: p.stat().st_mtime, reverse=True)[:30]
    if not candidates:
        raise DiagnosticError("No update journal found in the selected folder or its parent")
    if len(candidates) == 1:
        return candidates[0]
    print("Choose the failed update journal:")
    for index, candidate in enumerate(candidates, 1):
        info = inspect_json(candidate)
        print(f"  {index}. {candidate.name} (status: {info.get('status', 'unreadable')})")
    choice = input("Journal number: ").strip()
    if not choice.isdigit() or not 1 <= int(choice) <= len(candidates):
        raise DiagnosticError("Invalid journal number")
    return candidates[int(choice) - 1]


def validate_workspace(journal_path, journal):
    target, work, stage = (clean_path(journal.get(key, "")) for key in ("target", "work", "stage"))
    if not all(isinstance(journal.get(key), str) and Path(journal[key]).is_absolute() for key in ("target", "work", "stage")):
        raise DiagnosticError("Journal paths must be absolute")
    expected_key = hashlib.sha256(str(target.resolve()).casefold().encode("utf-8")).hexdigest()[:20]
    expected_parents = {target.parent / root / expected_key
                        for root in (".schemacraft-update-backups", ".scu")}
    if (journal_path.parent != target.parent or journal_path.name != f".schemacraft-update-journal-{expected_key}.json"
            or work.parent not in expected_parents or stage != work / "staged"):
        raise DiagnosticError("Journal paths do not match the updater workspace layout")
    if any(linked(p) for p in (target, work, stage, journal_path)):
        raise DiagnosticError("Linked journal paths are not inspected")
    return target, work, stage


def collect(updater, journal_path, run_probes=True):
    if linked(updater):
        raise DiagnosticError("Updater root must be a real folder")
    journal = read_json(journal_path)
    target, work, stage = validate_workspace(journal_path, journal)
    reports = [inspect_json(work / name) for name in ("preflight.json", "migration.json", "probe-first.json", "probe-restart.json")]
    existing = [r for r in reports if r["path"]["exists"]]
    result = {
        "diagnostic_version": 1, "collected_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "read_only_files_and_driver_imports_no_database_connection",
        "environment_variable_names": sorted(k for k in os.environ if k.upper().startswith("PG") or k.upper() == "PSYCOPG_IMPL"),
        "journal": inspect_json(journal_path),
        "workspace_root": work.parent.parent.name,
        "paths": {"updater_root": path_info(updater), "application": path_info(target),
                  "work": path_info(work), "stage": path_info(stage)},
        "reports": reports,
        "last_report_file": existing[-1]["file"] if existing else None,
        "deployment": inspect_deployment(stage / "data/.postgresql/deployment.json"),
        "postgres_log": inspect_log(stage / "data/.postgresql/postgres.log"),
        "source": {"updater_payload_storage": inspect_source(updater / "payload/schemacraft_storage.py"),
                   "stage_storage": inspect_source(stage / "schemacraft_storage.py"),
                   "stage_migration": inspect_source(stage / "schemacraft_migration.py")},
        "driver_path_lengths": {"updater": driver_paths(updater), "stage": driver_paths(stage)},
    }
    if run_probes:
        result["driver_import_probes"] = {"updater": probe_driver(updater), "stage": probe_driver(stage)}
    return result


def write_report(report, output_dir=None):
    # Production output is fixed beside this helper; there is no --output option.
    directory = Path(__file__).absolute().parent if output_dir is None else output_dir
    if linked(directory):
        raise DiagnosticError("Diagnostic output directory is linked")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    for suffix in ("", *(f"-{n}" for n in range(1, 100))):
        path = directory / f"migration-diagnostic-{stamp}{suffix}.json"
        try:
            with path.open("x", encoding="utf-8", newline="\n") as stream:
                json.dump(report, stream, ensure_ascii=True, indent=2)
                stream.write("\n")
            return path
        except FileExistsError:
            continue
    raise DiagnosticError("Unable to choose a new diagnostic report filename")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--updater-root", required=True)
    parser.add_argument("--selection", help="Application parent/folder or failed update journal")
    args = parser.parse_args(argv)
    try:
        updater = clean_path(args.updater_root)
        if not (updater / "vendor/python/python.exe").is_file():
            raise DiagnosticError("Choose the extracted UPDATE folder containing vendor\\python\\python.exe")
        print("Read-only diagnostic: no server control, migration, repair, or database connection.")
        print("Paste the folder containing .schemacraft-update-journal-*.json, or that journal file.")
        selection = clean_path(args.selection if args.selection else input("Application parent / journal: "))
        journal_path = select_journal(selection)
        print("Inspecting known reports and comparing updater/stage psycopg imports...")
        report = collect(updater, journal_path)
        output = write_report(report)
        print("\nCompleted. Share only this diagnostic report:")
        print(output)
        print("The report omits passwords, DSNs, SQL/log text, company records, and environment values.")
        return 0
    except (OSError, ValueError, UnicodeError) as exc:
        if isinstance(exc, DiagnosticError):
            print(f"Diagnostic stopped: {exc}")
        else:
            print(f"Diagnostic stopped: {type(exc).__name__}; no exception text was printed.")
        return 2


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    raise SystemExit(main())
