// 県の「通行制限情報」ページの表(HTML)を、共通の形式に変換する(アプリ側で実行)。
// 入力: DOMParser で作った document、ページのURL、取得時刻
// 出力: 規制レコードの配列(位置は含まない。位置は別の工程で「推定」として付ける)
//
// 判定の原則:
//  - 書かれていないことを「通行可能」とは判定しない(bicycle は確認できた場合のみ true/false、通常は null)
//  - 区間は原文をそのまま残す(解釈しない)
(function (root) {
  const HEAD = {
    route: /路線名/,
    muni: /市町村/,
    type: /制限.*種類|規制.*種類/,
    section: /区間|位置/,
    period: /期間/,
    reason: /事由|理由/,
  };
  const clean = (s) =>
    (s || '')
      .replace(/Open this document with ReadSpeaker docReader/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  function classify(type, section) {
    // 「種類」欄の記載を優先する(区間欄に「全線」とあっても、種類が「一部区間」なら一部)
    const ty = clean(type);
    if (/一部区間|一部制限/.test(ty) && !/大型/.test(ty)) return { status: '一部規制', scope: 'partial' };
    const t = ty + ' ' + clean(section);
    if (/大型/.test(t) && !/全面|全線通行止/.test(t)) return { status: '一部規制', scope: 'partial', note: '大型車のみ等(自転車の扱いは記載なし)' };
    if (/全面通行止|全線.*通行止|通行止.*全線/.test(t)) return { status: '通行止め', scope: 'whole' };
    if (/車両通行止/.test(t)) return { status: '通行止め', scope: /全線/.test(t) ? 'whole' : 'unknown', note: '「車両」に自転車が含まれるかは記載なし' };
    if (/一部区間|一部制限|一部/.test(t)) return { status: '一部規制', scope: 'partial' };
    if (/全線/.test(clean(section)) && /通行止/.test(t)) return { status: '通行止め', scope: 'whole' };
    if (/通行止/.test(t)) return { status: '通行止め', scope: 'unknown' };
    return { status: '不明', scope: 'unknown' };
  }

  function parseClosureTables(doc, sourceUrl, fetchedAt) {
    const out = [];
    const m = (doc.body.textContent || '').match(/掲載日[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const updated = m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null;
    for (const table of doc.querySelectorAll('table')) {
      const rows = [...table.rows];
      if (rows.length < 2) continue;
      const heads = [...rows[0].cells].map((c) => clean(c.textContent));
      const col = {};
      for (const k in HEAD) { const i = heads.findIndex((h) => HEAD[k].test(h)); if (i >= 0) col[k] = i; }
      if (col.route == null || (col.section == null && col.type == null)) continue;
      for (const tr of rows.slice(1)) {
        const cells = [...tr.cells];
        const g = (k) => (col[k] == null || !cells[col[k]] ? '' : clean(cells[col[k]].textContent));
        const route = g('route');
        if (!route) continue;
        const a = cells[col.route] && cells[col.route].querySelector('a[href]');
        const c = classify(g('type'), g('section'));
        out.push({
          route,
          municipality: g('muni') || null,
          typeText: g('type'),
          section: g('section'),
          period: g('period') || null,
          reason: g('reason') || null,
          status: c.status,
          scope: c.scope,
          note: c.note || null,
          bicycle: null,
          detailPdf: a ? new URL(a.getAttribute('href'), sourceUrl).href : null,
          sourceUrl,
          officialUpdated: updated,
          fetchedAt,
          basis: '県公式ページの表の記載(原文)',
        });
      }
    }
    return out;
  }
  const api = { parseClosureTables, classify };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureParse = api;
})(typeof self !== 'undefined' ? self : this);
