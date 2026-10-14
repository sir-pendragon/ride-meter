// 市の公式ページ(長野県: 松本市・安曇野市・伊那市 / 山梨県: 甲府市)の林道規制を共通のレコードに変換する。
// 判定の原則(他の県と同じ):
//  - 書かれていないことを「通行可能」とは判定しない。自転車の可否は、原文に記載がなければ null
//  - 区間は原文のまま残す。区間が書かれていない通行止めは、全線とは決めず scope='unknown'(位置は「不明」)
//  - 期間が明記され、終了済み・開始前のものは、いまの規制として扱わない
(function (root) {
  // cl: 表示用(原文のまま、空白だけ整える) / nf: 判定用(全角・半角をそろえる)
  const cl = (s) => String(s || '').replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  const nf = (s) => cl(String(s || '').normalize('NFKC'));
  const reiwa = (y, m, d) => Date.UTC(2018 + Number(y), Number(m) - 1, Number(d));
  const dayOf = (t) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const lastDay = (y, m) => new Date(Date.UTC(2018 + y, m, 0)).getUTCDate();

  // 日付のあいまいさ(上旬・中旬・下旬)を許して期間を読む。from/to は UTC の日付(ms)。読めなければ null
  function parsePeriod(text) {
    const t = nf(text); if (!t) return null;
    const D = '令和\\s*(\\d{1,2})年\\s*(\\d{1,2})月\\s*(?:(\\d{1,2})日|(上旬|中旬|下旬))?';
    const re = new RegExp(D + '\\s*(?:から|～|~|-)\\s*(?:(?:令和\\s*(\\d{1,2})年\\s*)?(\\d{1,2})月\\s*(?:(\\d{1,2})日|(上旬|中旬|下旬))?)?');
    const m = t.match(re); if (!m) return null;
    const y1 = +m[1], mo1 = +m[2];
    const from = m[3] ? reiwa(y1, mo1, m[3]) : m[4] ? reiwa(y1, mo1, { 上旬: 1, 中旬: 11, 下旬: 21 }[m[4]]) : reiwa(y1, mo1, 1);
    let to = null;
    if (m[6]) {
      const y2 = m[5] ? +m[5] : y1, mo2 = +m[6];
      to = m[7] ? reiwa(y2, mo2, m[7]) : m[8] ? reiwa(y2, mo2, { 上旬: 10, 中旬: 20, 下旬: lastDay(y2, mo2) }[m[8]]) : reiwa(y2, mo2, lastDay(y2, mo2));
    }
    return { from, to, text: m[0].replace(/\s*(から|～|~|-)\s*$/, '').trim() === m[0].trim() ? m[0].trim() : m[0].trim() };
  }
  // 'active' | 'ended' | 'future' | 'unspecified'
  function periodState(text, today) {
    const p = parsePeriod(text); if (!p) return { state: 'unspecified', p: null };
    const d = dayOf(today);
    if (p.to != null && p.to < d) return { state: 'ended', p };
    if (p.from > d) return { state: 'future', p };
    return { state: 'active', p };
  }

  // 表を、行・列の結合(rowspan/colspan)を展開した格子にする。own[i][j] はそのセルが行自身のものか
  function grid(table) {
    const rows = [...table.rows]; const g = []; const own = []; const th = [];
    rows.forEach((tr, r) => {
      g[r] = g[r] || []; own[r] = own[r] || []; th[r] = false;
      let c = 0;
      for (const cell of tr.cells) {
        while (g[r][c] !== undefined) c++;
        const rs = cell.rowSpan || 1, cs = cell.colSpan || 1; const txt = cl(cell.textContent);
        if (cell.tagName === 'TH') th[r] = true;
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { g[r + i] = g[r + i] || []; own[r + i] = own[r + i] || []; g[r + i][c + j] = txt; own[r + i][c + j] = i === 0 && j === 0; }
        c += cs;
      }
    });
    return { g, own, th, hasOwn: own.map((o) => o.some(Boolean)) };
  }
  const updatedOf = (doc) => { const m = nf(doc.body.textContent).match(/更新日[：:]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/); return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null; };
  const stripUrl = (s) => cl(s).replace(/https?:\/\/\S+/g, '').replace(/\[PDFファイル[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  const stem = (s) => cl(s).replace(/[【\[][^】\]]*[】\]]/g, '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '').replace(/^林道/, '');

  // 内容の文言から状態を決める。通行止めと読めないものは null(規制として扱わない)
  function statusOf(c) {
    const t = nf(c); if (!t) return null;
    if (/予告/.test(t)) return { skip: 'notice' };
    if (/一部|片側交互|平日のみ|時間指定|夜間/.test(t)) return { status: '一部規制' };
    if (/通行止|閉鎖|通行不可|通行禁止/.test(t)) return { status: '通行止め' };
    return null;
  }

  // ---------- 松本市 ----------
  function parseMatsumoto(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now()); const updated = updatedOf(doc); const out = [];
    const t = [...doc.querySelectorAll('table')].find((x) => /路線名/.test(x.textContent) && /規制内容/.test(x.textContent)); if (!t) return out;
    const { g, hasOwn, th } = grid(t); let k = 0;
    g.forEach((row, r) => {
      if (th[r] || !hasOwn[r]) return;
      const routeTxt = row[0]; const sub = row[1] && row[1] !== row[0] ? row[1] : ''; const content = row[2] || ''; const period = row[3] || ''; const remark = stripUrl(row[5] || '');
      const so = statusOf(content); if (!routeTxt || !so) return;
      if (so.skip) return;
      const ps = periodState(period, today); if (ps.state === 'ended' || ps.state === 'future') return;
      out.push({
        route: stem(routeTxt), municipality: '松本市', typeText: content, section: sub, period: period || null, reason: remark || null,
        status: so.status, scope: sub ? 'partial' : 'unknown', note: sub ? null : '区間の記載なし(路線全体かどうかは書かれていません)', bicycle: null,
        rid: 'M#' + (k++), sourceUrl: url, officialUpdated: updated, fetchedAt,
        basis: '松本市公式ページの表の記載(原文)',
      });
    });
    return out;
  }

  // ---------- 安曇野市 ----------
  function parseAzumino(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now()); const updated = updatedOf(doc); const out = [];
    const t = [...doc.querySelectorAll('table')].find((x) => /全幅員/.test(x.textContent) && /規制等/.test(x.textContent)); if (!t) return out;
    const { g, hasOwn, th } = grid(t); let k = 0;
    g.forEach((row, r) => {
      if (th[r] || !hasOwn[r]) return;
      const name = cl(row[1]).match(/^(\S+線)/); const txt = cl(row[3]); const ntx = nf(txt); if (!name || !txt) return;
      const so = statusOf(txt); if (!so || so.skip) return;
      const st = ntx.match(/令和\s*(\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日\S*から/);
      if (st && reiwa(st[1], st[2], st[3]) > dayOf(today)) return; // 開始前
      const sec = txt.match(/(入口ゲート[^、。]{0,40}?)から/);
      const note = [];
      if (/歩行者も通行出来ません|歩行者も通行できません/.test(ntx)) note.push('歩行者も通行できないと原文にある');
      if (/時間指定/.test(txt)) note.push('通行可能な時間帯が決められている(原文を確認)');
      out.push({
        route: name[1], municipality: '安曇野市', typeText: so.status === '一部規制' ? '時間指定の車両通行止め' : '車両通行止め', section: sec ? sec[1] + 'から' : '',
        period: st ? st[0].replace(/から$/, '') + 'から' : null, reason: txt.slice(0, 300), status: so.status, scope: 'unknown', note: note.join(' / ') || null, bicycle: null,
        rid: 'A#' + (k++), sourceUrl: url, officialUpdated: updated, fetchedAt,
        basis: '安曇野市公式ページの表の記載(原文)。「車両」に自転車が含まれるかは記載なし',
      });
    });
    return out;
  }

  // ---------- 甲府市(市営林道通行規制情報) ----------
  function parseKofu(doc, url, fetchedAt) {
    const updated = updatedOf(doc); const out = [];
    const t = [...doc.querySelectorAll('table')].find((x) => /路線名/.test(x.textContent) && /通行規制/.test(x.textContent)); if (!t) return out;
    let k = 0;
    for (const tr of t.rows) {
      const c = [...tr.cells].map((x) => nf(x.textContent));
      if (c.length < 5 || [...tr.cells].some((x) => x.tagName === 'TH')) continue; // 見出し・「なし」の続き行・注記行は除く
      const [route, restr, section, period, reason] = c;
      if (!route || !restr || /^なし$/.test(restr)) continue;
      if (!/通行止|閉鎖/.test(restr)) continue;
      const whole = /^全線/.test(section);
      out.push({
        route: stem(route), municipality: '甲府市', typeText: restr, section, period: /^通年$/.test(period) ? '通年' : period || null, reason: reason || null,
        status: '通行止め', scope: whole ? 'whole' : section ? 'partial' : 'unknown',
        note: /一時閉鎖/.test(restr) ? '一時閉鎖(台風など)。解除は安全確認後に随時行うとあり、すでに解除されている可能性があります。ページの更新日を確認してください' : null, bicycle: null,
        rid: 'K#' + (k++), sourceUrl: url, officialUpdated: updated, fetchedAt,
        basis: '甲府市公式ページの表の記載(原文)',
      });
    }
    return out;
  }
  // 交通ページから「市営林道通行規制情報」のページを探す(ページのURLはお知らせごとに変わるため)
  function findKofuLink(doc, baseUrl) {
    const a = [...doc.querySelectorAll('a[href]')].find((x) => /市営林道.*通行規制情報/.test(nf(x.textContent)));
    return a ? new URL(a.getAttribute('href'), baseUrl).href : null;
  }

  // ---------- 伊那市(南アルプス林道) ----------
  function parseIna(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now()); const updated = updatedOf(doc);
    const txt = nf(doc.body.textContent);
    if (!/南アルプス林道の車両通行規制/.test(txt) || !/通行許可証|通行許可/.test(txt)) return [];
    const sec = (txt.match(/区間[：:]\s*(.+?)\s*延長/) || [])[1] || '';
    const per = (txt.match(/期間[：:]\s*(令和[^ ]+?まで(?:（予定）|\(予定\))?)/) || [])[1] || '';
    const open = parsePeriod(per.replace(/（予定）|\(予定\)/g, '').replace('から令和', 'から令和'));
    const d = dayOf(today); const inOpen = open && open.to != null ? (open.from <= d && d <= open.to) : null;
    const note = ['許可を受けた車両以外は通行できません(自転車の扱いは記載なし)', '許可車両でも午後7時～翌午前5時は通行不可(原文)'];
    if (inOpen === false) note.unshift('いまは通行可能期間の外で、冬季閉鎖です');
    if (inOpen === null) note.unshift('通行可能期間を読み取れませんでした');
    return [{
      route: '南アルプス林道', municipality: '伊那市', typeText: '通行許可制(許可車両以外は通行不可)', section: sec ? sec.replace(/（/g, '(').replace(/）/g, ')') : '',
      period: per ? '通行可能期間 ' + per : null, reason: '林道の構造の保全・交通の危険の防止・自然の保護のため', status: '通行止め', scope: 'whole', note: note.join(' / '), bicycle: null,
      rid: 'I#0', sourceUrl: url, officialUpdated: updated, fetchedAt,
      basis: '伊那市公式ページの文章(原文)。区間は戸台大橋～北沢峠で、全線が対象と読める記載',
    }];
  }

  const api = { parsePeriod, periodState, grid, parseMatsumoto, parseAzumino, parseKofu, findKofuLink, parseIna };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureCity = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
