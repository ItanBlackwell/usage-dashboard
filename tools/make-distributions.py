#!/usr/bin/env python3
# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
"""Build reproducible, secret-free Source and one-click Portable ZIP distributions."""
from pathlib import Path
import json
import subprocess
import stat
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
def add_file(z, p, name):
    if p.is_symlink() or not p.is_file():
        raise RuntimeError(f'Invalid distribution file: {p}')
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, p.read_bytes(), compresslevel=9)

portable = release / f'Usage-Dashboard-Portable-{version}.zip'
with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in portable_files:
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise RuntimeError('Invalid source path')
        p = ROOT / relative
        if not p.resolve().is_relative_to(ROOT) or any(parent.is_symlink() for parent in p.parents if parent != ROOT and parent.is_relative_to(ROOT)):
            raise RuntimeError('Unsafe source path')
        if not p.is_file(): raise RuntimeError(f'Missing portable file: {name}')
        add_file(z, p, f'Usage-Dashboard/{name}')

source = release / f'Usage-Dashboard-Source-{version}.zip'
excludes = {'.git', '.github-cache', 'release', 'node_modules', '__pycache__', 'tests', 'billing-sessions', '.usage-dashboard-userdata', '.usage-dashboard-legacy-backups', 'vendor', 'browser-extension'}
manifest = ROOT / 'SOURCE_MANIFEST.json'
if (ROOT / '.git').exists():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
elif manifest.is_file() and not manifest.is_symlink():
    tracked = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(tracked, list) or not all(isinstance(name, str) for name in tracked):
        raise RuntimeError('Invalid source manifest')
else:
    raise RuntimeError('A Git checkout or distributed SOURCE_MANIFEST.json is required')
packaged = []
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in sorted(set(filter(None, tracked))):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise RuntimeError('Invalid source path')
        p = ROOT / relative
        if not p.resolve().is_relative_to(ROOT) or any(parent.is_symlink() for parent in p.parents if parent != ROOT and parent.is_relative_to(ROOT)):
            raise RuntimeError('Unsafe source path')
        if name == manifest.name:
            continue
        if not p.is_file() or p.is_symlink() or any(part in excludes or part.startswith('.billing-runtime-') for part in p.relative_to(ROOT).parts): continue
        if p.relative_to(ROOT).as_posix() in {'src/balance-bridge.cjs', 'docs/BROWSER_EXTENSION.md', 'src/billing-session.cjs', 'docs/BILLING_SESSION.md', 'billing-runtime.json', 'installer/BillingWindow.ps1'}: continue
        if p.name in {'pairing.json', 'settings.json', 'binding.json', 'snapshot.json', 'Test-UsageDashboard.ps1', 'test-results.txt'} or p.name.startswith('.env') or p.suffix in {'.tmp','.bak','.log'}: continue
        add_file(z, p, f'Usage-Dashboard-Source/{p.relative_to(ROOT).as_posix()}')
        packaged.append(p.relative_to(ROOT).as_posix())
    info = zipfile.ZipInfo('Usage-Dashboard-Source/SOURCE_MANIFEST.json', date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, json.dumps(packaged, indent=2) + '\n', compresslevel=9)

print(portable)
print(source)
