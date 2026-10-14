#!/bin/sh
# 画面を動かすテスト(Playwright)。時間がかかるため run-all.sh とは別。失敗があれば終了コード1
cd "$(dirname "$0")/.." && rc=0
for t in tests/e2e/*.pw.py; do
  echo "== $t"; out=$(timeout 170 python3 "$t" 2>&1); r=$?
  echo "$out" | tail -1 | cut -c1-200
  [ $r -eq 0 ] || { echo "NG ($r): $t"; rc=1; }
done
exit $rc
