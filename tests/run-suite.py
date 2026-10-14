"""Portable test runner. Each subprocess exit status is retained; E2E uses mocks."""
import argparse, json, os, pathlib, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--e2e', action='store_true')
parser.add_argument('--label', default='regression')
parser.add_argument('--jobs', type=int, choices=(1,2), default=1)
args = parser.parse_args()
out = ROOT / 'artifacts'
out.mkdir(exist_ok=True)
files = sorted((ROOT / 'tests' / 'e2e').glob('*.pw.py')) if args.e2e else sorted(
    list((ROOT / 'tests').glob('*.test.js')) + list((ROOT / 'tests').glob('*.test.mjs')) + list((ROOT / 'tests').glob('*_test.py')))
def execute(path):
    command = [sys.executable if path.suffix == '.py' else 'node', str(path)]
    started = time.monotonic()
    try:
        run = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=170, env=dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUTF8='1'))
        code, log = run.returncode, run.stdout + run.stderr
    except subprocess.TimeoutExpired as error:
        code, log = 124, (error.stdout or b'') + (error.stderr or b'') + b'\nTIMEOUT'
    (out / f'{args.label}-{path.name}.log').write_bytes(log)
    item = {'test': path.name, 'exit': code, 'seconds': round(time.monotonic()-started, 2)}
    return item
results = []
with ThreadPoolExecutor(max_workers=args.jobs) as pool:
    for future in as_completed([pool.submit(execute, path) for path in files]):
        item=future.result();results.append(item);print(json.dumps(item), flush=True)
results.sort(key=lambda item:item['test'])
(out / f'{args.label}-summary.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
sys.exit(int(any(item['exit'] != 0 for item in results)))
