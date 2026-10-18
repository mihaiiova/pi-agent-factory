#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node --test --test-name-pattern='Node and Python' "$root/tests/project-state/accounting.test.mjs"
