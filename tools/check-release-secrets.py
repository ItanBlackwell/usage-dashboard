#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Scan build archives without printing possible secrets."""
import re
import sys
import zipfile
from pathlib import Path

PATTERNS = [
    rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    rb'gh[pousr]_[A-Za-z0-9]{36,}',
    rb'github_pat_[A-Za-z0-9_]{40,}',
    rb'sk-(?:proj-|ant-api03-)?[A-Za-z0-9_-]{40,}',
    rb'AKIA[A-Z0-9]{16}',
]
for archive in sorted(Path('release').glob('*.zip')):
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            if info.file_size > 32 * 1024 * 1024:
                sys.exit('Archive member exceeds scan limit')
            data = z.read(info)
            # Skip this scanner's own pattern definitions only.
            if info.filename.endswith('/tools/check-release-secrets.py'):
                continue
            if any(re.search(pattern, data) for pattern in PATTERNS):
                sys.exit('Potential credential detected in release archive; inspect locally')
print('Archive credential pattern checks passed')
