// 山梨県「県営林道通行規制情報」(一覧 list.php と、路線ごとの詳細 kisei.php)を共通の規制レコードに変換する。
// 判定の原則(他の県と同じ):
//  - 書かれていないことを「通行可能」とは判定しない。自転車は、原文に自転車・軽車両の記載があるときだけ false、通常は null
//  - 区間は、「全線」または「A～Bの間」と明記されているときだけ取り出す。それ以外は空にして位置は「不明」とする
//  - 期間が明記され、すでに終わっている/まだ始まっていない規制は、いま有効な規制として扱わない
(function (root) {
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const KANA = /[【\[][^】\]]*[】\]]/g;

  // 路線名: 「県営林道井川雨畑【ｲｶﾜｱﾒﾊﾀ】線」→「井川雨畑線」。「杣口(ｿﾏｸﾞﾁ)線→県道…」は矢印の前だけ使う
  function routeName(s) {
    let t = clean(s).replace(/^(県営|市営|町営|村営)?林道/, '').split('→')[0];
    t = t.replace(KANA, '').replace(/[(（][ｦ-ﾟ・ー ]+[)）]/g, '');
    return t.trim();
  }

  // 一覧: 林道名のリンクと管理区分、規制のしるし(td.kisei=規制中, td.yotei=規制予定)
  function parseList(doc, baseUrl) {
    const out = [];
    for (const tr of doc.querySelectorAll('table.rindoTb2 tr')) {
      const a = tr.querySelector('a[href]'); if (!a) continue;
      const cells = [...tr.cells];
      out.push({
        name: clean(a.textContent), url: new URL(a.getAttribute('href'), baseUrl).href, mgmt: clean(cells[1] && cells[1].textContent),
        kisei: !!tr.querySelector('td.kisei'), yotei: !!tr.querySelector('td.yotei'),
      });
    }
    return out;
  }

  // 令和・Rの日付を (年,月,日) に
  function reiwa(y, m, d) { return new Date(Date.UTC(2018 + Number(y), Number(m) - 1, Number(d))); }
  // 本文中の期間「令和8年8月31日から令和8年10月20日まで」「R8.9.24(木)～R8.10.16(金)」を取り出す
  function ranges(text) {
    const t = clean(text).replace(/[（(][^）)]{1,4}[）)]/g, ''); // 曜日の括弧を除く
    const S = '(?:令和\\s*(\\d{1,2})年\\s*(\\d{1,2})月\\s*(\\d{1,2})日|R\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{1,2}))';
    const E = '(?:(?:令和\\s*(\\d{1,2})年\\s*)?(\\d{1,2})月\\s*(\\d{1,2})日|R\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{1,2}))';
    const re = new RegExp(S + '\\s*(?:から|～|~|〜|-)\\s*' + E, 'g');
    const out = [];
    for (const m of t.matchAll(re)) {
      const a = m[1] ? reiwa(m[1], m[2], m[3]) : reiwa(m[4], m[5], m[6]);
      const y0 = m[1] || m[4];
      const b = m[8] ? reiwa(m[7] || y0, m[8], m[9]) : reiwa(m[10], m[11], m[12]);
      out.push({ from: a, to: b, text: m[0] });
    }
    return out;
  }
  // 期間から「いま有効か」を判定。期間の記載がなければ 'unspecified'
  function activeState(text, today) {
    const rs = ranges(text); if (!rs.length) return { state: 'unspecified', ranges: rs };
    const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (rs.some((r) => r.from.getTime() <= day && day <= r.to.getTime())) return { state: 'active', ranges: rs };
    if (rs.every((r) => r.to.getTime() < day)) return { state: 'ended', ranges: rs };
    return { state: 'future', ranges: rs };
  }

  const CLOSE = /通行止|通行を禁止|通行禁止|通行(が|は)?(できません|出来ません)|乗り入れは(できません|出来ません)|通行を規制|通行を制限|閉鎖|立ち?入/;
  const NOTICE_ONLY = /(注意してください|注意をしてください|ご注意ください)/;

  // 1つの規制欄(td.kisei)の文章を解釈する
  function interpret(text, kind, today) {
    const t = clean(text);
    if (/(詳細は|お問い合わせ)/.test(t) && !/通行止|禁止|閉鎖/.test(t.replace(/お問い合わせ[^。]*/g, ''))) return { status: '不明', scope: 'unknown', note: '市町村等への問い合わせ先のみ記載(規制の内容は書かれていません)' };
    if (/冬期閉[鎖開]/.test(t) && /開始予定|予定/.test(t) && !/全車両の通行ができません/.test(t)) return { status: '不明', scope: 'unknown', note: '冬期閉鎖の予告(いまの規制ではありません)' };
    const act = activeState(t, today);
    if (act.state === 'ended') return { status: '不明', scope: 'unknown', skip: 'ended', note: '記載された期間は終了しています(' + act.ranges.map((r) => r.text).join(' / ') + ')' };
    if (act.state === 'future') return { status: '不明', scope: 'unknown', skip: 'future', note: '記載された期間はまだ始まっていません(' + act.ranges.map((r) => r.text).join(' / ') + ')' };
    if (!CLOSE.test(t)) return { status: '不明', scope: 'unknown', note: NOTICE_ONLY.test(t) ? '注意喚起のみ(通行止めの記載なし)' : '通行止めの記載を確認できません' };
    const bike = /(自転車|軽車両)/.test(t) && /(できません|禁止|含)/.test(t) ? false : null;
    // 一部の時間帯・平日のみ・大型車のみ等は「一部規制」
    const timed = /平日のみ|土曜日、日曜日、祝日[^。]*通行可能|午[前後]\d+時|時間帯|時間:|夜間|歩行者通行可能/.test(t);
    const heavy = /(準中型|中型|大型)[^。]*(制限|通行止|禁止)/.test(t) && !/全車両|一般車|全線/.test(t);
    const whole = /<\s*全\s*線\s*>|全線(通行|閉鎖|立入|を)/.test(t);
    const m = t.match(/([^\s。、:：()（）]{2,20})[～〜]([^\s。、:：()（）]{2,20}(?:\([^)]{1,6}\))?)の間/);
    const section = m ? `${m[1]}～${m[2]}の間` : '';
    let status = '通行止め', scope = whole ? 'whole' : section ? 'partial' : 'unknown';
    if (timed || heavy || /一部区間/.test(t)) { status = '一部規制'; scope = 'partial'; }
    const note = [];
    if (heavy) note.push('大型車等のみの制限(自転車の扱いは記載なし)');
    if (timed) note.push('時間帯・曜日・歩行者可などの条件付き');
    if (bike === false) note.push('原文に自転車・軽車両の通行不可の記載あり');
    return { status, scope, section, bicycle: bike, note: note.join(' / ') || null, period: act.ranges.length ? act.ranges.map((r) => r.text).join(' / ') : null, activeNow: act.state === 'active' };
  }

  // 詳細ページ → レコード(規制欄ごとに1件)。県営以外(市町村営)はここでは扱わない
  function parseDetail(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now());
    const h1 = clean((doc.querySelector('h1') || {}).textContent);
    const route = routeName(h1);
    const info = doc.querySelector('table.rindoTb');
    const ths = info ? [...info.querySelectorAll('th')] : [];
    const val = (label) => { const th = ths.find((x) => clean(x.textContent) === label); return th && th.nextElementSibling ? clean(th.nextElementSibling.textContent) : ''; };
    const from = val('起点'), to = val('終点');
    const municipality = [from, to].filter(Boolean).join(' → ') || null;
    const id = (url.match(/id=(\d+)/) || [])[1] || url;
    const out = []; let k = 0;
    for (const tbl of doc.querySelectorAll('table.rindoTb')) {
      const heads = [...tbl.querySelectorAll('th')].map((x) => clean(x.textContent));
      if (!heads.includes('冬期閉鎖') && !heads.includes('その他')) continue;
      const kinds = heads.filter((x) => ['冬期閉鎖', '気象状況', '工事', 'その他'].includes(x));
      for (const tr of tbl.rows) {
        [...tr.cells].filter((c) => c.tagName === 'TD').forEach((td, ci) => {
          if (!td.classList.contains('kisei')) return;
          const text = clean(td.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''));
          if (!text) return;
          const kind = kinds[ci] || '';
          const it = interpret(text, kind, today);
          out.push({
            route, municipality, typeText: kind ? kind + 'による規制' : '', section: it.section || '', period: it.period || null, reason: text,
            status: it.status, scope: it.scope, note: it.note || null, bicycle: it.bicycle === false ? false : null,
            skip: it.skip || null, rid: id + '#' + (k++), sourceUrl: url, officialUpdated: null, fetchedAt,
            basis: '県公式ページの記載(原文の文章を解釈。区間が明記されていない場合は位置を示しません)',
          });
        });
      }
    }
    return out;
  }

  const api = { parseList, parseDetail, interpret, ranges, activeState, routeName };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureYamanashi = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
