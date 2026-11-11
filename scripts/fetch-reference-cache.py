#!/usr/bin/env python3
"""Clone the pinned reference repositories listed in cache-manifest.json.

Each repository is cloned in full, including its submodules, and checked out at
the pinned revision. A top-level symlink `.reference-cache/<id>` points at each
checkout, so both path styles resolve to one copy. Set https_proxy/http_proxy/
all_proxy in the environment when the network requires a proxy; git and its
submodule fetches honor them.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / 'docs/references/cache-manifest.json'
manifest = json.loads(manifest_path.read_text())
cache_root = ROOT / '.reference-cache/repositories'
link_root = cache_root.parent


def run_git(*args, cwd=None):
    subprocess.run(['git', *args], cwd=cwd, check=True)


for source in manifest['sources']:
    target = cache_root / source['id']
    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / '.git').exists():
        if target.exists() and any(target.iterdir()):
            raise RuntimeError(f"cache path exists but is not a git checkout: {target}")
        run_git('clone', '--recurse-submodules', source['repository'], str(target))
    else:
        origin = subprocess.check_output(
            ['git', 'remote', 'get-url', 'origin'], cwd=target, text=True
        ).strip()
        if origin.removesuffix('.git').rstrip('/') != source['repository'].removesuffix('.git').rstrip('/'):
            raise RuntimeError(f"unexpected origin for {target}: {origin}")
        run_git('fetch', 'origin', source['revision'], cwd=target)
    run_git('checkout', '--detach', source['revision'], cwd=target)
    run_git('submodule', 'update', '--init', '--recursive', cwd=target)
    link = link_root / source['id']
    relative = Path('repositories') / source['id']
    if link.is_symlink():
        if link.readlink() != relative:
            link.unlink()
            link.symlink_to(relative)
    elif link.exists():
        raise RuntimeError(f"remove the real directory so it can link to repositories/: {link}")
    else:
        link.symlink_to(relative)
    actual = subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=target, text=True
    ).strip()
    if actual != source['revision']:
        raise RuntimeError(f"revision mismatch for {source['id']}: {actual}")
    print(f"checked out {source['id']} at {actual}")
