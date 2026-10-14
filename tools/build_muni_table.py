#!/usr/bin/env python3
"""市町村の表(コード→県名・市町村名)を、国土地理院の muni.js から作り、data/muni-table.json に保存する。

  python tools/build_muni_table.py            # 取得して保存(PCで実行。標準ライブラリだけ)
  python tools/build_muni_table.py --check    # 保存済みの表を、いまの muni.js と比べる(保存はしない)

アプリは、端末に保存した表 → このファイル → 国土地理院、の順に使います。
このファイルがあると、初回でも国土地理院の muni.js(約150KB)を取りに行きません。
市町村の合併などで表が変わったときは、もう一度実行して、コミットしてください。
"""
import argparse, datetime, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'muni-table.json')
URL = 'https://maps.gsi.go.jp/js/muni.js'
ROW = re.compile(r'MUNI_ARRAY\["(\d+)"\]\s*=\s*\'([^\']*)\'')


def parse(text):
    """muni.js の本文から {5桁コード: [県名, 市町村名]} を作る。県名・市町村名はカンマ区切りの2・4番目。"""
    t = {}
    for m in ROW.finditer(text):
        a = m.group(2).split(',')
        if len(a) >= 4: t[m.group(1).zfill(5)] = [a[1], a[3]]
    return t


def fetch():
    req = urllib.request.Request(URL, headers={'User-Agent': 'ride-meter-tools/1'})
    with urllib.request.urlopen(req, timeout=30) as r: return r.read().decode('utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    t = parse(fetch())
    if len(t) < 1000: sys.exit(f'表が小さすぎます({len(t)}件)。取得に失敗した可能性があります。保存しません。')
    if a.check:
        old = json.load(open(OUT, encoding='utf-8'))['t'] if os.path.exists(OUT) else {}
        add = sorted(set(t) - set(old)); rem = sorted(set(old) - set(t)); chg = sorted(k for k in set(t) & set(old) if t[k] != old[k])
        print(f'現在 {len(t)} 件 / 保存済み {len(old)} 件 / 追加 {len(add)} / 削除 {len(rem)} / 変更 {len(chg)}'); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fp:
        json.dump({'at': datetime.date.today().isoformat(), 'source': URL, 't': t}, fp, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(t)} 件を {OUT} に保存しました。コミットしてください。')


if __name__ == '__main__':
    main()
