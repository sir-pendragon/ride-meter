// Geminiによる二重チェック。
// 原則: AIの出力は「参考」。通行止めの判定・「避ける」の確定・位置の決定には使わない。
//  - AIが返した各項目は、原文の引用(quote)が実際に本文に含まれているものだけ採用する(作り話の除去)
//  - 私たちの解析結果とAIの結果を、路線名で突き合わせて「一致 / 相違 / AIのみ検出」を付けるだけ
(function (root) {
  const squash = (s) => String(s || '').replace(/[\s　]+/g, '');
  const routeKey = (s) => squash(s).replace(/^(県営|市営|町営|村営)?林道/, '').replace(/[【\[][^】\]]*[】\]]/g, '').replace(/[(（][ｦ-ﾟ・ー]+[)）]/g, '').split('→')[0];
  const RANK = { '通行止め': 3, '一部規制': 2, '不明': 1, '規制なし': 0 };
  const regulated = (s) => s === '通行止め' || s === '一部規制';

  // 本文に引用が実在する項目だけ残す
  function verifyItems(items, text) {
    const t = squash(text); const kept = []; let rejected = 0;
    for (const x of items || []) {
      const q = squash(x && x.quote);
      if (q.length >= 4 && t.includes(q) && x.route) kept.push(x); else rejected++;
    }
    return { kept, rejected };
  }

  // records: 私たちの解析結果, items: 検証済みのAI項目
  function compare(records, items) {
    const same = (a, b) => { const x = routeKey(a), y = routeKey(b); return x.length >= 2 && y.length >= 2 && (x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)))); };
    const byRoute = new Map();
    for (const r of records) { const k = routeKey(r.route); if (!byRoute.has(k)) byRoute.set(k, []); byRoute.get(k).push(r); }
    const used = new Set(); const aiOnly = []; const marks = new Map();
    const strongest = (arr, f) => arr.reduce((m, x) => (RANK[f(x)] > RANK[m] ? f(x) : m), '規制なし');
    for (const [k, recs] of byRoute) {
      const its = items.filter((x) => same(x.route, recs[0].route));
      its.forEach((x) => used.add(x));
      const ours = strongest(recs, (r) => r.status);
      if (!its.length) { marks.set(k, { state: 'AI未検出', aiStatus: null, quote: '' }); continue; }
      const ai = strongest(its, (x) => x.status); const top = its.find((x) => x.status === ai) || its[0];
      let state;
      if (regulated(ours) && regulated(ai)) state = ours === ai ? '一致' : '相違';
      else if (regulated(ours) && ai === '規制なし') state = '相違';
      else if (regulated(ours) && ai === '不明') state = 'AIは判断不能';
      else if (!regulated(ours) && regulated(ai)) state = 'AIのみ検出';
      else state = '一致';
      marks.set(k, { state, aiStatus: ai, aiSection: top.section || '', quote: top.quote || '', aiNote: top.note || '' });
    }
    for (const x of items) if (!used.has(x) && regulated(x.status)) aiOnly.push(x);
    const out = records.map((r) => ({ ...r, ai: marks.get(routeKey(r.route)) || null }));
    return { records: out, aiOnly };
  }

  const api = { verifyItems, compare, routeKey };
  if (typeof module !== 'undefined') module.exports = api; else root.AiCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
