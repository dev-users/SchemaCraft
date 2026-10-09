"""Mocked WinAPI branch checks; these do not claim native Windows validation."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve()
DEFAULT_ENGINE = HERE.parents[1] / "core" / "engine.py"
SOURCE = Path(os.environ.get("SC_WINDOWS_TEST_ENGINE", str(DEFAULT_ENGINE)))
engine = types.ModuleType("windows_updater_engine_test")
engine.__file__ = str(SOURCE)
exec(compile(SOURCE.read_text(encoding="utf-8"), str(SOURCE), "exec"), engine.__dict__)


class WindowsEngineCalls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="schemacraft-winapi-synthetic-")
        self.target = Path(self.temp.name) / "Synthetic Arabic العربية Application"
        self.target.mkdir()
        self.fake_os = types.SimpleNamespace(**{key: getattr(os, key) for key in dir(os) if not key.startswith("__")})
        self.fake_os.name = "nt"
        self.kernel = mock.Mock()
        self.kernel.CreateMutexW.return_value = 0x123456789
        self.kernel.GetLastError.return_value = 0
        self.kernel.CloseHandle.return_value = 1
        self.msvcrt = types.SimpleNamespace(LK_NBLCK=2, LK_UNLCK=0, locking=mock.Mock())
        self.patches = [mock.patch.object(engine, "os", self.fake_os),
                        mock.patch.object(engine.ctypes, "windll", types.SimpleNamespace(kernel32=self.kernel), create=True),
                        mock.patch.dict(sys.modules, {"msvcrt": self.msvcrt})]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def test_unicode_mutex_name_and_64_bit_handles_are_preserved(self):
        with engine._locked(self.target):
            expected = "Local\\GenericSchemaCraft-" + engine._key(self.target)
            self.assertEqual(self.kernel.CreateMutexW.call_args.args[2], expected)
            self.assertIs(self.kernel.CreateMutexW.restype, ctypes.c_void_p)
        closed_handle = self.kernel.CloseHandle.call_args.args[0]
        self.assertEqual(closed_handle.value, 0x123456789)
        self.assertEqual([call.args[1] for call in self.msvcrt.locking.call_args_list], [2, 0])

    def test_existing_mutex_closes_new_handle_and_blocks_before_update(self):
        self.kernel.GetLastError.return_value = 183
        with self.assertRaisesRegex(engine.UpdateError, "Close the running SchemaCraft"):
            with engine._locked(self.target):
                self.fail("existing mutex was ignored")
        self.assertEqual(self.kernel.CloseHandle.call_count, 1)
        self.assertEqual(self.kernel.CloseHandle.call_args.args[0].value, 0x123456789)

    def test_lock_contention_blocks_without_creating_mutex(self):
        self.msvcrt.locking.side_effect = OSError("synthetic sharing violation")
        with self.assertRaisesRegex(engine.UpdateError, "Another update"):
            with engine._locked(self.target):
                self.fail("active byte-range lock was ignored")
        self.kernel.CreateMutexW.assert_not_called()

    def test_process_handles_are_64_bit_and_access_denial_is_conservative(self):
        self.kernel.OpenProcess.return_value = 0xABCDEFFED
        self.assertTrue(engine._process_exists(1234))
        self.assertIs(self.kernel.OpenProcess.restype, ctypes.c_void_p)
        self.assertEqual(self.kernel.CloseHandle.call_args.args[0].value, 0xABCDEFFED)
        self.kernel.OpenProcess.return_value = 0
        self.kernel.GetLastError.return_value = 5
        self.assertTrue(engine._process_exists(1234))
        self.kernel.GetLastError.return_value = 87
        self.assertFalse(engine._process_exists(1234))

    def test_private_backup_acl_uses_ascii_sid_with_non_utf8_account_name(self):
        output = b'"OFFICE\\\x81\x82\xe0\xe1","S-1-5-21-123-456-789-1001"\r\n'
        with mock.patch.object(engine.subprocess, "run", side_effect=[types.SimpleNamespace(stdout=output), types.SimpleNamespace(stdout=b"")]) as run:
            engine._secure_work(self.target)
        self.assertEqual(run.call_args_list[0].args[0], ["whoami", "/user", "/fo", "csv", "/nh"])
        self.assertNotIn("text", run.call_args_list[0].kwargs)
        self.assertEqual(run.call_args_list[1].args[0], ["icacls", str(self.target), "/inheritance:r", "/grant:r", "*S-1-5-21-123-456-789-1001:(OI)(CI)F"])

    def test_missing_or_multiple_sids_never_widen_backup_permissions(self):
        for output in (b'"OFFICE\\username","unrecognized"\r\n', b'"one","S-1-5-21-1"\r\n"two","S-1-5-21-2"\r\n', b'S-1-5-21-1suffix', b'S-1-5-21-1-', b'prefixS-1-5-21-1'):
            with self.subTest(output=output):
                with mock.patch.object(engine.subprocess, "run", return_value=types.SimpleNamespace(stdout=output)) as run:
                    with self.assertRaisesRegex(engine.UpdateError, "identify the Windows account"):
                        engine._secure_work(self.target)
                self.assertEqual(run.call_count, 1)

    def test_ascii_sid_in_table_output_is_accepted_without_decoding_username(self):
        output = b'USER INFORMATION\r\nName SID\r\n\x81\x82\xe0 S-1-5-21-123-456-789-1001\r\n'
        with mock.patch.object(engine.subprocess, "run", side_effect=[types.SimpleNamespace(stdout=output), types.SimpleNamespace(stdout=b"")]) as run:
            engine._secure_work(self.target)
        self.assertEqual(run.call_args_list[1].args[0][-1], "*S-1-5-21-123-456-789-1001:(OI)(CI)F")


if __name__ == "__main__":
    unittest.main()
