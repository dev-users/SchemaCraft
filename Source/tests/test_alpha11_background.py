from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP


class Alpha11BackgroundTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.original_path = APP.WORKSPACE_SETTINGS_PATH
        self.original_access = APP.require_builder_access
        APP.WORKSPACE_SETTINGS_PATH = Path(self.temporary.name) / "workspace-settings.json"
        APP.require_builder_access = lambda: None

    def tearDown(self) -> None:
        APP.WORKSPACE_SETTINGS_PATH = self.original_path
        APP.require_builder_access = self.original_access
        self.temporary.cleanup()

    def test_background_defaults_to_home_only(self) -> None:
        settings = APP.read_workspace_settings()
        self.assertFalse(settings["background_all_pages"])
        self.assertFalse(settings["background_image_custom"])

    def test_background_image_and_scope_are_persisted(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"test-image"
        result = APP.save_workspace_settings(
            {
                "background_all_pages": True,
                "background_image_name": "background.png",
                "background_image_data": base64.b64encode(png).decode("ascii"),
            }
        )
        settings = result["workspace_settings"]
        self.assertTrue(settings["background_all_pages"])
        self.assertTrue(settings["background_image_custom"])
        self.assertEqual(settings["background_image_mime"], "image/png")
        self.assertEqual(settings["background_image_name"], "background.png")
        self.assertEqual(APP.workspace_background_image_path().read_bytes(), png)

        reread = APP.read_workspace_settings()
        self.assertTrue(reread["background_all_pages"])
        self.assertTrue(reread["background_image_custom"])
        self.assertTrue(reread["background_image_version"])

    def test_rejects_non_image_content(self) -> None:
        with self.assertRaises(APP.ApplicationError):
            APP.save_workspace_settings(
                {
                    "background_image_name": "not-an-image.txt",
                    "background_image_data": base64.b64encode(b"plain text").decode("ascii"),
                }
            )


if __name__ == "__main__":
    unittest.main()
