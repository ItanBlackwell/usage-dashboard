#!/usr/bin/env python3
# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
"""Build reproducible, secret-free Source and one-click Portable ZIP distributions."""
from pathlib import Path
import json
import zipfile
import hashlib
import base64
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
release = ROOT / 'release'
release.mkdir(exist_ok=True)

lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
pin = lock['packages']['node_modules/playwright-core']
runtime_url = f"https://registry.npmjs.org/playwright-core/-/playwright-core-{pin['version']}.tgz"
if pin['resolved'] != runtime_url:
    raise RuntimeError('Unexpected Billing runtime URL')
with urllib.request.urlopen(runtime_url, timeout=90) as response:
    runtime = response.read(40 * 1024 * 1024 + 1)
if len(runtime) > 40 * 1024 * 1024:
    raise RuntimeError('Billing runtime archive too large')
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(runtime).digest()).decode('ascii')
if integrity != pin['integrity']:
    raise RuntimeError('Billing runtime integrity check failed')

portable_files = (
    'package.json', 'package-lock.json', 'dist/gui-experimental.cjs',
    'browser-extension/manifest.json', 'browser-extension/background.js',
    'browser-extension/content.js',
    'installer/Common.ps1', 'installer/Install-UsageDashboard.ps1',
    'installer/Uninstall-UsageDashboard.ps1',
    'Install.cmd', 'Uninstall.cmd', 'README.md', 'LICENSE', 'NOTICE',
    'docs/INSTALLATION.md', 'docs/BROWSER_EXTENSION.md', 'docs/BILLING_SESSION.md', 'usage-dashboard-preview.png',
    'browser-extension/NOTICE.txt',
)
portable = release / f'Usage-Dashboard-Portable-{version}.zip'
with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in portable_files:
        p = ROOT / name
        if not p.is_file(): raise RuntimeError(f'Missing portable file: {name}')
        z.write(p, f'Usage-Dashboard/{name}')
    z.writestr('Usage-Dashboard/vendor/playwright-core.tgz', runtime)

source = release / f'Usage-Dashboard-Source-{version}.zip'
excludes = {'.git', '.github-cache', 'release', 'node_modules', '__pycache__', 'tests', 'billing-sessions', '.usage-dashboard-userdata', 'vendor'}
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file() or any(part in excludes for part in p.relative_to(ROOT).parts): continue
        if p.name in {'pairing.json', 'settings.json', 'binding.json', 'snapshot.json', 'Test-UsageDashboard.ps1', 'test-results.txt'} or p.name.startswith('.env') or p.suffix in {'.tmp','.bak','.log'}: continue
        z.write(p, f'Usage-Dashboard-Source/{p.relative_to(ROOT).as_posix()}')

print(portable)
print(source)
