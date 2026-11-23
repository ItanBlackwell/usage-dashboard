# Contributing

Thanks for helping improve Usage Dashboard.

## Before opening a pull request

1. Read the [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md).
2. Describe the bug or enhancement in an Issue, without any credentials or
   personal quota/billing data.
3. Use a short-lived feature branch and keep changes focused.
4. Verify with Node.js 22 or newer:

   ```sh
   node build.cjs
   node --check dist/gui-experimental.cjs
   python3 tools/make-distributions.py
   ```

5. Test manually in OpenCode Desktop, including **Side tabs** and **Inbox** modes.
   The GUI SDK and sidebar DOM adapter are experimental.
6. Add a changelog entry for user-facing changes and update docs when needed.

Standalone internal regression tests are not distributed in this repository.
CI instead performs build, packaging, static and clean-install smoke checks.
Do not claim a successful end-to-end test solely from a green CI run.

## Changes to provider integrations

Use documented provider endpoints when possible. A missing/unavailable API value
must never be represented as a zero balance. Never log provider credentials or
send them to the renderer. Avoid new network destinations without documenting
why they are required.

## Licensing

By submitting a contribution, you confirm that you have the rights needed to
contribute it under the Mozilla Public License 2.0 (MPL-2.0).
Each contributor retains copyright in their contributions; do not add code
under an incompatible license without discussing it with maintainers.
