// 東京都「森林事務所管理林道の通行状況一覧」PDF(文字として読み取れる形式)を、共通の規制レコードに変換する。
// 入力: pdf.js の getTextContent() から作った items の配列(ページごと)。 item = {s, x, y, h}
//   s: 文字列, x/y: 位置(PDF座標、yは上ほど大きい), h: 文字の高さ(ふりがなは小さい)
// 区間・期間は原文の記載がある場合だけ残す(無い項目は null)。自転車の通行可否は記載がないため null。
(function (root) {
  const squash = (s) => (s || '').replace(/\s+/g, '');
  const MUNI = /(町|市|村)$/;
  const HEADERS = /^(担当出張所|市町村名|路線名|通行規制状況)$/;

  function parseTokyoPages(pages, sourceUrl, fetchedAt) {
    const out = [];
    let updated = null;
    for (const page of pages) {
      const items = page.filter((t) => t.h > 8); // ふりがな(小さい文字)を除く
      for (const t of items) {
        const m = squash(t.s).match(/(\d+)月(\d+)日更新/);
        if (m) updated = { month: +m[1], day: +m[2] };
      }
      const body = items.filter((t) => !HEADERS.test(squash(t.s)) && !/更新$/.test(squash(t.s)) && !/^[０-９0-9－\-]+$/.test(squash(t.s)));
      const anchors = body
        .filter((t) => t.x >= 130 && t.x < 200 && MUNI.test(squash(t.s)))
        .sort((a, b) => b.y - a.y);
      anchors.forEach((a, i) => {
        const upper = i === 0 ? Infinity : (anchors[i - 1].y + a.y) / 2;
        const lower = i === anchors.length - 1 ? -Infinity : (a.y + anchors[i + 1].y) / 2;
        const inRow = body.filter((t) => t.y < upper && t.y >= lower);
        const name = inRow
          .filter((t) => t.x >= 200 && t.x < 300)
          .sort((p, q) => q.y - p.y || p.x - q.x);
        // 同じ行(y近接)ごとにまとめる。「鋸山（大沢入）」のように複数の断片に分かれる場合に対応
        const route = squash(name.map((t) => t.s).join(''));
        const st = inRow.filter((t) => t.x >= 300).sort((p, q) => q.y - p.y || p.x - q.x);
        const lines = [];
        for (const t of st) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.y - t.y) <= 3) last.s += t.s; else lines.push({ y: t.y, s: t.s });
        }
        // 括弧が閉じていない行は、次の行に続くものとして結合(例: 「…手前の海沢線に柵」+「有）」)
        const L = [];
        for (const l of lines) {
          const t = squash(l.s);
          const prev = L[L.length - 1];
          if (prev !== undefined && (prev.match(/[（(]/g) || []).length > (prev.match(/[）)]/g) || []).length) L[L.length - 1] = prev + t;
          else L.push(t);
        }
        const muni = squash(inRow.filter((t) => t.x >= 130 && t.x < 200).sort((p, q) => q.y - p.y || p.x - q.x).map((t) => t.s).join(''));
        if (!route || !L.length) return;
        const first = L[0];
        const rest = L.slice(1);
        // 「特になし」は規制の記載がないだけで、通行可能の確認とは扱わない
        const status = /通行止/.test(first) ? '通行止め' : /通行規制/.test(first) ? '通行規制' : /特になし/.test(first) ? '規制の記載なし' : '不明';
        const periodM = rest.join(' ').match(/[（(]([^）)]*まで)[）)]/);
        out.push({
          route,
          municipality: muni,
          statusText: first,
          status, // 「通行規制」は東京都の定義では「通行は可能だが林業関係者以外の車両の乗り入れを規制」
          reasonOrSection: rest.filter((r) => !/まで[）)]$/.test(r)).join(' ') || null,
          period: periodM ? periodM[1] : null,
          bicycle: null,
          sourceUrl,
          officialUpdated: updated, // 「10月2日更新」(年は記載なし)
          fetchedAt,
          basis: '東京都PDFの表の記載(原文)',
        });
      });
    }
    return out;
  }
  const api = { parseTokyoPages };
  if (typeof module !== 'undefined') module.exports = api; else root.TokyoPdfParse = api;
})(typeof self !== 'undefined' ? self : this);
