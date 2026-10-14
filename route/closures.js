// 通行規制の自動取得(ルート計算のときだけ実行)
// 流れ: 中継から県の公式ページを取得 → 表/PDFを解析 → OSMの同名の道に「推定」で結び付け → 地図で確認して「避ける」を確定
// 原則: 情報がない・位置が特定できないものは地図に出さず、通行可能とも判定しない。名前だけで位置を確定扱いしない。
(function (root) {
  const LS_RELAY = 'rt-relay', LS_CONF = 'rt-confirmed';
  const SOURCES = {
    11: [
      { id: 'sai-chichibu', name: '埼玉県 秩父農林振興センター', url: 'https://www.pref.saitama.lg.jp/b0904/tukoseigen/index.html', kind: 'table' },
      { id: 'sai-yorii', name: '埼玉県 寄居林業事務所', url: 'https://www.pref.saitama.lg.jp/b0923/tuukoudome.html', kind: 'table' },
    ],
    13: [{ id: 'tokyo', name: '東京都 森林事務所', url: 'https://forestry-office.metro.tokyo.lg.jp/about/rin/rin_kisei/index.html', kind: 'tokyo' }],
  };
  const UNSUPPORTED = { 11: ['埼玉県 川越農林振興センター管内: 公開されているのは地図画像(PDF)が中心のため未対応(公式ページで確認してください)'] };
  const PDFJS = ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const rad = Math.PI / 180, R = 6371000;
  const hav = (a, b) => { const dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad; const s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); };

  let ctx = null; // {map, L, esc, getPoints, getPrefCodes, onChange}
  let found = [];  // 今回取得した結果(位置付き)
  let confirmed = []; // 「避ける」を確定したもの(localStorageに保存)
  let boost = [];  // 検証で追加する除外点
  let layer = null;
  try { confirmed = JSON.parse(localStorage.getItem(LS_CONF) || '[]'); } catch (e) { confirmed = []; }
  const saveConf = () => { try { localStorage.setItem(LS_CONF, JSON.stringify(confirmed)); } catch (e) {} };
  const relayUrl = () => { try { return (localStorage.getItem(LS_RELAY) || '').replace(/\/+$/, ''); } catch (e) { return ''; } };

  async function viaRelay(url, asBuffer) {
    const base = relayUrl();
    if (!base) throw new Error('中継のURLが未設定です');
    const r = await fetch(base + '/?url=' + encodeURIComponent(url));
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) {} throw new Error('中継から取得できません(' + r.status + (m ? ' ' + m : '') + ')'); }
    const meta = { fetchedAt: r.headers.get('X-Fetched-At'), lastModified: r.headers.get('X-Upstream-Last-Modified'), upstream: r.headers.get('X-Upstream-Status') };
    if (meta.upstream && meta.upstream !== '200') throw new Error('公式ページが応答しません(' + meta.upstream + ')');
    return { body: asBuffer ? await r.arrayBuffer() : await r.text(), meta };
  }
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('読み込めません: ' + src)); document.head.appendChild(s); }); }

  async function fetchSource(src) {
    const { body, meta } = await viaRelay(src.url, false);
    const doc = new DOMParser().parseFromString(body, 'text/html');
    if (src.kind === 'table') {
      const recs = ClosureParse.parseClosureTables(doc, src.url, meta.fetchedAt || new Date().toISOString());
      if (!recs.length) throw new Error('表を読み取れませんでした(ページの構造が変わった可能性)');
      return recs.map((r) => ({ ...r, sourceName: src.name }));
    }
    // 東京都: ページ内のPDFを取得して文字を取り出す
    const a = doc.querySelector('a[href$=".pdf"]');
    if (!a) throw new Error('PDFのリンクが見つかりません(ページの構造が変わった可能性)');
    const pdfUrl = new URL(a.getAttribute('href'), src.url).href;
    const pdf = await viaRelay(pdfUrl, true);
    await loadScript(PDFJS[0]);
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS[1];
    const d = await root.pdfjsLib.getDocument({ data: pdf.body }).promise;
    const pages = [];
    for (let i = 1; i <= d.numPages; i++) { const tc = await (await d.getPage(i)).getTextContent(); pages.push(tc.items.map((t) => ({ s: t.str, x: Math.round(t.transform[4]), y: Math.round(t.transform[5]), h: Math.round(t.height) })).filter((t) => t.s.trim())); }
    const recs = TokyoPdfParse.parseTokyoPages(pages, pdfUrl, pdf.meta.fetchedAt || new Date().toISOString());
    if (!recs.length) throw new Error('PDFの表を読み取れませんでした(形式が変わった可能性)');
    // 東京都の表記を共通の形に: 通行止め→全線扱いにはしない(区間の記載は原文のまま)
    return recs.map((r) => ({
      route: r.route, municipality: r.municipality, typeText: r.statusText, section: r.reasonOrSection || '', period: r.period, reason: null,
      status: r.status === '通行止め' ? '通行止め' : r.status === '通行規制' ? '一部規制' : r.status,
      scope: r.status === '通行止め' && /起点|地点|先|より/.test(r.statusText) && !/起点に柵有|起終点に柵有/.test(r.statusText) ? 'partial' : r.status === '通行止め' ? 'whole' : 'unknown',
      note: r.status === '通行規制' ? '東京都の定義: 通行は可能だが林業関係者以外の車両の乗り入れを規制(自転車の扱いは記載なし)' : null,
      bicycle: null, sourceUrl: pdfUrl, officialUpdated: r.officialUpdated ? `${r.officialUpdated.month}月${r.officialUpdated.day}日更新(年の記載なし)` : null, fetchedAt: r.fetchedAt, sourceName: src.name,
    }));
  }

  async function overpass(q) {
    let err;
    for (const h of OVERPASS) {
      try { const r = await fetch(h, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).elements || []; } catch (e) { err = e; }
    }
    throw err;
  }

  async function run(bbox, codes, say) {
    const results = []; const fails = []; const notes = [];
    for (const code of codes) {
      for (const u of UNSUPPORTED[code] || []) notes.push(u);
      const srcs = SOURCES[code];
      if (!srcs) continue;
      for (const s of srcs) {
        say(`${s.name} を取得中…`);
        try { results.push(...(await fetchSource(s))); } catch (e) { fails.push(`${s.name}: ${e.message}`); }
      }
    }
    // 規制のあるものだけを位置付けの対象にする(「特になし」等は位置を付けない)
    const targets = results.filter((r) => r.status === '通行止め' || r.status === '一部規制');
    let located = [];
    if (targets.length) {
      say('OpenStreetMapで同名の道を探しています…');
      try {
        const els = await overpass(ClosureLocate.buildQuery(targets, bbox));
        located = ClosureLocate.match(targets, els);
      } catch (e) { fails.push('OpenStreetMap検索: ' + e.message); located = targets.map((t) => ({ ...t, position: { level: 'なし', reason: 'OSM検索に失敗したため位置なし' }, ways: [] })); }
    }
    // 範囲内(bbox)に道がないものは一覧から外す(遠い県内の路線を並べない)
    const near = located.filter((r) => r.ways.length > 0);
    const outside = located.length - near.length;
    return { near, total: results.length, regulated: targets.length, outside, fails, notes };
  }

  function lenOf(ways) { let t = 0; for (const w of ways) for (let i = 1; i < w.pts.length; i++) t += hav(w.pts[i - 1], w.pts[i]); return t; }
  const keyOf = (r) => r.sourceName + '|' + r.route + '|' + (r.municipality || '');

  function drawFound() {
    if (!layer) layer = ctx.L.layerGroup().addTo(ctx.map);
    layer.clearLayers();
    for (const c of confirmed) for (const w of c.ways) ctx.L.polyline(w.pts, { color: '#B3261E', weight: 5, opacity: .9 }).addTo(layer).bindTooltip('避ける: ' + ctx.esc(c.route));
  }
  function showOne(r) {
    drawFound();
    for (const w of r.ways) ctx.L.polyline(w.pts, { color: r.position.level === '推定' ? '#C25A12' : '#B58900', weight: 5, opacity: .9, dashArray: '8 6' }).addTo(layer).bindTooltip(ctx.esc(r.route) + '(' + r.position.level + ')');
    const b = ctx.L.latLngBounds(r.ways.flatMap((w) => w.pts)); ctx.map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }

  function renderList(res) {
    const ul = document.querySelector('#ac-list'); ul.innerHTML = '';
    found = res.near;
    for (const [i, r] of found.entries()) {
      const isC = confirmed.some((c) => c.key === keyOf(r));
      const li = document.createElement('li'); li.style.flexWrap = 'wrap';
      const lvl = r.position.level;
      const badge = `<span class="badge" style="background:${r.status === '通行止め' ? '#B3261E' : '#B58900'};width:auto;border-radius:12px;padding:0 8px">${ctx.esc(r.status)}</span>`;
      li.innerHTML = `${badge}<div class="grow"><div class="nm" style="white-space:normal"><b>${ctx.esc(r.route)}</b> <span class="hint">${ctx.esc(r.municipality || '')}</span></div>`
        + `<div class="hint">区間: ${ctx.esc(r.section || r.typeText || '記載なし')}${r.period ? ' ・期間: ' + ctx.esc(r.period) : ''}${r.reason ? ' ・事由: ' + ctx.esc(r.reason) : ''}</div>`
        + `<div class="hint">位置: <b>${ctx.esc(lvl)}</b>(${ctx.esc(r.position.reason)}) ・ 自転車の通行可否: ${r.bicycle == null ? '記載なし' : r.bicycle ? '可' : '不可'}${r.note ? ' ・ ' + ctx.esc(r.note) : ''}</div>`
        + `<div class="hint">出典: <a href="${ctx.esc(r.sourceUrl)}" target="_blank" rel="noopener">${ctx.esc(r.sourceName)}</a> ・ 公式の更新: ${ctx.esc(r.officialUpdated || '不明')} ・ 取得: ${ctx.esc((r.fetchedAt || '').slice(0, 16).replace('T', ' '))}</div></div>`
        + `<button class="btn sm" data-a="show" data-i="${i}">地図で見る</button>`
        + (isC ? `<button class="btn sm" data-a="unavoid" data-i="${i}">避けるを解除</button>` : `<button class="btn sm pri" data-a="avoid" data-i="${i}">確認して避ける</button>`);
      ul.appendChild(li);
    }
    if (!found.length) ul.innerHTML = '<li class="hint">この範囲で位置が見つかった規制はありませんでした(位置が分からない規制は地図に出しません)</li>';
  }
  function listConfirmed() {
    const ul = document.querySelector('#ac-conf'); if (!ul) return; ul.innerHTML = '';
    for (const [i, c] of confirmed.entries()) { const li = document.createElement('li'); li.innerHTML = `<span class="badge" style="background:#B3261E">✕</span><div class="grow"><div class="nm">${ctx.esc(c.route)}(${ctx.esc(c.status)})</div><div class="hint">${ctx.esc(c.position)} ・ ${ctx.esc(c.sourceName)} ・ 取得 ${ctx.esc((c.fetchedAt || '').slice(0, 10))}</div></div><button class="btn sm" data-a="del" data-i="${i}">解除</button>`; ul.appendChild(li); }
    if (!confirmed.length) ul.innerHTML = '<li class="hint">「避ける」を確定した規制はありません</li>';
  }
  function setStatus(t) { const e = document.querySelector('#ac-st'); if (e) e.textContent = t || ''; }

  function init(c) {
    ctx = c;
    const $ = (s) => document.querySelector(s);
    $('#ac-relay').value = relayUrl();
    $('#ac-save').onclick = () => { const v = $('#ac-relay').value.trim(); try { localStorage.setItem(LS_RELAY, v); } catch (e) {} setStatus(v ? '中継のURLを保存しました' : '中継のURLを消しました'); };
    $('#ac-go').onclick = async () => {
      const pts = ctx.getPoints(); if (!pts.length) { setStatus('先に出発地と目的地を入れてください'); return; }
      setStatus('通る県を調べています…'); const codes = await ctx.getPrefCodes(); const known = codes.filter((k) => SOURCES[k]);
      if (!known.length) { setStatus('通過する県の自動取得にはまだ対応していません(対応: 埼玉県・東京都)'); return; }
      const m = 0.08; const bbox = [Math.min(...pts.map((p) => p.lat)) - m, Math.min(...pts.map((p) => p.lon)) - m, Math.max(...pts.map((p) => p.lat)) + m, Math.max(...pts.map((p) => p.lon)) + m].map((v) => +v.toFixed(4));
      $('#ac-go').disabled = true;
      try {
        const res = await run(bbox, known, setStatus); renderList(res);
        setStatus(`取得: 規制あり ${res.regulated}路線(全${res.total}行)のうち、この範囲でOSMに同名の道がある ${res.near.length}路線を表示。範囲外/道が見つからない ${res.outside}路線は表示しません。` + (res.fails.length ? ' 失敗: ' + res.fails.join(' / ') : '') + (res.notes.length ? ' 未対応: ' + res.notes.join(' / ') : ''));
      } catch (e) { setStatus('取得できませんでした: ' + e.message); }
      $('#ac-go').disabled = false;
    };
    $('#ac-list').onclick = (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return; const r = found[+b.dataset.i]; if (!r) return;
      if (b.dataset.a === 'show') showOne(r);
      else if (b.dataset.a === 'avoid') {
        if (r.position.level === '要確認' && !window.confirm('この規制は「一部区間」です。OSMの同名の道の全体を避けると、止まっていない部分も避けます。それでも避けますか?')) return;
        if (!window.confirm('地図で「' + r.route + '」の位置を確認しましたか?\n名前が同じ道を当てはめた推定です。違う場所の可能性があります。')) return;
        confirmed = confirmed.filter((c) => c.key !== keyOf(r));
        confirmed.push({ key: keyOf(r), route: r.route, status: r.status, position: r.position.level, sourceName: r.sourceName, sourceUrl: r.sourceUrl, fetchedAt: r.fetchedAt, section: r.section, ways: r.ways.map((w) => ({ id: w.id, pts: w.pts })) });
        saveConf(); drawFound(); listConfirmed(); renderList({ near: found }); ctx.onChange();
      } else if (b.dataset.a === 'unavoid') { confirmed = confirmed.filter((c) => c.key !== keyOf(r)); saveConf(); drawFound(); listConfirmed(); renderList({ near: found }); ctx.onChange(); }
    };
    $('#ac-conf').onclick = (e) => { const b = e.target.closest('button[data-a="del"]'); if (!b) return; confirmed.splice(+b.dataset.i, 1); saveConf(); drawFound(); listConfirmed(); if (found.length) renderList({ near: found }); ctx.onChange(); };
    drawFound(); listConfirmed();
  }

  // ---- ルート計算との連携 ----
  // Valhallaの除外地点は最大50個。確定した道に沿って等間隔に置く(検証で見つかった交差点は優先して追加)
  function samplePoints(budget) {
    const out = boost.slice(0, budget);
    const rest = budget - out.length; if (rest <= 0 || !confirmed.length) return out;
    const all = confirmed.flatMap((c) => c.ways);
    const total = lenOf(all); const step = Math.max(80, total / rest);
    for (const w of all) { let acc = step / 2; for (let i = 1; i < w.pts.length; i++) { const d = hav(w.pts[i - 1], w.pts[i]); acc += d; if (acc >= step) { acc = 0; out.push({ lat: w.pts[i][0], lon: w.pts[i][1] }); } if (out.length >= budget) return out; } if (!out.some(() => true)) out.push({ lat: w.pts[0][0], lon: w.pts[0][1] }); }
    return out.slice(0, budget);
  }
  // ルートが確定した道を通っているか(ルートの点が道の点から30m以内)
  function hits(routePts) {
    const res = [];
    for (const c of confirmed) {
      const near = [];
      for (const w of c.ways) for (const p of w.pts) { for (let i = 0; i < routePts.length; i += 1) { if (Math.abs(routePts[i][0] - p[0]) < 0.0004 && Math.abs(routePts[i][1] - p[1]) < 0.0005 && hav(routePts[i], p) < 30) { near.push({ lat: p[0], lon: p[1] }); break; } } }
      if (near.length) res.push({ route: c.route, points: near });
    }
    return res;
  }
  function addBoost(h) { for (const x of h) for (const p of x.points.filter((_, i) => i % 2 === 0)) if (!boost.some((b) => hav([b.lat, b.lon], [p.lat, p.lon]) < 25)) boost.push(p); }
  function resetBoost() { boost = []; }
  function active() { return confirmed.length > 0; }

  root.Closures = { init, samplePoints, hits, addBoost, resetBoost, active, _internal: { run, SOURCES, keyOf } };
})(typeof self !== 'undefined' ? self : this);
