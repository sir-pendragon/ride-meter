#!/usr/bin/env python3
"""市町村の通行規制ページ台帳 (data/muni-inventory/*.json) を更新する。

LLM もトークンも GitHub Actions も使わない。標準ライブラリだけ。手元のPCで実行する想定。

  python tools/muni_inventory.py domains            # Wikidata から各市町村の公式サイトのトップを集め tools/domains.json に保存
  python tools/muni_inventory.py scan [--pref 神奈川県] [--only 秦野市,山北町] [--all]
                                                    # トップページ→「通行止め/林道…」のリンク→その先、と最大2階層たどり、台帳を更新
  python tools/muni_inventory.py report             # 台帳の件数を表示

判定は機械的(キーワードと表・日付の有無)。判定の根拠は台帳の notes に残す。人の目で見直す前提で、
  found      : 通行止め/規制の語と、表または日付つきの項目がある
  index_only : 規制の語はあるが、一覧(表・日付つき項目)がない
  unverified : 開けなかった / 判定できなかった (「無い」という意味ではない)
既存の found/found_empty/index_only は、--all を付けない限り上書きしない。
取得できなかっただけでは状態を下げない。1サイトあたり最大8リクエスト、1秒以上の間隔を空ける。
"""
import argparse, glob, json, os, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(ROOT, 'data', 'muni-inventory')
DOM = os.path.join(ROOT, 'tools', 'domains.json')
UA = 'ride-meter-inventory/1 (personal cycling app; contact: repo owner)'
KEYS = [('林道', 5), ('通行止', 5), ('通行規制', 5), ('交通規制', 4), ('道路規制', 4), ('規制情報', 3), ('道路情報', 3), ('災害情報', 2), ('道路', 1)]
WORDS = re.compile(r'通行止|通行規制|交通規制|道路規制|林道')
DATE = re.compile(r'(令和\s*\d+\s*年\s*\d+\s*月\s*\d+\s*日|20\d\d[/.\-年]\s*\d{1,2}[/.\-月]\s*\d{1,2})')
KEEP = {'found', 'found_empty', 'index_only'}
FILES = {'茨城県': 'ibaraki', '栃木県': 'tochigi', '群馬県': 'gunma', '埼玉県': 'saitama', '千葉県': 'chiba', '東京都': 'tokyo', '神奈川県': 'kanagawa'}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = []; self.title = ''; self.tables = 0; self.text = []; self._a = None; self._t = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'a' and a.get('href'): self._a = [a['href'], '']
        elif tag == 'table': self.tables += 1
        elif tag == 'title': self._t = True
    def handle_endtag(self, tag):
        if tag == 'a' and self._a: self.links.append(tuple(self._a)); self._a = None
        elif tag == 'title': self._t = False
    def handle_data(self, d):
        if self._a is not None: self._a[1] += d
        if self._t: self.title += d
        self.text.append(d)


def decode(raw, ctype):
    cands = []
    m = re.search(r'charset=([\w\-]+)', ctype or '', re.I)
    if m: cands.append(m.group(1))
    m = re.search(rb'<meta[^>]+charset=["\']?([\w\-]+)', raw[:4096], re.I)
    if m: cands.append(m.group(1).decode('ascii', 'ignore'))
    cands += ['utf-8', 'cp932']
    for c in cands:
        try: return raw.decode(c)
        except Exception: pass
    return raw.decode('utf-8', 'replace')


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ct = r.headers.get('Content-Type', '')
        if 'html' not in ct.lower() and 'xml' not in ct.lower(): raise ValueError('HTMLではない: ' + ct)
        return r.geturl(), decode(r.read(2_000_000), ct)


def parse(html):
    p = Page(); p.feed(html); return p


def same_site(a, b):
    ha, hb = urllib.parse.urlparse(a).hostname or '', urllib.parse.urlparse(b).hostname or ''
    return ha == hb or ha.split('.', 1)[-1] == hb.split('.', 1)[-1]


def score(text):
    t = re.sub(r'\s+', '', text)
    return sum(w for k, w in KEYS if k in t)


def candidates(base, page, seen, n=3):
    out = []
    for href, text in page.links:
        u = urllib.parse.urljoin(base, href).split('#')[0]
        if not u.startswith('http') or u in seen or not same_site(base, u) or re.search(r'\.(pdf|jpe?g|png|zip|xlsx?|docx?)$', u, re.I): continue
        s = score(text)
        if s >= 4: out.append((s, u, re.sub(r'\s+', '', text)))
    out.sort(key=lambda x: -x[0]); return out[:n]


def judge(url, html):
    p = parse(html); body = re.sub(r'\s+', ' ', ' '.join(p.text))
    hit = bool(WORDS.search(body)); dated = DATE.findall(body)
    forest = '林道' in body
    kind = 'html_table' if p.tables else ('html_list' if dated else 'other')
    if hit and (p.tables or len(dated) >= 2): st = 'found'
    elif hit: st = 'index_only'
    else: st = None
    return st, {'page_title': re.sub(r'\s+', ' ', p.title).strip(), 'kind': kind, 'covers_forest_road': True if forest else 'unknown', 'updated_hint': dated[0] if dated else None}


def scan_one(top, sleep=1.0, budget=8):
    """トップ→候補→その先。見つかった最良のページ(found > index_only)を返す。戻り値: (status, url, info, note)"""
    seen = {top}; best = None; used = 0; note = []
    try:
        base, html = fetch(top); used += 1
    except Exception as e:
        return None, None, None, f'トップを開けなかった: {e}'
    queue = [(base, html)]; depth = 0
    while queue and used < budget and depth < 2:
        nxt = []
        for b, h in queue:
            for s, u, tx in candidates(b, parse(h), seen):
                if used >= budget: break
                seen.add(u); time.sleep(sleep)
                try: b2, h2 = fetch(u); used += 1
                except Exception as e: note.append(f'開けない: {u} ({e})'); used += 1; continue
                st, info = judge(b2, h2)
                if st and (best is None or (st == 'found' and best[0] != 'found')): best = (st, b2, info, f'リンク文字「{tx}」から到達')
                nxt.append((b2, h2))
        queue = nxt; depth += 1
    if best: return best
    return None, None, None, '; '.join(note) or '規制らしいリンクが見つからなかった'


def load_inv():
    inv = {}
    for pref, f in FILES.items():
        inv[pref] = json.load(open(os.path.join(INV, f + '.json'), encoding='utf-8'))
    return inv


def save_inv(pref, rows):
    with open(os.path.join(INV, FILES[pref] + '.json'), 'w', encoding='utf-8') as fp: json.dump(rows, fp, ensure_ascii=False, indent=1)


def cmd_domains(a):
    q = 'SELECT ?c ?w ?l WHERE { ?i wdt:P429 ?c; wdt:P856 ?w; rdfs:label ?l FILTER(LANG(?l)="ja") FILTER(STRSTARTS(?c,"08")||STRSTARTS(?c,"09")||STRSTARTS(?c,"10")||STRSTARTS(?c,"11")||STRSTARTS(?c,"12")||STRSTARTS(?c,"13")||STRSTARTS(?c,"14")) }'
    u = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q)
    r = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=90)
    rows = json.load(r)['results']['bindings']
    out = {}
    for x in rows: out.setdefault(x['l']['value'], x['w']['value'])
    json.dump(out, open(DOM, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{len(out)} 件を {DOM} に保存。名前の照合は scan 時に行う(同名は市町村名が一意な県内のみ)')


def cmd_scan(a):
    doms = json.load(open(DOM, encoding='utf-8')) if os.path.exists(DOM) else {}
    only = set(a.only.split(',')) if a.only else None
    inv = load_inv(); changed = 0
    for pref, rows in inv.items():
        if a.pref and pref != a.pref: continue
        for x in rows:
            if only and x['name'] not in only: continue
            if x['status'] in KEEP and not a.all: continue
            top = (x.get('top') or doms.get(x['name']))
            if not top: print(f"- {pref} {x['name']}: トップのURLが不明(tools/domains.json に追加するか、台帳に top を書く)"); continue
            print(f"* {pref} {x['name']} ← {top}", flush=True)
            st, url, info, note = scan_one(top, a.sleep)
            if st:
                x.update({'status': st, 'url': url, **info, 'notes': f'[自動] {note}。機械判定のため要目視。'}); changed += 1
                print(f'    -> {st} {url}')
            else:
                x['top'] = top
                if x['status'] not in KEEP: x['status'] = 'unverified'
                x['notes'] = f"[自動] {note}"; print(f'    -> 未確認 ({note})')
            time.sleep(a.sleep)
        save_inv(pref, rows)
    print(f'更新 {changed} 件')


def cmd_report(a):
    from collections import Counter
    t = Counter()
    for pref, rows in load_inv().items():
        c = Counter(x['status'] for x in rows); t += c; print(pref, len(rows), dict(c))
    print('合計', sum(t.values()), dict(t))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('domains').set_defaults(f=cmd_domains)
    s = sp.add_parser('scan'); s.add_argument('--pref'); s.add_argument('--only'); s.add_argument('--all', action='store_true'); s.add_argument('--sleep', type=float, default=1.0); s.set_defaults(f=cmd_scan)
    sp.add_parser('report').set_defaults(f=cmd_report)
    a = ap.parse_args(); a.f(a)
