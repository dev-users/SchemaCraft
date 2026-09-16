from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import ExportHistoryStore, ImportHistoryStore


class Alpha12FeatureTests(unittest.TestCase):
    def test_operation_history_entries_can_be_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_store = ExportHistoryStore(root)
            import_store = ImportHistoryStore(root)
            exported = export_store.append({"filename": "report.xlsx"})
            imported = import_store.append({"filename": "source.xlsx"})

            self.assertEqual(export_store.delete(exported["id"])["filename"], "report.xlsx")
            self.assertEqual(import_store.delete(imported["id"])["filename"], "source.xlsx")
            self.assertEqual(export_store.response()["total"], 0)
            self.assertEqual(import_store.response()["total"], 0)

    def test_background_gallery_retains_latest_three_and_can_reselect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original_path = APP.WORKSPACE_SETTINGS_PATH
            original_access = APP.require_builder_access
            APP.WORKSPACE_SETTINGS_PATH = Path(temporary) / "workspace-settings.json"
            APP.require_builder_access = lambda: None
            try:
                saved_ids = []
                for index in range(4):
                    content = b"\x89PNG\r\n\x1a\n" + f"image-{index}".encode()
                    result = APP.save_workspace_settings(
                        {
                            "background_image_name": f"background-{index}.png",
                            "background_image_data": base64.b64encode(content).decode("ascii"),
                        }
                    )
                    saved_ids.append(result["workspace_settings"]["background_image_id"])
                settings = APP.read_workspace_settings()
                self.assertEqual(len(settings["background_images"]), 3)
                self.assertEqual(settings["background_image_id"], saved_ids[-1])
                self.assertNotIn(saved_ids[0], {item["id"] for item in settings["background_images"]})

                reselected = APP.save_workspace_settings({"background_image_id": saved_ids[1]})
                self.assertEqual(reselected["workspace_settings"]["background_image_id"], saved_ids[1])
                defaulted = APP.save_workspace_settings({"background_image_id": "default"})
                self.assertFalse(defaulted["workspace_settings"]["background_image_custom"])
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original_path
                APP.require_builder_access = original_access


if __name__ == "__main__":
    unittest.main()
