"""Assemble data-free, offline graphical migration release directories/ZIPs."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

BUILD = Path(__file__).resolve().parent
UPDATES = BUILD.parents[1]
APP = UPDATES.parent/'App'
RELEASE = '2026.10.08-1'

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

def clean_python(root):
    for path in list(root.rglob('__pycache__')):
        if path.is_dir(): shutil.rmtree(path)
    for path in root.rglob('*.pyc'): path.unlink()
    for path in root.rglob('libpython*.a'): path.unlink()

def assemble(platform):
    windows = platform == 'windows'
    native = BUILD/'platforms'/platform
    if not (native/'runtime/postgresql/runtime-manifest.json').is_file():
        raise RuntimeError('Sealed PostgreSQL runtime is not ready: '+platform)
    name = 'SchemaCraft_PostgreSQL_Update_'+('Windows_x64' if windows else 'Linux_x64')
    package = BUILD/'release'/name
    if package.exists(): shutil.rmtree(package)
    package.mkdir(parents=True)
    payload = package/'payload'
    payload.mkdir()
    tracked = subprocess.check_output(['git','ls-files','-z'],cwd=APP).decode().split('\0')
    selected = set(tracked) | {'schemacraft_storage_probe.py','schemacraft_update_lock.py'}
    for rel in sorted(selected):
        source=APP/rel
        if not source.is_file(): continue
        allowed = rel.startswith(('app/','assets/','docs/')) or ('/' not in rel and (rel.endswith('.py') or rel in {'package.json','requirements.txt','THIRD_PARTY_ALERT_CALENDARS.txt'}))
        if not allowed: continue
        destination=payload/rel
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,destination)
    shutil.copytree(native/'vendor/python',payload/'vendor/python')
    clean_python(payload/'vendor/python')
    shutil.copytree(native/'runtime/postgresql',payload/'runtime/postgresql')
    # The updater has its own interpreter so moving the application cannot
    # invalidate a running GUI or loaded DLL on Windows.
    shutil.copytree(payload/'vendor/python',package/'vendor/python')
    for rel in ('engine.py','UPDATER_GUI.py','updater_launcher.py','GUI_GUIDE.md'):
        shutil.copy2(BUILD/'core'/rel,package/rel)
    (payload/'portable-runtime.json').write_text(json.dumps({'format_version':1,'kind':'private-cpython',
        'platform':platform+'-x86_64','release':RELEASE},indent=2)+'\n',encoding='utf-8')
    if windows:
        shutil.copy2(BUILD/'launchers/SchemaCraft.exe',payload/'SchemaCraft.exe')
        shutil.copy2(BUILD/'launchers/UPDATE.exe',package/'UPDATE.exe')
        shutil.copy2(BUILD/'launchers/UPDATE.exe',package/'SchemaCraft-Updater.exe')
        shutil.copy2(BUILD/'core/UPDATE_WINDOWS.bat',package/'UPDATE_WINDOWS.bat')
        application=['SchemaCraft.exe']
        python=['vendor/python/python.exe','-B','SchemaCraft.py']
    else:
        app_launcher=payload/'SchemaCraft'
        app_launcher.write_text('''#!/bin/sh
set -eu
SC_APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SC_APP_ROOT/vendor/python/bin/python3" "$SC_APP_ROOT/SchemaCraft.py" "$@"
''')
        app_launcher.chmod(0o755)
        updater=package/'SchemaCraft-Updater'
        updater.write_text('''#!/bin/sh
set -eu
SC_UPDATE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SC_UPDATE_ROOT/vendor/python/bin/python3" "$SC_UPDATE_ROOT/updater_launcher.py" --package "$SC_UPDATE_ROOT" "$@"
''')
        updater.chmod(0o755)
        shutil.copy2(BUILD/'core/UPDATE_LINUX.sh',package/'UPDATE_LINUX.sh')
        (package/'UPDATE_LINUX.sh').chmod(0o755)
        application=['SchemaCraft']
        python=['vendor/python/bin/python3','-B','SchemaCraft.py']
    manifest={'format_version':1,'update_id':'SchemaCraft-PostgreSQL-'+RELEASE,
        'platform':platform+'-x86_64','application_command':application,
        'migration_command':python+['--migrate-storage'],'probe_command':python+['--storage-probe'],
        'native_execution_verified':not windows,'files':[]}
    for path in list(payload.rglob('__pycache__')):
        if path.is_dir(): shutil.rmtree(path)
    for path in sorted(payload.rglob('*')):
        if not path.is_file(): continue
        mode=0o755 if path.stat().st_mode & 0o111 else 0o644
        path.chmod(mode)
        manifest['files'].append({'path':path.relative_to(payload).as_posix(),'size':path.stat().st_size,
            'sha256':digest(path),'mode':mode})
    (package/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    guide=BUILD/'UPDATE_GUIDE.md'
    if guide.exists(): shutil.copy2(guide,package/'START_HERE.md')
    verification=BUILD/'VERIFICATION.md'
    if verification.exists(): shutil.copy2(verification,package/'VERIFICATION.md')
    source=package/'updater-source'
    shutil.copytree(BUILD/'launchers',source/'launchers',ignore=shutil.ignore_patterns('*.obj','*.lib','*-stub.dll','*.exe'))
    shutil.copytree(BUILD/'tests',source/'tests',ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(Path(__file__),source/'assemble_packages.py')
    # Inventory all deliverables as well as the separately checked app payload.
    checksum_lines=[]
    for path in sorted(package.rglob('*')):
        if path.is_file(): checksum_lines.append(digest(path)+'  '+path.relative_to(package).as_posix())
    (package/'SHA256SUMS.txt').write_text('\n'.join(checksum_lines)+'\n',encoding='utf-8')
    archive=UPDATES/(name+'.zip')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as target:
        for path in sorted(package.rglob('*')):
            if path.is_file(): target.write(path,name+'/'+path.relative_to(package).as_posix())
    print(json.dumps({'platform':platform,'package':str(package),'zip':str(archive),
        'bytes':archive.stat().st_size,'sha256':digest(archive),'payload_files':len(manifest['files'])}))
    return package

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--platform',choices=['linux','windows','both'],default='both')
    args=parser.parse_args()
    for platform in (['windows','linux'] if args.platform=='both' else [args.platform]): assemble(platform)
