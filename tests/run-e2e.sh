#!/bin/sh
# 画面を動かすテスト(Playwright)。時間がかかるため run-all.sh とは別。失敗があれば終了コード1
cd "$(dirname "$0")/.." || exit 1
exec python3 tests/run-suite.py --e2e --label regression-e2e
