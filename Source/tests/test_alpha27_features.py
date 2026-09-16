from __future__ import annotations

import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import SchemaCraft as APP
from schemacraft_workspace import SchemaContext, use_context
from test_backend import configured_schema


ROOT = Path(__file__).resolve().parents[1]


class Alpha27FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.builder = (ROOT / "app" / "src" / "pages" / "builder" / "builder.js").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", self.html)

    def test_integrated_editable_list_and_strict_tab_order(self) -> None:
        for token in (
            'menu.className = "editable-list-menu"',
            "dataset.addInlineListOption",
            "matches.length === 0",
            "focusAdjacentEntryField(event.target",
            "validateEntryControl(control, true)",
        ):
            self.assertIn(token, self.javascript)
        self.assertIn(".editable-list-create-option", self.styles)
        self.assertNotIn("editable-list-add", self.javascript)

    def test_date_is_three_fields_and_dash_moves_focus(self) -> None:
        self.assertIn("group.append(hidden, day, month, year)", self.javascript)
        self.assertIn('if (event.key !== "-") return;', self.javascript)
        self.assertNotIn("data-calendar-compact", self.javascript)
        self.assertNotIn("DD-MM-YY", self.javascript)

    def test_related_person_mapping_is_checkbox_then_field(self) -> None:
        checkbox_position = self.html.index('id="related-person-source-checkbox"')
        field_position = self.html.index('id="related-person-source-field"')
        self.assertLess(checkbox_position, field_position)
        self.assertIn("field.unique_checked_across_cards === true", self.builder)
        self.assertIn('candidateCategory.kind === "main"', self.builder)
        self.assertIn("option.disabled = field.type !== type", self.builder)


class TrackingLock:
    def __init__(self) -> None:
        self.depth = 0
        self.guard = threading.RLock()

    def __enter__(self):
        self.guard.acquire()
        self.depth += 1
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.depth -= 1
        self.guard.release()


class Alpha27BackendTests(unittest.TestCase):
    def test_history_settings_migrate_and_remain_independent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = APP.WORKSPACE_SETTINGS_PATH
            APP.WORKSPACE_SETTINGS_PATH = Path(directory) / "workspace-settings.json"
            try:
                APP.WORKSPACE_SETTINGS_PATH.write_text(
                    json.dumps({"home_history_limit": 7}), encoding="utf-8"
                )
                settings = APP.read_workspace_settings()
                self.assertEqual(
                    [
                        settings[f"home_{name}_history_limit"]
                        for name in ("entry", "builder", "search", "import", "export")
                    ],
                    [7, 7, 7, 7, 7],
                )
                self.assertEqual(settings["entry_history_limit"], 8)
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original

    def test_excel_projection_builds_outside_lock_and_keeps_cache_hot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = SchemaContext(
                schema_id="a" * 32,
                name="اختبار",
                folder=root,
                schema_path=root / "schema.json",
                workbook_path=root / "database.xlsx",
                attachments_path=root / "attachments",
            )
            schema = APP.validate_schema(configured_schema())
            context.schema_path.write_text(
                json.dumps(schema, ensure_ascii=False), encoding="utf-8"
            )
            context.attachments_path.mkdir()
            APP.write_dataset_workbook(schema, [], context.workbook_path)
            original_lock = APP.WORKBOOK_LOCK
            original_snapshots = APP._DATASET_SNAPSHOTS
            original_snapshot = APP._DATASET_SNAPSHOT
            tracking_lock = TrackingLock()
            APP.WORKBOOK_LOCK = tracking_lock
            APP._DATASET_SNAPSHOTS = {}
            APP._DATASET_SNAPSHOT = None
            original_write = APP.write_dataset_workbook

            def observed_write(candidate, records, destination):
                self.assertEqual(tracking_lock.depth, 0)
                return original_write(candidate, records, destination)

            try:
                with mock.patch.object(APP, "write_dataset_workbook", side_effect=observed_write):
                    APP._project_schema_workbook(
                        {"context": context, "expected_revision": schema["revision"]}
                    )
                with use_context(context):
                    cached = APP._DATASET_SNAPSHOTS[str(context.workbook_path.resolve())]
                    self.assertEqual(cached.workbook_signature, APP._workbook_cache_signature())
            finally:
                APP.WORKBOOK_LOCK = original_lock
                APP._DATASET_SNAPSHOTS = original_snapshots
                APP._DATASET_SNAPSHOT = original_snapshot

    def test_projection_queue_coalesces_repeated_schema_edits(self) -> None:
        class AliveWorker:
            @staticmethod
            def is_alive() -> bool:
                return True

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = SchemaContext(
                schema_id="b" * 32,
                name="اختبار",
                folder=root,
                schema_path=root / "schema.json",
                workbook_path=root / "database.xlsx",
                attachments_path=root / "attachments",
            )
            original_pending = APP._WORKBOOK_SYNC_PENDING
            original_worker = APP._WORKBOOK_SYNC_WORKER
            APP._WORKBOOK_SYNC_PENDING = {}
            APP._WORKBOOK_SYNC_WORKER = AliveWorker()
            try:
                recovery = copy.deepcopy(configured_schema())
                APP.schedule_workbook_schema_sync(
                    context,
                    2,
                    recovery_schema=recovery,
                    recovery_records=[],
                    cleanup_paths={"attachments/old-a.pdf"},
                )
                APP.schedule_workbook_schema_sync(
                    context,
                    3,
                    cleanup_paths={"attachments/old-b.pdf"},
                )
                self.assertEqual(len(APP._WORKBOOK_SYNC_PENDING), 1)
                task = next(iter(APP._WORKBOOK_SYNC_PENDING.values()))
                self.assertEqual(task["expected_revision"], 3)
                self.assertEqual(task["recovery_schema"], recovery)
                self.assertEqual(
                    task["cleanup_paths"],
                    {"attachments/old-a.pdf", "attachments/old-b.pdf"},
                )
            finally:
                APP._WORKBOOK_SYNC_PENDING = original_pending
                APP._WORKBOOK_SYNC_WORKER = original_worker


if __name__ == "__main__":
    unittest.main()
