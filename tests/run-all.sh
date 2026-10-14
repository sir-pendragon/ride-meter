#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
exec python3 tests/run-suite.py --label regression
