#!/usr/bin/env python3
"""Overpass の生データ(JSON)から、峠・鞍部・山頂の座標データベース(data/osm-pass/jp.json)を作る。

  python3 tools/build_pass_db.py <overpass.json> [--date YYYY-MM-DD] [--out data/osm-pass/jp.json]

入力: overpass-turbo の「エクスポート → 生データ(JSON)」など、{"elements":[{type:"node",lat,lon,tags:{...}}]} の形。
出力: {"v":1,"at":日付,"bbox":[s,w,n,e],"g":0.1,"kinds":[問い合わせに含めた種類],"pts":[[lat,lon,ele|null,k,name],...],"idx":{"緯度の升,経度の升":[開始,個数]}}
  pts は升目(0.1°)の順に並べ、idx で升目ごとの位置を引く。アプリは範囲内の升目だけを見る。
  k: 'pass'(mountain_pass=yes) / 'saddle'(natural=saddle) / 'peak'(natural=peak)。pass と saddle が両方付くときは pass。
  ele は数値に直せるときだけ(1,234 は桁区切り、12,5 は小数点、単位つきは数字だけ。直せなければ null)。
bbox は入力の点から求めた外接範囲ではなく、--bbox で問い合わせた範囲を渡す(渡さなければ点の外接範囲。端の升目は欠けている可能性がある)。
"""
import json, sys, re, math, argparse, datetime

def kind(t):
    if t.get('mountain_pass') == 'yes': return 'pass'
    if t.get('natural') == 'saddle': return 'saddle'
    if t.get('natural') == 'peak': return 'peak'
    return None

def ele_of(t):
    s = str(t.get('ele', '')).strip()
    s = re.sub(r'(\d),(\d{3})(?!\d)', r'\1\2', s)  # 1,234 → 1234(桁区切り)
    s = re.sub(r'(\d),(\d{1,2})(?!\d)', r'\1.\2', s)  # 12,5 → 12.5(小数点)
    m = re.match(r'^-?\d+(\.\d+)?', s)
    return round(float(m.group(0)), 1) if m else None

def build(elements, g=0.1, at=None, bbox=None, kinds=('pass', 'saddle', 'peak')):
    rows = []
    for e in elements:
        if e.get('type') != 'node' or 'lat' not in e: continue
        t = e.get('tags') or {}; k = kind(t)
        if not k or k not in kinds: continue
        rows.append((round(float(e['lat']), 5), round(float(e['lon']), 5), ele_of(t), k, t.get('name', '')))
    rows.sort(key=lambda r: (math.floor(r[0] / g), math.floor(r[1] / g), r[0], r[1]))
    idx = {}
    for i, r in enumerate(rows):
        key = f'{math.floor(r[0] / g)},{math.floor(r[1] / g)}'
        if key in idx: idx[key][1] += 1
        else: idx[key] = [i, 1]
    if bbox is None and rows:
        bbox = [min(r[0] for r in rows), min(r[1] for r in rows), max(r[0] for r in rows), max(r[1] for r in rows)]
    return {'v': 1, 'at': at or datetime.date.today().isoformat(), 'bbox': bbox, 'g': g,
            'kinds': sorted(kinds), 'n': len(rows), 'pts': [list(r) for r in rows], 'idx': idx}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('--date'); ap.add_argument('--out', default='data/osm-pass/jp.json')
    ap.add_argument('--bbox', help='s,w,n,e 問い合わせた範囲')
    ap.add_argument('--kinds', default='pass,saddle,peak', help='問い合わせに含めた種類(既定: 3種すべて)。含めていない種類は、同梱では引かずOverpassに聞く')
    a = ap.parse_args()
    with open(a.src, encoding='utf-8') as f: j = json.load(f)
    bb = [float(x) for x in a.bbox.split(',')] if a.bbox else None
    at = a.date or (j.get('osm3s') or {}).get('timestamp_osm_base', '')[:10] or None
    d = build(j.get('elements') or [], at=at, bbox=bb, kinds=tuple(a.kinds.split(',')))
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{a.out}: {d['n']}点 kinds={d['kinds']} at={d['at']} bbox={d['bbox']}")

if __name__ == '__main__': main()
