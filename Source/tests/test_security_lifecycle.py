from __future__ import annotations

import base64
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import AuditUserStore
from schemacraft_security import (
    BrowserSessionManager,
    bcrypt_hash_password,
    bcrypt_verify_password,
)

ROOT = Path(__file__).resolve().parents[1]


class SecurityLifecycleTests(unittest.TestCase):
    def test_bcrypt_round_trip_and_legacy_builder_hash_upgrade(self) -> None:
        encoded = bcrypt_hash_password("correct horse battery staple")
        self.assertTrue(encoded.startswith("$2"))
        self.assertTrue(bcrypt_verify_password("correct horse battery staple", encoded))
        self.assertFalse(bcrypt_verify_password("wrong", encoded))

        with tempfile.TemporaryDirectory() as temporary:
            original_path = APP.BUILDER_AUTH_PATH
            original_unlocked = APP._BUILDER_UNLOCKED
            try:
                APP.BUILDER_AUTH_PATH = Path(temporary) / "builder-auth.json"
                APP._BUILDER_UNLOCKED = False
                salt = b"legacy-salt-that-is-long-enough"
                password = "legacy-password"
                legacy = {
                    "version": 1,
                    "algorithm": "pbkdf2-sha256",
                    "iterations": 310_000,
                    "salt": base64.b64encode(salt).decode("ascii"),
                    "hash": base64.b64encode(
                        APP._password_digest(password, salt, 310_000)
                    ).decode("ascii"),
                }
                APP.BUILDER_AUTH_PATH.write_text(json.dumps(legacy), encoding="utf-8")
                self.assertTrue(APP.verify_builder_password(password))
                upgraded = json.loads(APP.BUILDER_AUTH_PATH.read_text(encoding="utf-8"))
                self.assertEqual(upgraded["algorithm"], "bcrypt")
                self.assertNotIn("salt", upgraded)
            finally:
                APP.BUILDER_AUTH_PATH = original_path
                APP._BUILDER_UNLOCKED = original_unlocked

    def test_browser_session_tokens_are_random_consumable_and_cookie_bound(self) -> None:
        manager = BrowserSessionManager(lifetime_seconds=600)
        startup = manager.startup_token
        self.assertTrue(manager.startup_token_matches(startup))
        token = manager.create_session("Tester", startup)
        self.assertFalse(manager.startup_token_matches(startup))
        cookie = manager.set_cookie_header(token).split(";", 1)[0]
        self.assertEqual(manager.authenticated_user(cookie), "Tester")
        manager.invalidate_all()
        self.assertEqual(manager.authenticated_user(cookie), "")

    def test_production_server_rejects_data_until_splash_login(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original_users = APP.AUDIT_USERS
            APP.AUDIT_USERS = AuditUserStore(Path(temporary))
            server = APP.DataEntryHTTPServer(
                (APP.HOST, 0),
                APP.DataEntryRequestHandler,
                require_session=True,
                startup_ready=True,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            port = server.server_address[1]

            def request(
                method: str,
                path: str,
                *,
                body: dict | None = None,
                headers: dict[str, str] | None = None,
            ) -> tuple[int, dict, http.client.HTTPMessage]:
                connection = http.client.HTTPConnection(APP.HOST, port, timeout=5)
                payload = json.dumps(body).encode("utf-8") if body is not None else None
                request_headers = dict(headers or {})
                if payload is not None:
                    request_headers["Content-Type"] = "application/json"
                connection.request(method, path, body=payload, headers=request_headers)
                response = connection.getresponse()
                content = json.loads(response.read().decode("utf-8") or "{}")
                result = (response.status, content, response.headers)
                connection.close()
                return result

            try:
                status, _, _ = request("GET", "/api/schema")
                self.assertEqual(status, 401)

                launch_headers = {"X-SchemaCraft-Startup": server.sessions.startup_token}
                status, startup, _ = request(
                    "GET", "/api/startup/status", headers=launch_headers
                )
                self.assertEqual(status, 200)
                self.assertTrue(startup["ready"])

                status, login, response_headers = request(
                    "POST",
                    "/api/session/login",
                    body={"name": "Secure Tester"},
                    headers={
                        **launch_headers,
                        "Origin": f"http://{APP.HOST}:{port}",
                    },
                )
                self.assertEqual(status, 200)
                self.assertEqual(login["audit_users"]["current_user"], "Secure Tester")
                cookie = response_headers.get("Set-Cookie", "").split(";", 1)[0]
                self.assertTrue(cookie.startswith("schemacraft_session="))

                status, session, _ = request(
                    "GET", "/api/session/status", headers={"Cookie": cookie}
                )
                self.assertEqual(status, 200)
                self.assertTrue(session["authenticated"])

                status, _, _ = request(
                    "POST",
                    "/api/session/login",
                    body={"name": "Second User"},
                    headers={
                        **launch_headers,
                        "Origin": f"http://{APP.HOST}:{port}",
                    },
                )
                self.assertEqual(status, 403)
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()
                APP.AUDIT_USERS = original_users

    def test_lifecycle_assets_and_canonical_styles_are_built(self) -> None:
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual([line for line in manifest.splitlines() if line.strip()], ["styles/application.css", "styles/report-studio.css"])
        for filename in (
            "startup.html",
            "startup.js",
            "closing.html",
            "closing.js",
            "lifecycle.css",
        ):
            self.assertTrue((ROOT / "app" / filename).is_file(), filename)
        shell = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('class="session-pending"', shell)
        self.assertIn("session-privacy-screen", shell)
        self.assertIn('new BroadcastChannel("schemacraft-lifecycle")', javascript)
        self.assertNotIn("document.body.innerHTML", javascript)
        icon = ROOT / "app" / "assets" / "schemacraft.ico"
        self.assertTrue(icon.is_file())
        self.assertTrue(icon.read_bytes().startswith(b"\x00\x00\x01\x00"))


if __name__ == "__main__":
    unittest.main()
