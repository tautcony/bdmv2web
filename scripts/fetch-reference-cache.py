#!/usr/bin/env python3
"""Clone pinned reference repositories and create portable cache aliases.

Each repository is cloned in full, including its submodules, and checked out at
the pinned revision. Cache aliases use relative directory symlinks on POSIX and
directory junctions on Windows, which do not require symlink privileges. Set
https_proxy/http_proxy/all_proxy when Git needs a proxy.
"""
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / 'docs/references/cache-manifest.json'
CACHE_ROOT = ROOT / '.reference-cache/repositories'
LINK_ROOT = CACHE_ROOT.parent


def run_git(*args, cwd=None):
    subprocess.run(['git', *args], cwd=cwd, check=True)


def is_directory_link(path):
    """Recognize directory symlinks and Windows junctions."""
    if path.is_symlink():
        return True

    is_junction = getattr(path, 'is_junction', None)
    if is_junction is not None and is_junction():
        return True

    # Path.is_junction() was added in Python 3.12. Keep junction recognition
    # available on earlier supported Python versions as well.
    if os.name == 'nt':
        try:
            return getattr(path.lstat(), 'st_reparse_tag', None) == 0xA0000003
        except FileNotFoundError:
            return False
    return False


def remove_directory_link(path):
    if os.name == 'nt':
        # rmdir removes a junction or directory symlink without traversing it.
        os.rmdir(path)
    else:
        path.unlink()


def create_directory_link(link, target):
    if os.name == 'nt':
        # mklink /J creates an NTFS junction without requiring Developer Mode
        # or administrator privileges. Pass each path as an argument so spaces
        # in the repository path remain intact.
        subprocess.run(
            ['cmd.exe', '/d', '/c', 'mklink', '/J', str(link), str(target)],
            check=True,
            capture_output=True,
            text=True,
        )
        return 'junction'

    link.symlink_to(Path('repositories') / target.name, target_is_directory=True)
    return 'symlink'


def ensure_cache_alias(link, target):
    link.parent.mkdir(parents=True, exist_ok=True)
    if is_directory_link(link):
        try:
            if link.resolve() == target.resolve():
                return 'junction' if os.name == 'nt' else 'symlink'
        except OSError:
            pass
        remove_directory_link(link)
    elif link.exists():
        raise RuntimeError(f"cache path exists and is not a directory link: {link}")

    return create_directory_link(link, target)


def initialize():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)

    for source in manifest['sources']:
        target = CACHE_ROOT / source['id']
        if not (target / '.git').exists():
            if target.exists() and any(target.iterdir()):
                raise RuntimeError(f"cache path exists but is not a git checkout: {target}")
            run_git('clone', '--recurse-submodules', source['repository'], str(target))
        else:
            origin = subprocess.check_output(
                ['git', 'remote', 'get-url', 'origin'], cwd=target, text=True
            ).strip()
            normalized_origin = origin.removesuffix('.git').rstrip('/')
            expected_origin = source['repository'].removesuffix('.git').rstrip('/')
            if normalized_origin != expected_origin:
                raise RuntimeError(f"unexpected origin for {target}: {origin}")
            run_git('fetch', 'origin', source['revision'], cwd=target)

        run_git('checkout', '--detach', source['revision'], cwd=target)
        run_git('submodule', 'update', '--init', '--recursive', cwd=target)
        link = LINK_ROOT / source['id']
        link_kind = ensure_cache_alias(link, target)

        actual = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=target, text=True
        ).strip()
        if actual != source['revision']:
            raise RuntimeError(f"revision mismatch for {source['id']}: {actual}")
        print(f"checked out {source['id']} at {actual} ({link_kind}: {link})")


if __name__ == '__main__':
    initialize()
