"""Restart/readback verification for the offline migration updater.

This deliberately bypasses normal application initialization and never repairs
or initializes an existing database. Reports contain counts and digests only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def _digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def probe_backend(app, root: Path) -> dict:
    from schemacraft_migration import readonly_workspace, _attachments, _inventory
    from schemacraft_postgres_runtime import ManagedPostgres
    from schemacraft_storage import PostgresStore, FORMAT_VERSION, _prepare_dataset
    root = Path(root).resolve()
    settings = json.loads((root / "storage.json").read_text(encoding="utf-8"))
    if settings.get("backend") != "managed-postgresql":
        raise ValueError("postgresql_activation_required")
    # Do not let ManagedPostgres initialize a missing deployment during a probe.
    if not (root / ".postgresql/deployment.json").is_file() or not (root / ".postgresql/cluster/global/pg_control").is_file():
        raise ValueError("existing_deployment_required")
    manager = readonly_workspace(root, require_workbooks=False)
    runtime = ManagedPostgres(app.BASE_DIR, root)
    store = None
    try:
        store = PostgresStore(runtime.start())
        snapshot = store.export_snapshot()
        if snapshot["format_version"] != FORMAT_VERSION or snapshot["metadata"].get("storage_format_version") != FORMAT_VERSION:
            raise ValueError("unsupported_storage_format")
        contexts = {context.schema_id: context for context in manager.contexts(include_archived=True)}
        if set(contexts) != set(snapshot["datasets"]):
            raise ValueError("workspace_database_schema_mismatch")
        for sid, dataset in snapshot["datasets"].items():
            _prepare_dataset(sid, dataset["schema"], dataset["records"])
            if _digest(store.read_schema(sid)) != _digest(dataset["schema"]) or _digest(store.read_dataset(sid)) != _digest(dataset["records"]):
                raise ValueError("dataset_readback_mismatch")
        if _digest(store.read_registry()) != _digest(snapshot["registry"]):
            raise ValueError("registry_readback_mismatch")
        attachments = _attachments(app, manager, snapshot["datasets"], root, _inventory(root))
        return {"version": 1, "status": "verified_backend", "backend": "managed-postgresql",
            "readback_verified": True,
            "logical_sha256": _digest({"datasets": snapshot["datasets"], "registry": snapshot["registry"]}),
            "snapshot_sha256": _digest(snapshot),
            "schemas": len(contexts), "records": sum(len(d["records"]) for d in snapshot["datasets"].values()),
            "archived_schemas": sum(context.archived for context in contexts.values()),
            "children": sum(len(rows) for dataset in snapshot["datasets"].values()
                for record in dataset["records"] for rows in record.get("related", {}).values()),
            "registry_entries": len(snapshot["registry"]), "attachment_files": len(attachments["files"]),
            "attachment_references": attachments["references"],
            "attachment_sha256": _digest(attachments["files"])}
    finally:
        if store is not None:
            store.close()
        runtime.stop()


def cli_main(argv=None, *, app) -> int:
    parser = argparse.ArgumentParser(description="Verify an existing managed database and stop it cleanly.")
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args(argv)
    root, report_path = args.data_dir.resolve(), args.report.resolve()
    if report_path.is_relative_to(root):
        parser.error("--report must be outside the data directory")
    try:
        report = probe_backend(app, root)
    except Exception as exc:
        report = {"version": 1, "status": "blocked", "readback_verified": False,
            "issues": [{"code": "backend_probe_failed", "location": type(exc).__name__}]}
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    report_path.write_text(output, encoding="utf-8")
    print(output, end="")
    return 0 if report["status"] == "verified_backend" else 2
