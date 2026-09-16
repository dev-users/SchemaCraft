from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha34SeamlessTabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_data_and_builder_stay_independent(self) -> None:
        self.assertEqual(self.html.count("home-tabbed-workspace"), 2)
        self.assertIn("home-data-card", self.html)
        self.assertIn("home-builder-card", self.html)
        self.assertIn('id="home-data-schema-tabs"', self.html)
        self.assertIn('id="home-builder-schema-tabs"', self.html)

    def test_tab_and_panel_share_one_surface_contract(self) -> None:
        workspace_styles = self.styles[self.styles.index("Alpha 33") :]
        self.assertIn("--home-tab-surface: rgba(248, 250, 252, .94)", workspace_styles)
        seamless = self.styles[self.styles.index("Alpha 34") :]
        for token in (
            "border: 0",
            "background: var(--home-tab-surface)",
            "margin-top: -1px",
        ):
            self.assertIn(token, seamless)
        self.assertNotIn(".home-tabbed-workspace .home-schema-browser-tab.is-active::after", seamless)

    def test_panel_has_no_competing_card_surface(self) -> None:
        seamless = self.styles[self.styles.index("Alpha 34") :]
        panel_rule = seamless[
            seamless.index(".home-tabbed-workspace .home-schema-panel {") :
            seamless.index(".home-tabbed-workspace .home-schema-panel.is-active")
        ]
        self.assertIn("border: 0", panel_rule)
        self.assertIn("border-radius: 0", panel_rule)
        self.assertIn("background: transparent", panel_rule)
        self.assertIn("box-shadow: none", panel_rule)

    def test_switching_animation_respects_reduced_motion(self) -> None:
        seamless = self.styles[self.styles.index("Alpha 34") :]
        self.assertIn("animation: home-schema-panel-enter 160ms ease-out both", seamless)
        self.assertIn("@media (prefers-reduced-motion: reduce)", seamless)
        self.assertIn("@keyframes home-schema-panel-enter", seamless)


if __name__ == "__main__":
    unittest.main()
