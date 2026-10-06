#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22.13 or later is required: https://nodejs.org/'
  exit 1
fi
exec node scripts/setup-mybox.mjs "$@"
