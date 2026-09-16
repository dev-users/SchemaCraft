from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Alpha21BuilderRefinementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")

    def test_release_contains_alpha21_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)

    def test_global_summary_gap_matches_schema_gap(self) -> None:
        self.assertIn(
            "#global-builder-stats + #global-category-list {\n  margin-block-start: 0;",
            self.styles,
        )

    def test_category_connection_is_a_header_icon_without_inline_creation_footer(self) -> None:
        heading_start = self.javascript.index('actions.className = "builder-actions global-category-heading-actions"')
        heading_end = self.javascript.index("titleRow.append(actions)", heading_start)
        heading_code = self.javascript[heading_start:heading_end]
        self.assertIn('globalDefinitionActionButton("إضافة الفئة إلى التصميم", "plus"', heading_code)
        self.assertNotIn('footer.className = "global-category-footer-actions"', self.javascript)
        self.assertNotIn(".global-category-footer-actions", self.styles)


if __name__ == "__main__":
    unittest.main()
