# tools/

`muni_inventory.py` — 市町村の通行規制ページ台帳(`data/muni-inventory/`)を更新する Python スクリプト。
標準ライブラリだけ。LLM・トークン・GitHub Actions は使わず、手元のPCで実行する。

```
python tools/muni_inventory.py domains          # Wikidataから各市町村の公式サイトのトップを集める(初回のみ)
python tools/muni_inventory.py scan --pref 神奈川県   # 未確認の市町村を調べる(1サイト最大8リクエスト、1秒以上空ける)
python tools/muni_inventory.py report
```

機械判定なので、台帳の `notes` に「[自動]」と付く行は目視で見直すこと。取得できなかっただけでは状態を下げない。
