#!/usr/bin/env python3
"""各ページのインラインCSSを調べ、(1)同じ宣言を持つルール (2)ページ内のどこにも出てこないクラス・IDを使うルール を表示する。
ファイルは書き換えない。動的に作るクラス名(文字列の連結など)は検出できないので、削除は人が確認してから行う。

  python tools/css_audit.py [route/index.html meter/index.html ...]
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['route/index.html', 'route/sources.html', 'meter/index.html', 'note/index.html']
JS = {'route/index.html': ['route/closures.js', 'route/locate.js', 'route/gm-shim.js', 'route/muni-registry.js', 'route/store.js', 'route/aicheck.js', 'route/fetchcore.js'],
      'route/sources.html': ['route/muni-registry.js']}


def rules(css):
    """入れ子(@media)を含めて (セレクタ, 本文) を取り出す。@keyframes などの本文は無視する。"""
    out = []; i = 0; n = len(css)
    def block(i):
        depth = 0; j = i
        while j < n:
            if css[j] == '{': depth += 1
            elif css[j] == '}':
                depth -= 1
                if depth == 0: return j
            j += 1
        return n
    while i < n:
        k = css.find('{', i)
        if k < 0: break
        head = css[i:k].strip(); e = block(k)
        if head.startswith('@media') or head.startswith('@supports'):
            out += rules(css[k + 1:e])
        elif not head.startswith('@'):
            out.append((head, css[k + 1:e].strip()))
        i = e + 1
    return out


def tokens(sel):
    return set(re.findall(r'\.([A-Za-z_][\w-]*)', sel)), set(re.findall(r'#([A-Za-z_][\w-]*)', sel))


def audit(path):
    full = os.path.join(ROOT, path); src = open(full, encoding='utf-8').read()
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S))
    rest = re.sub(r'<style[^>]*>.*?</style>', '', src, flags=re.S)
    for j in JS.get(path, []):
        p = os.path.join(ROOT, j)
        if os.path.exists(p): rest += '\n' + open(p, encoding='utf-8').read()
    rs = rules(css); seen = {}
    print(f'== {path}: CSS {len(css)} バイト / ルール {len(rs)}')
    for sel, body in rs: seen.setdefault(re.sub(r'\s+', '', body), []).append(sel)
    for body, sels in seen.items():
        if len(sels) > 1 and body: print('  同じ宣言:', ' , '.join(sels), '→', body[:70])
    for sel, body in rs:
        for part in sel.split(','):
            cls, ids = tokens(part)
            miss = [('.' + c) for c in cls if not re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', rest)] + [('#' + c) for c in ids if c not in rest]
            if miss: print('  未使用の疑い:', part.strip(), '(', ', '.join(miss), ')')


if __name__ == '__main__':
    for p in (sys.argv[1:] or PAGES): audit(p)
