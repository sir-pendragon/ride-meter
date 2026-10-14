# tools/

`muni_inventory.py` — 市町村の通行規制ページ台帳(`data/muni-inventory/`)を更新する Python スクリプト。
標準ライブラリだけ。LLM・トークン・GitHub Actions は使わず、手元のPCで実行する。

```
python tools/muni_inventory.py domains          # Wikidataから各市町村の公式サイトのトップを集める(初回のみ)
python tools/muni_inventory.py scan --pref 神奈川県   # 未確認の市町村を調べる(1サイト最大8リクエスト、1秒以上空ける)
python tools/muni_inventory.py report
```

機械判定なので、台帳の `notes` に「[自動]」と付く行は目視で見直すこと。取得できなかっただけでは状態を下げない。

## 市町村の表と CSS の確認(通信量を減らすための道具)

- `python tools/build_muni_table.py` … 国土地理院の `muni.js` から市町村の表を作り、`data/muni-table.json` に保存します(PCで実行)。アプリは、端末に保存した表 → このファイル → 国土地理院、の順に使います。市町村の合併があったときは、もう一度実行してコミットしてください。`--check` で、保存済みの表との差だけ確認できます。
- `python tools/css_audit.py` … 各ページのCSSで、同じ宣言のルールと、使われていないクラス・IDの疑いを表示します。ファイルは書き換えません(動的に作るクラス名は検出できないため、削除は人が確認してから)。
