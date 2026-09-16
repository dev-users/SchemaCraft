from __future__ import annotations

import importlib.util
import json
import threading
import time
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

PROJECT_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "schemacraft_alpha7_shutdown", PROJECT_DIR / "SchemaCraft.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load SchemaCraft.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


class GracefulShutdownTests(unittest.TestCase):
    def test_shutdown_waits_for_active_request_then_two_idle_seconds(self) -> None:
        slow_started = threading.Event()

        class SlowHandler(APP.DataEntryRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/api/test-slow":
                    slow_started.set()
                    time.sleep(0.5)
                    self.send_json(200, {"ok": True})
                    return
                super().do_GET()

        server = APP.DataEntryHTTPServer((APP.HOST, 0), SlowHandler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        base = f"http://{APP.HOST}:{server.server_address[1]}"
        slow_thread = threading.Thread(
            target=lambda: urlopen(f"{base}/api/test-slow", timeout=5).read(),
            daemon=True,
        )
        slow_thread.start()
        self.assertTrue(slow_started.wait(timeout=2))
        started = time.monotonic()
        try:
            request = Request(
                f"{base}/api/shutdown",
                data=json.dumps({"idle_seconds": 2}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                payload = json.load(response)
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["scheduled"])
            self.assertEqual(payload["idle_seconds"], 2.0)
            server_thread.join(timeout=2.2)
            self.assertTrue(
                server_thread.is_alive(),
                "The server stopped before the active request and idle grace elapsed",
            )
            server_thread.join(timeout=2)
            self.assertFalse(server_thread.is_alive(), "The application server did not terminate")
            self.assertGreaterEqual(time.monotonic() - started, 2.35)
        finally:
            if server_thread.is_alive():
                server.shutdown()
            server.server_close()
            slow_thread.join(timeout=2)
            server_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
