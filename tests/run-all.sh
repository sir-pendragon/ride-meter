#!/bin/sh
cd "$(dirname "$0")/.." && for t in tests/*.test.js tests/*.test.mjs; do echo "== $t"; node "$t" | tail -1 || exit 1; done
for t in tests/*_test.py; do echo "== $t"; python3 "$t" | tail -1 || exit 1; done
