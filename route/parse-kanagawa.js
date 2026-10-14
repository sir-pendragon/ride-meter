// 神奈川県「県営林道(自然環境保全センター管轄)の通行情報」を共通の規制レコードに変換する。
// 2種類の情報を読む:
//  1) 「通行止め情報」(文章): ［路線名林道］/ 通行止め区間 / 通行止め期間。期間が終了・未開始のものは現在の規制にしない
//  2) 「管轄林道の通行制限情報」(表): ゲート規制が「有」の林道。ページの注記「次表の林道は、承認を受けた車両以外は通行できません」に基づく
// 原則: 書かれていないことは決めない。自転車の可否は null(「車両」に自転車が含まれるかは記載なし)。
//       ゲート位置が起点でない(区間が「一部」)ものは、通行止めの区間を決めず位置は不明のままにする。
(function (root) {
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const reiwa = (y, m, d) => Date.UTC(2018 + Number(y), Number(m) - 1, Number(d));
  function range(text) {
    const m = clean(text).match(/令和\s*(\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日\s*[～〜~-]\s*(?:令和\s*(\d{1,2})年\s*)?(\d{1,2})月\s*(\d{1,2})日/);
    if (!m) return null;
    return { from: reiwa(m[1], m[2], m[3]), to: reiwa(m[4] || m[1], m[5], m[6]), text: m[0] };
  }
  const stemOf = (s) => clean(s).replace(/林道$/, '');

  function parseKanagawa(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now());
    const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const body = doc.body.textContent || '';
    const um = body.match(/更新日[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const updated = um ? `${um[1]}-${String(um[2]).padStart(2, '0')}-${String(um[3]).padStart(2, '0')}` : null;
    const out = []; const muniOf = {};
    // 表
    const gate = [];
    for (const t of doc.querySelectorAll('table')) {
      const heads = [...t.querySelectorAll('th')].map((x) => clean(x.textContent));
      if (!heads.includes('ゲート規制')) continue;
      for (const tr of t.rows) {
        const td = [...tr.cells].filter((c) => c.tagName === 'TD').map((c) => clean(c.textContent));
        if (td.length < 7) continue;
        gate.push({ name: td[0], muni: td[1], gate: td[2], period: td[3], section: td[4], pos: td[5], police: td[6] });
      }
    }
    if (!gate.length) return [];
    gate.forEach((g) => { muniOf[stemOf(g.name)] = g.muni; });
    // 文章の通行止め情報
    const h3 = [...doc.querySelectorAll('h3')].find((h) => /通行止め情報/.test(h.textContent));
    if (h3) {
      const lines = []; let n = h3.nextElementSibling;
      while (n && !/^H[123]$/.test(n.tagName)) { lines.push(clean(n.textContent)); n = n.nextElementSibling; }
      let cur = null; const blocks = [];
      for (const l of lines) {
        const m = l.match(/^[［\[](.+?)[］\]]$/);
        if (m) { cur = { name: m[1], reason: '', section: '', period: '' }; blocks.push(cur); continue; }
        if (!cur) continue;
        let x;
        if ((x = l.match(/通行止め区間[：:]\s*(.+)/))) cur.section = x[1];
        else if ((x = l.match(/通行止め期間[：:]\s*(.+)/))) cur.period = x[1];
        else if (/^・/.test(l)) cur.reason = l.replace(/^・\s*/, '');
      }
      blocks.forEach((b, i) => {
        const rg = range(b.period);
        if (rg && rg.to < day) return;   // 終了済み
        if (rg && rg.from > day) return; // まだ始まっていない
        const stem = stemOf(b.name);
        out.push({
          route: stem, municipality: muniOf[stem] || null, typeText: /車両通行止/.test(b.reason) ? '車両通行止め' : '通行止め',
          section: b.section, period: b.period || null, reason: b.reason || null,
          status: '通行止め', scope: /^全線/.test(b.section) ? 'whole' : 'unknown',
          note: /車両通行止/.test(b.reason) ? '「車両」に自転車が含まれるかは記載なし' : null, bicycle: null,
          rid: 'K-closed#' + i, sourceUrl: url, officialUpdated: updated, fetchedAt,
          basis: '県公式ページの記載(通行止め情報)' + (rg ? '。期間は記載どおり現在も有効' : '。期間の記載なし'),
        });
      });
    }
    // ゲート規制の表
    gate.forEach((g, i) => {
      if (g.gate !== '有') return;
      const whole = /^全線/.test(g.section);
      const note = [`ゲート位置: ${g.pos}`, '承認を受けた車両以外は通行できません(自転車の扱いは記載なし)'];
      if (g.police && g.police !== '無') note.push(`公安委員会規制: ${g.police}(警察の許可が別途必要)`);
      if (!whole) note.push('区間は「' + g.section + '」。ゲートより先の扱いは記載がないため位置は示しません');
      out.push({
        route: stemOf(g.name), municipality: g.muni, typeText: 'ゲート規制(承認車両のみ通行可)',
        section: whole ? '全線' : '', period: g.period || null, reason: '承認を受けた車両以外は通行できません(県有林整備課へお問合せ)',
        status: '通行止め', scope: whole ? 'whole' : 'unknown', note: note.join(' / '), bicycle: null,
        rid: 'K-gate#' + i, sourceUrl: url, officialUpdated: updated, fetchedAt,
        basis: '県公式ページの表(ゲート規制「有」)と、ページの注記に基づく',
      });
    });
    return out;
  }
  const api = { parseKanagawa, range };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureKanagawa = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
