#!/usr/bin/env python3
"""Fetch only the file extracts pinned in docs/references/cache-manifest.json."""
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / 'docs/references/cache-manifest.json'
manifest = json.loads(manifest_path.read_text())


def looks_like_html(data):
    prefix = data.lstrip()[:512].lower()
    return prefix.startswith((b'<!doctype html', b'<html')) or b'<!doctype html' in prefix


for source in manifest['sources']:
    for item in source['files']:
        target = ROOT / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file():
            existing = target.read_bytes()
            if looks_like_html(existing):
                raise RuntimeError(f"HTML/challenge content found in cache: {item['path']}")
            print(f"using existing {item['path']}")
            continue
        with urlopen(item['url'], timeout=60) as response:
            if response.status != 200 or 'text/html' in response.headers.get('Content-Type', '').lower():
                raise RuntimeError(f"unexpected HTTP response: {response.status} {response.headers.get('Content-Type')}: {item['url']}")
            data = response.read()
        if looks_like_html(data):
            raise RuntimeError(f"HTML/challenge response from {item['url']}")
        target.write_bytes(data)
        print(f"fetched {item['path']} ({item['bytes']} bytes)")
