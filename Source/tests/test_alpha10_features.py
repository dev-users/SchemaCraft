from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP


class Alpha10FeatureTests(unittest.TestCase):
    def test_export_destination_is_chosen_before_generation(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / "people.xlsx"
            original_access = APP.require_builder_access
            original_chooser = APP.choose_export_destination
            try:
                APP.require_builder_access = lambda: None
                APP.choose_export_destination = lambda _name, _types: destination
                result = APP.choose_export_destination_response({"type": "table"})
            finally:
                APP.require_builder_access = original_access
                APP.choose_export_destination = original_chooser
            self.assertFalse(result["cancelled"])
            self.assertEqual(result["destination"], str(destination))

    def test_export_save_honors_preselected_absolute_destination(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / "selected.xlsx"
            names = ("require_builder_access", "create_filtered_export", "current_schema_id", "EXPORT_HISTORY")
            originals = {name: getattr(APP, name) for name in names}
            try:
                APP.require_builder_access = lambda: None
                APP.create_filtered_export = lambda _payload: ("ignored.xlsx", b"alpha10", 3)
                APP.current_schema_id = lambda: "schema-1"
                APP.EXPORT_HISTORY = None
                result = APP.save_export({"type": "table", "destination": str(destination)})
            finally:
                for name, value in originals.items():
                    setattr(APP, name, value)
            self.assertTrue(result["ok"])
            self.assertEqual(destination.read_bytes(), b"alpha10")
            self.assertEqual(result["destination"], str(destination))

    def test_export_rejects_relative_or_mismatched_destination(self) -> None:
        original_access = APP.require_builder_access
        original_create = APP.create_filtered_export
        original_schema = APP.current_schema_id
        try:
            APP.require_builder_access = lambda: None
            APP.create_filtered_export = lambda _payload: ("ignored.xlsx", b"alpha10", 1)
            APP.current_schema_id = lambda: "schema-1"
            with self.assertRaises(APP.ApplicationError):
                APP.save_export({"type": "table", "destination": "relative.xlsx"})
            with self.assertRaises(APP.ApplicationError):
                APP.save_export({"type": "table", "destination": "/tmp/wrong.pdf"})
        finally:
            APP.require_builder_access = original_access
            APP.create_filtered_export = original_create
            APP.current_schema_id = original_schema


if __name__ == "__main__":
    unittest.main()
