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

## 峠の座標データベース(Overpass を待たずに峠・鞍部・山頂を引く)

`route/index.html` は、`data/osm-pass/jp.json` があれば、最大獲得標高の峠探しと、快適・絶景の国道を避ける迂回(peak は使わない)に、この同梱データを先に使います。検索範囲がデータの範囲に収まらないとき、ファイルがないとき、問い合わせに含めていない種類が要るときは、従来どおり Overpass に聞きます。

作り方(元データは OSM。Overpass の生データ JSON から変換):

1. https://overpass-turbo.eu/ で次を実行し、「エクスポート → 生データ(JSON)」で保存する(範囲は埼玉・東京の全域と山梨・群馬の県境付近)。
   ```
   [out:json][timeout:180];
   (node["mountain_pass"="yes"](35.7,138.4,36.3,139.9);
    node["natural"="saddle"](35.7,138.4,36.3,139.9);
    node["natural"="peak"]["ele"](35.7,138.4,36.3,139.9););
   out body qt;
   ```
2. `python3 tools/build_pass_db.py <保存したJSON> --bbox 35.7,138.4,36.3,139.9`
   (`--date` で取得日、`--kinds pass,saddle` で山頂を含めなかったときの指定)
3. できた `data/osm-pass/jp.json` をコミットする。結果カードには「峠のデータ: 同梱の座標データベース(OSM 取得日)」と出る。

形式: 0.1°の升目(`idx`)ごとに点(`pts`: 緯度・経度・標高・種類・名前)を並べた索引つき。峠は升目だけ見て引くので、Overpass の数十秒の待ちがなくなる。
