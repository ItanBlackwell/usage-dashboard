#!/usr/bin/env python3
# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
"""Build reproducible, secret-free Source and one-click Portable ZIP distributions."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
release = ROOT / 'release'
release.mkdir(exist_ok=True)

portable_files = (
    'package.json', 'package-lock.json', 'dist/gui-experimental.cjs',
    'installer/Common.ps1', 'installer/Install-UsageDashboard.ps1',
    'installer/Uninstall-UsageDashboard.ps1',
    'Install.cmd', 'Uninstall.cmd', 'README.md', 'LICENSE', 'NOTICE',
    'docs/INSTALLATION.md', 'docs/OPENCODE_BUDGETS.md', 'docs/PROVIDER_METRICS.md', 'usage-dashboard-preview.png',
)
portable = release / f'Usage-Dashboard-Portable-{version}.zip'
with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in portable_files:
        p = ROOT / name
        if not p.is_file(): raise RuntimeError(f'Missing portable file: {name}')
        z.write(p, f'Usage-Dashboard/{name}')

source = release / f'Usage-Dashboard-Source-{version}.zip'
excludes = {'.git', '.github-cache', 'release', 'node_modules', '__pycache__', 'tests', 'billing-sessions', '.usage-dashboard-userdata', '.usage-dashboard-legacy-backups', 'vendor', 'browser-extension'}
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file() or p.is_symlink() or any(part in excludes or part.startswith('.billing-runtime-') for part in p.relative_to(ROOT).parts): continue
        if p.relative_to(ROOT).as_posix() in {'src/balance-bridge.cjs', 'docs/BROWSER_EXTENSION.md', 'src/billing-session.cjs', 'docs/BILLING_SESSION.md', 'billing-runtime.json', 'installer/BillingWindow.ps1'}: continue
        if p.name in {'pairing.json', 'settings.json', 'binding.json', 'snapshot.json', 'Test-UsageDashboard.ps1', 'test-results.txt'} or p.name.startswith('.env') or p.suffix in {'.tmp','.bak','.log'}: continue
        z.write(p, f'Usage-Dashboard-Source/{p.relative_to(ROOT).as_posix()}')

print(portable)
print(source)
