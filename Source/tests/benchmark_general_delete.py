"""Run from Source: python tests/benchmark_general_delete.py [older-SchemaCraft.py].
Uses a disposable workspace with 32 MiB of unrelated attachment bytes.
"""
import ast
import os
import sys
import time
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_release3_abc import Release3ABCFeatureTests, GLOBAL_CATEGORY
import SchemaCraft as APP

if len(sys.argv) > 1:
    tree = ast.parse(Path(sys.argv[1]).read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'manage_global_definition')
    exec(compile(ast.Module(body=[function], type_ignores=[]), sys.argv[1], 'exec'), APP.__dict__)
fixture = Release3ABCFeatureTests()
fixture.setUp()
try:
    attachment = fixture.data / 'attachments' / 'benchmark.bin'
    attachment.parent.mkdir(exist_ok=True)
    attachment.write_bytes(os.urandom(1024 * 1024) * 32)
    APP.GLOBAL_DEFINITIONS.save_definition('category', GLOBAL_CATEGORY, {'label':'Benchmark category','kind':'main','fields':[]}, expected_revision=0)
    start = time.perf_counter()
    result = APP.manage_global_definition({'action':'delete','kind':'category','global_ref':GLOBAL_CATEGORY,'expected_revision':1})
    print(json.dumps({'delete_ms':round((time.perf_counter()-start)*1000,2), 'backup_bytes':(APP.BACKUP_DIR/result['backup']['filename']).stat().st_size, 'attachment_bytes':attachment.stat().st_size}))
finally:
    fixture.tearDown()
