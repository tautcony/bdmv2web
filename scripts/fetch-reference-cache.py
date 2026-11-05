#!/usr/bin/env python3
"""Clone the pinned reference repositories listed in cache-manifest.json."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / 'docs/references/cache-manifest.json'
manifest = json.loads(manifest_path.read_text())
cache_root = ROOT / '.reference-cache/repositories'


def run_git(*args, cwd=None):
    subprocess.run(['git', *args], cwd=cwd, check=True)


for source in manifest['sources']:
    target = cache_root / source['id']
    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / '.git').exists():
        if target.exists() and any(target.iterdir()):
            raise RuntimeError(f"cache path exists but is not a git checkout: {target}")
        run_git('clone', source['repository'], str(target))
    else:
        origin = subprocess.check_output(
            ['git', 'remote', 'get-url', 'origin'], cwd=target, text=True
        ).strip()
        if origin.removesuffix('.git').rstrip('/') != source['repository'].removesuffix('.git').rstrip('/'):
            raise RuntimeError(f"unexpected origin for {target}: {origin}")
        run_git('fetch', 'origin', source['revision'], cwd=target)
    run_git('checkout', '--detach', source['revision'], cwd=target)
    actual = subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=target, text=True
    ).strip()
    if actual != source['revision']:
        raise RuntimeError(f"revision mismatch for {source['id']}: {actual}")
    print(f"checked out {source['id']} at {actual}")
