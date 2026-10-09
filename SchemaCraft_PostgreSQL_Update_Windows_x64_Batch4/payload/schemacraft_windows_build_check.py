"""Fail Windows builds before publishing an executable with missing storage support.

These checks only inspect build inputs/artifacts. They never open the application
workspace or connect to PostgreSQL.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.resources
import json
import io
import re
import sys
import zipfile
from email.parser import Parser
from pathlib import Path, PurePosixPath
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


DRIVER_VERSION = "3.3.3"
TIMEZONE_VERSION = "2026.5"
REQUIRED_MODULES = frozenset({
    "psycopg", "psycopg.pq", "psycopg.types.json", "psycopg_binary",
    "schemacraft_storage", "schemacraft_postgres_runtime",
    "schemacraft_migration", "schemacraft_storage_probe", "schemacraft_update_lock",
    "schemacraft_build_probe",
    "tzdata", "tzdata.zoneinfo",
})


def check_dependencies() -> dict:
    """Load the exact native driver that must subsequently be frozen."""
    psycopg = importlib.import_module("psycopg")
    binary = importlib.import_module("psycopg_binary")
    importlib.import_module("psycopg_binary.pq")
    importlib.import_module("psycopg.types.json")
    if psycopg.__version__ != DRIVER_VERSION or binary.__version__ != DRIVER_VERSION:
        raise ValueError(f"Both psycopg and psycopg-binary must be {DRIVER_VERSION}.")
    if psycopg.pq.__impl__ != "binary":
        raise ValueError("The build must use the bundled psycopg binary implementation.")
    tzdata = importlib.import_module("tzdata")
    if tzdata.__version__ != TIMEZONE_VERSION:
        raise ValueError(f"The build must use timezone data {TIMEZONE_VERSION}.")
    # A host's OS timezone database can mask missing wheel resources on Linux.
    # Test both the packaged UTC resource and the normal lookup used on Windows.
    with importlib.resources.files("tzdata.zoneinfo").joinpath("UTC").open("rb") as resource:
        packaged_utc = ZoneInfo.from_file(resource, key="UTC")
    if (datetime(2000, 1, 1, tzinfo=packaged_utc).utcoffset() != timedelta(0)
            or datetime(2000, 1, 1, tzinfo=ZoneInfo("UTC")).utcoffset() != timedelta(0)):
        raise ValueError("Bundled UTC timezone data could not be loaded.")
    return {"driver": psycopg.__version__, "implementation": psycopg.pq.__impl__, "timezone_data": tzdata.__version__}


def validate_archive_contents(module_names, binary_names, data_names=()) -> dict:
    """Reject a freeze that silently skipped a hidden import or native library."""
    missing = sorted(REQUIRED_MODULES.difference(module_names))
    names = {str(name).replace("\\", "/").lower() for name in binary_names}
    data = {str(name).replace("\\", "/").lower() for name in data_names}
    if "tzdata/zoneinfo/utc" not in data:
        missing.append("bundled UTC timezone resource")
    if not any(name.startswith("psycopg_binary/pq.") and name.endswith(".pyd") for name in names):
        missing.append("psycopg_binary native pq extension")
    if not any(name.startswith("psycopg_binary/_psycopg.") and name.endswith(".pyd") for name in names):
        missing.append("psycopg_binary native adapter extension")
    for library in ("libpq", "libssl", "libcrypto"):
        if not any(PurePosixPath(name).name.startswith(library) and name.endswith(".dll") for name in names):
            missing.append(f"{library} DLL")
    if missing:
        raise ValueError("Executable is missing required PostgreSQL components: " + ", ".join(missing))
    return {"required_modules": len(REQUIRED_MODULES), "native_storage_support": True}


def check_archive(path: Path) -> dict:
    from PyInstaller.archive.readers import CArchiveReader
    archive = CArchiveReader(str(path))
    modules = set()
    binaries = set()
    data = set()
    utc_entry = None
    for name, entry in archive.toc.items():
        if entry[-1] == "z":
            modules.update(archive.open_embedded_archive(name).toc)
        elif entry[-1] in {"m", "M"}:
            modules.add(name)
        elif entry[-1] == "b":
            binaries.add(name)
            # PyInstaller uses 'b' for data files with an executable access
            # bit too; the Windows build can serialize timezone files this way.
            data.add(name)
        elif entry[-1] == "x":
            data.add(name)
        if entry[-1] in {"b", "x"} and name.replace("\\", "/").lower() == "tzdata/zoneinfo/utc":
            utc_entry = name
    result = validate_archive_contents(modules, binaries, data)
    utc = ZoneInfo.from_file(io.BytesIO(archive.extract(utc_entry)), key="UTC")
    if datetime(2000, 1, 1, tzinfo=utc).utcoffset() != timedelta(0):
        raise ValueError("Executable contains invalid bundled UTC timezone data.")
    result["executable_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def check_probe_report(path: Path) -> dict:
    report = json.loads(path.read_text(encoding="utf-8"))
    if (report.get("status") != "verified_build" or report.get("frozen") is not True
            or report.get("driver_implementation") != "binary"
            or report.get("driver_version") != DRIVER_VERSION
            or report.get("binary_version") != DRIVER_VERSION
            or report.get("runtime_major") != 18
            or report.get("timezone_support") is not True
            or report.get("runtime_platform") != "windows-x86_64"):
        raise ValueError("The new executable did not pass its isolated PostgreSQL build probe.")
    return {"frozen_driver_import": True, "runtime_major": report["runtime_major"]}


def _normalized_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _windows_python313_tag(tag: str) -> bool:
    interpreter, abi, platform = tag.split("-")
    if platform not in {"any", "win_amd64"}:
        return False
    if abi == "abi3" and interpreter.startswith("cp"):
        return (3, 2) <= (int(interpreter[2]), int(interpreter[3:])) <= (3, 13)
    return abi in {"none", "cp313"} and any(
        value in {"py2", "py3", "py313", "cp313"} for value in interpreter.split(".")
    ) and not (interpreter == "py2")


def _check_windows_dependency_closure(required, metadata_by_name, wheel_by_name) -> int:
    """Evaluate wheel markers for Windows even when this check runs on Linux."""
    if not any(metadata.get_all("Requires-Dist", []) for metadata in metadata_by_name.values()):
        return 0
    try:
        from packaging.requirements import Requirement
    except ImportError:
        # A fresh full Python installation need not already have packaging.
        # Its verified pure-Python offline wheel supports this read-only check.
        wheel = wheel_by_name.get("packaging")
        if wheel is None:
            raise ValueError("The offline dependency checker requires the pinned packaging wheel.")
        sys.path.insert(0, str(wheel.resolve()))
        try:
            from packaging.requirements import Requirement
        finally:
            sys.path.pop(0)
    environment = {"implementation_name": "cpython", "implementation_version": "3.13.13",
        "os_name": "nt", "platform_machine": "AMD64", "platform_python_implementation": "CPython",
        "platform_release": "10", "platform_system": "Windows", "platform_version": "10.0.19045",
        "python_full_version": "3.13.13", "python_version": "3.13", "sys_platform": "win32", "extra": ""}
    checked = 0
    for name, metadata in metadata_by_name.items():
        for value in metadata.get_all("Requires-Dist", []):
            dependency = Requirement(value)
            if dependency.marker is not None and not dependency.marker.evaluate(environment):
                continue
            needed = _normalized_name(dependency.name)
            if needed not in required or needed not in metadata_by_name:
                raise ValueError(f"Windows dependency of {name} is missing from the pinned wheelhouse: {needed}")
            if dependency.specifier and not dependency.specifier.contains(required[needed], prereleases=True):
                raise ValueError(f"Windows dependency of {name} has an incompatible pin: {needed}=={required[needed]}")
            checked += 1
    return checked


def check_wheelhouse(root: Path) -> dict:
    """Check that every pinned build dependency has a compatible offline wheel."""
    required = {}
    for raw in (root / "requirements-build.txt").read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        match = re.fullmatch(r"([\w.-]+)==([\w.+-]+)", line)
        if match is None:
            raise ValueError(f"Build requirements must be explicitly pinned: {line}")
        required[_normalized_name(match[1])] = match[2]
    available = set()
    metadata_by_name = {}
    wheel_by_name = {}
    hashes = {}
    sums = root / "Packages" / "SHA256SUMS.txt"
    if sums.is_file():
        for line in sums.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            digest, filename = line.split(maxsplit=1)
            hashes[PurePosixPath(filename.lstrip("*").replace("\\", "/")).name] = digest
    for wheel in (root / "Packages").glob("*.whl"):
        with zipfile.ZipFile(wheel) as archive:
            # Setuptools contains vendored distributions with their own metadata.
            # A wheel's authoritative distribution metadata is at its top level.
            metadata_paths = [name for name in archive.namelist()
                if name.count("/") == 1 and name.endswith(".dist-info/METADATA")]
            if len(metadata_paths) != 1:
                raise ValueError(f"Invalid wheel metadata: {wheel.name}")
            metadata = Parser().parsestr(archive.read(metadata_paths[0]).decode("utf-8"))
            name, version = _normalized_name(metadata["Name"]), metadata["Version"]
            if required.get(name) != version:
                continue
            wheel_metadata = Parser().parsestr(archive.read(metadata_paths[0].removesuffix("METADATA") + "WHEEL").decode("utf-8"))
            if not any(_windows_python313_tag(tag) for tag in wheel_metadata.get_all("Tag", [])):
                continue
        if hashes and hashes.get(wheel.name) != hashlib.sha256(wheel.read_bytes()).hexdigest():
            raise ValueError(f"Offline wheel checksum failed: {wheel.name}")
        available.add(name)
        metadata_by_name[name] = metadata
        wheel_by_name[name] = wheel
    missing = sorted(set(required).difference(available))
    if missing:
        raise ValueError("Missing compatible offline wheels: " + ", ".join(missing) + ". Run prepare-packages.bat on an online Windows computer, then copy its Packages folder.")
    relationships = _check_windows_dependency_closure(required, metadata_by_name, wheel_by_name)
    return {"offline_dependencies": len(required), "windows_dependency_relationships": relationships}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dependencies", action="store_true")
    group.add_argument("--archive", type=Path)
    group.add_argument("--wheelhouse", type=Path)
    group.add_argument("--probe-report", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.dependencies:
            result = check_dependencies()
        elif args.archive:
            result = check_archive(args.archive)
        elif args.probe_report:
            result = check_probe_report(args.probe_report)
        else:
            result = check_wheelhouse(args.wheelhouse)
    except Exception as exc:
        print(f"ERROR: Windows build verification failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print("Windows build verification passed: " + ", ".join(f"{key}={value}" for key, value in result.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
