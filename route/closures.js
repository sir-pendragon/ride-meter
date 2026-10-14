// 通行規制の自動取得(ルート計算のときだけ実行)
// 流れ: 中継から県の公式ページを取得 → 表/PDFを解析 → OSMの同名の道に「推定」で結び付け → 地図で確認して「避ける」を確定
// 原則: 情報がない・位置が特定できないものは地図に出さず、通行可能とも判定しない。名前だけで位置を確定扱いしない。
(function (root) {
  const LS_RELAY = 'rt-relay', LS_CONF = 'rt-confirmed', LS_GJ = 'rt-confirmed-gj';
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
  const PARSER_VER = 'p4'; // 解析プログラムを変えたら上げる(保存済みの解析結果を使い回さないため)
  const rad = Math.PI / 180, R = 6371000;
  const hav = (a, b) => { const dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad; const s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); };

  let autoFn = null;
  let ctx = null; // {map, L, esc, getPoints, getPrefCodes, onChange}
  let found = [];  // 今回取得した結果(位置付き)
  let confirmed = []; // 「避ける」を確定したもの(localStorageに保存)
  let boost = [];  // 検証で追加する除外点
  let layer = null;
  // 保存形式は GeoJSON(EPSG:4326 / [経度,緯度] の LineString・MultiLineString)。旧形式(rt-confirmed)は読み込み時に変換する
  const toFeature = (c) => ({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: c.lines.map((l) => l.map((p) => [+p[1].toFixed(6), +p[0].toFixed(6)])) }, properties: { key: c.key, route: c.route, status: c.status, position: c.position, basis: c.basis || null, confidence: c.confidence || null, section: c.section || null, period: c.period || null, reason: c.reason || null, sourceName: c.sourceName, sourceUrl: c.sourceUrl, fetchedAt: c.fetchedAt, officialUpdated: c.officialUpdated || null, bicycle: c.bicycle == null ? null : c.bicycle } });
  const fromFeature = (f) => { const g = f.geometry || {}; const ls = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []; return { ...f.properties, lines: ls.map((l) => l.map((q) => [q[1], q[0]])).filter((l) => l.length > 1) }; };
  const okLine = (l) => Array.isArray(l) && l.length > 1 && l.every((q) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]));
  let migrated = false;
  try {
    const gj = JSON.parse(localStorage.getItem(LS_GJ) || 'null');
    if (gj && gj.type === 'FeatureCollection' && Array.isArray(gj.features)) confirmed = gj.features.filter((f) => f && f.geometry && f.properties).map(fromFeature).filter((c) => c.lines.length);
    else {
      // 旧形式。区間の確認が無いまま全体を保存していたため、その旨を記録する
      confirmed = JSON.parse(localStorage.getItem(LS_CONF) || '[]').filter(Boolean).map((c) => ({ ...c, basis: c.basis || '旧形式から移行(区間の確認なし)', lines: (c.ways || []).map((w) => w && w.pts).filter(okLine) })).filter((c) => c.lines.length);
      migrated = confirmed.length > 0;
    }
  } catch (e) { confirmed = []; }
  const toGeoJSON = () => ({ type: 'FeatureCollection', crs: undefined, features: confirmed.map(toFeature) });
  const saveConf = () => { try { localStorage.setItem(LS_GJ, JSON.stringify(toGeoJSON())); } catch (e) {} };
  if (migrated) saveConf(); // 旧データ(rt-confirmed)は削除せず残す
  const relayUrl = () => { try { return (localStorage.getItem(LS_RELAY) || '').replace(/\/+$/, ''); } catch (e) { return ''; } };

  async function viaRelay(url, asBuffer) {
    const base = relayUrl();
    if (!base) throw new Error('中継のURLが未設定です');
    const r = await fetch(base + '/?url=' + encodeURIComponent(url));
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) {} const e = new Error('中継から取得できません(' + r.status + (m ? ' ' + m : '') + ')'); e.status = r.status === 403 || r.status === 429 || r.status >= 500 ? r.status : undefined; throw e; }
    const meta = { fetchedAt: r.headers.get('X-Fetched-At'), lastModified: r.headers.get('X-Upstream-Last-Modified'), etag: r.headers.get('X-Upstream-Etag'), upstream: r.headers.get('X-Upstream-Status') };
    if (meta.upstream && meta.upstream !== '200') { const e = new Error('公式ページが応答しません(' + meta.upstream + ')'); e.status = +meta.upstream; throw e; }
    return { body: asBuffer ? await r.arrayBuffer() : await r.text(), meta };
  }
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('読み込めません: ' + src)); document.head.appendChild(s); }); }

  const fc = () => (fc._i = fc._i || root.FetchCore.create());
  const perr = (m) => { const e = new Error(m); e.kind = 'parse'; return e; };
  const relayFetcher = (url, asBuffer) => async () => {
    try { const r = await viaRelay(url, asBuffer); return { data: r.body, meta: r.meta }; } catch (e) { throw e; }
  };

  async function fetchSource(src) {
    if (src.kind === 'table') {
      const r = await fc().load({
        key: src.url, ver: PARSER_VER, label: src.name, fetcher: relayFetcher(src.url, false),
        parse: async (body, meta) => {
          const doc = new DOMParser().parseFromString(body, 'text/html');
          const recs = ClosureParse.parseClosureTables(doc, src.url, meta.fetchedAt || new Date().toISOString());
          if (!recs.length) throw perr('表を読み取れませんでした(ページの構造が変わった可能性)');
          return recs.map((x) => ({ ...x, sourceName: src.name }));
        },
      });
      return tag(r);
    }
    // 東京都: ページ内のPDFリンクを見つけ、PDFを取得して文字を取り出す
    const pg = await fc().load({
      key: src.url, ver: PARSER_VER, label: src.name + '(ページ)', fetcher: relayFetcher(src.url, false),
      parse: async (body) => {
        const a = new DOMParser().parseFromString(body, 'text/html').querySelector('a[href$=".pdf"]');
        if (!a) throw perr('PDFのリンクが見つかりません(ページの構造が変わった可能性)');
        return [{ pdfUrl: new URL(a.getAttribute('href'), src.url).href }];
      },
    });
    const pdfUrl = pg.records[0].pdfUrl;
    const r = await fc().load({
      key: pdfUrl, ver: PARSER_VER, label: src.name + '(PDF)', fetcher: relayFetcher(pdfUrl, true),
      parse: async (buf, meta) => {
        await loadScript(PDFJS[0]);
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS[1];
        const d = await root.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        const pages = [];
        for (let i = 1; i <= d.numPages; i++) { const tc = await (await d.getPage(i)).getTextContent(); pages.push(tc.items.map((t) => ({ s: t.str, x: Math.round(t.transform[4]), y: Math.round(t.transform[5]), h: Math.round(t.height) })).filter((t) => t.s.trim())); }
        const recs = TokyoPdfParse.parseTokyoPages(pages, pdfUrl, meta.fetchedAt || new Date().toISOString());
        if (!recs.length) throw perr('PDFの表を読み取れませんでした(形式が変わった可能性)');
        // 東京都の表記を共通の形に: 区間の記載は原文のまま
        return recs.map((x) => ({
          route: x.route, municipality: x.municipality, typeText: x.statusText, section: x.reasonOrSection || '', period: x.period, reason: null,
          status: x.status === '通行止め' ? '通行止め' : x.status === '通行規制' ? '一部規制' : x.status,
          scope: x.status === '通行止め' && /起点|地点|先|より/.test(x.statusText) && !/起点に柵有|起終点に柵有/.test(x.statusText) ? 'partial' : x.status === '通行止め' ? 'whole' : 'unknown',
          note: x.status === '通行規制' ? '東京都の定義: 通行は可能だが林業関係者以外の車両の乗り入れを規制(自転車の扱いは記載なし)' : null,
          bicycle: null, sourceUrl: pdfUrl, officialUpdated: x.officialUpdated ? `${x.officialUpdated.month}月${x.officialUpdated.day}日更新(年の記載なし)` : null, fetchedAt: x.fetchedAt, sourceName: src.name,
        }));
      },
    });
    return tag(r);
  }
  // 情報期限切れ(取得に失敗して前回の内容を使う場合)を各レコードに付ける
  function tag(r) { return r.records.map((x) => (r.stale ? { ...x, stale: true, staleNote: r.error } : x)); }

  async function overpass(q) {
    let err;
    for (const h of OVERPASS) {
      try { const r = await fetch(h, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (j.remark && /error|timed out|timeout|memory/i.test(j.remark)) throw new Error('OSM検索が途中で打ち切られました'); return j.elements || []; } catch (e) { err = e; }
    }
    throw err;
  }

  // 国土地理院の逆ジオコーダで市町村名を調べる(失敗したら null を返し、候補は除外しない)
  async function muniResolver(centers) {
    const cache = new Map(); const kk = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
    let table = null;
    try { const t = await (await fetch('https://maps.gsi.go.jp/js/muni.js')).text(); table = {}; for (const m of t.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) table[m[1]] = m[2].split(',')[3]; } catch (e) { table = null; }
    if (table) {
      const uniq = []; for (const c of centers) if (!cache.has(kk(c))) { cache.set(kk(c), null); uniq.push(c); }
      // 同時に10件ずつ、最大240地点まで(国土地理院の逆ジオコーダ。超えた分は判定せず、除外もしない)
      const todo = uniq.slice(0, 240);
      const worker = async () => { while (todo.length) { const c = todo.shift(); try { const j = await (await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${c[0]}&lon=${c[1]}`)).json(); const cd = j.results && j.results.muniCd; cache.set(kk(c), (cd && table[String(cd).padStart(5, '0')]) || null); } catch (e) { /* 判定できない候補は除外しない */ } } };
      await Promise.all(Array.from({ length: 10 }, worker));
    }
    return (lat, lon) => cache.get(kk([lat, lon])) || null;
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
    const unk = results.filter((r) => r.status === '不明'); if (unk.length) notes.push(`種類を分類できなかった行が${unk.length}件あります(${unk.slice(0, 3).map((r) => r.route).join('・')}${unk.length > 3 ? ' ほか' : ''})。公式ページで確認してください`);
    // 規制のあるものだけを位置付けの対象にする(「特になし」等は位置を付けない)
    const targets = results.filter((r) => r.status === '通行止め' || r.status === '一部規制');
    let located = [];
    if (targets.length) {
      say('OpenStreetMapで同名の道を探しています…');
      try {
        const els = await overpass(ClosureLocate.buildQuery(targets, bbox));
        let landmarks = [];
        if (targets.some((t) => /橋|峠|トンネル|隧道|ダム/.test(t.section || ''))) {
          try { landmarks = ClosureLocate.parseLandmarks(await overpass(ClosureLocate.buildLandmarkQuery(bbox))); } catch (e) { notes.push('橋・峠の位置の取得に失敗したため、橋名・峠名で示された区間は位置不明になります'); }
        }
        let loc = ClosureLocate.locate(targets, els, { landmarks });
        // 同名の道が複数ある場合だけ、候補の場所の市町村を調べて絞り込む
        if (loc.some((r) => r.candidates && r.candidates.length && (r.municipality || /地内/.test(r.section || '')))) {
          say('市町村を確認しています…');
          const muniOf = await muniResolver(loc.flatMap((r) => (r.candidates || []).flatMap((c) => c.samples || [c.center])));
          loc = ClosureLocate.locate(targets, els, { landmarks, muniOf });
        }
        located = loc;
      } catch (e) { fails.push('OpenStreetMap検索: ' + e.message); located = targets.map((t) => ({ ...t, position: { level: 'なし', reason: 'OSM検索に失敗したため位置なし' }, ways: [] })); }
    }
    // 範囲内(bbox)に道がないものは一覧から外す(遠い県内の路線を並べない)
    const near = located.filter((r) => r.ways.length > 0);
    const outside = located.length - near.length;
    return { near, total: results.length, regulated: targets.length, outside, fails, notes };
  }

  const keyOf = (r) => r.sourceName + '|' + r.route + '|' + (r.municipality || '') + '|' + (r.section || '');
  const COL = { confirmed: '#B3261E', est: '#C25A12', unk: '#6B6B6B' };
  function densify(line, step) { const out = [line[0]]; for (let i = 1; i < line.length; i++) { const d = hav(line[i - 1], line[i]); const n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k / n, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k / n]); } return out; }
  const lenOfLines = (ls) => ls.reduce((t, l) => { for (let i = 1; i < l.length; i++) t += hav(l[i - 1], l[i]); return t; }, 0);

  // 地図に出す詳細(クリックで出典・事由・期間・根拠を表示)
  function popupHTML(x, level) {
    const e = ctx.esc;
    return `<div style="min-width:200px"><b>${e(x.route)}</b>(${e(x.status)})<br>位置: <b>${e(level)}</b>${x.confidence ? '・確度 ' + e(x.confidence) : ''}<br>`
      + `区間: ${e(x.section || '記載なし')}<br>期間: ${e(x.period || '記載なし')}<br>事由: ${e(x.reason || '記載なし')}<br>`
      + `自転車の通行可否: ${x.bicycle == null ? '公式資料に記載なし(不明)' : x.bicycle ? '可' : '不可'}<br>`
      + (x.basis ? `根拠: ${e(x.basis)}<br>` : '')
      + `出典: <a href="${e(x.sourceUrl)}" target="_blank" rel="noopener">${e(x.sourceName)}</a><br>取得: ${e((x.fetchedAt || '').slice(0, 16).replace('T', ' '))}${x.officialUpdated ? '<br>公式の更新: ' + e(x.officialUpdated) : ''}</div>`;
  }
  function drawFound() {
    if (!layer) layer = ctx.L.layerGroup().addTo(ctx.map);
    layer.clearLayers();
    for (const c of confirmed) for (const l of c.lines) ctx.L.polyline(l, { color: COL.confirmed, weight: 6, opacity: .9 }).addTo(layer).bindPopup(popupHTML(c, '確認済み(避ける)')).bindTooltip('避ける: ' + ctx.esc(c.route));
  }
  // 選んだ候補/全体を、推定(橙の破線)または不明(灰色の点線)として重ねる
  function showOne(r, cand) {
    drawFound();
    const all = [];
    const level = cand ? cand.level : r.position.level;
    if (cand && cand.pts && cand.pts.length > 1) { ctx.L.polyline(cand.pts, { color: COL.est, weight: 6, opacity: .95, dashArray: '8 6' }).addTo(layer).bindPopup(popupHTML({ ...r, basis: cand.basis, confidence: cand.confidence }, level)).bindTooltip(ctx.esc(r.route) + '(' + level + ')'); all.push(...cand.pts); }
    else if (!cand && r.usable && r.usable.length === 1) { const u = r.usable[0]; ctx.L.polyline(u.pts, { color: COL.est, weight: 6, opacity: .95, dashArray: '8 6' }).addTo(layer).bindPopup(popupHTML({ ...r, basis: u.basis, confidence: u.confidence }, u.level)); all.push(...u.pts); }
    else if (!cand && r.usable && r.usable.length > 1) { r.usable.forEach((u, i) => { ctx.L.polyline(u.pts, { color: COL.est, weight: 5, opacity: .9, dashArray: '8 6' }).addTo(layer).bindPopup(popupHTML({ ...r, basis: u.basis, confidence: u.confidence }, u.level)).bindTooltip(`案${i + 1}`); all.push(...u.pts); }); }
    else { for (const w of r.ways) { ctx.L.polyline(w.pts, { color: COL.unk, weight: 4, opacity: .8, dashArray: '2 8' }).addTo(layer).bindPopup(popupHTML({ ...r, basis: r.position.reason }, '不明(区間を特定できていません。通れるとは判断していません)')).bindTooltip(ctx.esc(r.route) + '(位置不明)'); all.push(...w.pts); } }
    if (all.length) ctx.map.fitBounds(ctx.L.latLngBounds(all), { padding: [40, 40], maxZoom: 15 });
  }

  function candLabel(r, u, i) { return `案${i + 1}: ${u.end ? u.end + 'から測定・' : ''}約${Math.round(Math.abs(u.d1 - u.d0))}m(確度 ${u.confidence})`; }
  function renderList(res) {
    const ul = document.querySelector('#ac-list'); ul.innerHTML = '';
    found = res.near;
    if (found.length) {
      const lg = document.createElement('li'); lg.className = 'hint'; lg.style.cssText = 'display:block';
      lg.innerHTML = `地図の色: <b style="color:${COL.confirmed}">━ 確認済み(避ける)</b> / <b style="color:${COL.est}">┅ 推定</b> / <b style="color:${COL.unk}">┈ 不明(区間が分からない。通れるとは判断しません)</b>`;
      ul.appendChild(lg);
    }
    for (const [i, r] of found.entries()) {
      const isC = confirmed.some((c) => c.key === keyOf(r));
      const li = document.createElement('li'); li.style.flexWrap = 'wrap';
      const lvl = r.position.level;
      const badge = `<span class="badge" style="background:${r.status === '通行止め' ? '#B3261E' : '#B58900'};width:auto;border-radius:12px;padding:0 8px">${ctx.esc(r.status)}</span>`;
      const multi = r.usable && r.usable.length > 1;
      li.innerHTML = `${badge}<div class="grow"><div class="nm" style="white-space:normal"><b>${ctx.esc(r.route)}</b> <span class="hint">${ctx.esc(r.municipality || '')}</span></div>`
        + `<div class="hint">区間: ${ctx.esc(r.section || r.typeText || '記載なし')}${r.period ? ' ・期間: ' + ctx.esc(r.period) : ''}${r.reason ? ' ・事由: ' + ctx.esc(r.reason) : ''}</div>`
        + `<div class="hint">位置: <b>${ctx.esc(lvl)}</b>(${ctx.esc(r.position.reason)}) ・ 自転車の通行可否: ${r.bicycle == null ? '記載なし' : r.bicycle ? '可' : '不可'}${r.note ? ' ・ ' + ctx.esc(r.note) : ''}${r.stale ? ' ・ <b>情報期限切れ(取得に失敗したため前回の内容)</b>' : ''}</div>`
        + `<div class="hint">出典: <a href="${ctx.esc(r.sourceUrl)}" target="_blank" rel="noopener">${ctx.esc(r.sourceName)}</a> ・ 公式の更新: ${ctx.esc(r.officialUpdated || '不明')} ・ 取得: ${ctx.esc((r.fetchedAt || '').slice(0, 16).replace('T', ' '))}</div>`
        + (multi ? `<div class="hint">候補:</div>` + r.usable.map((u, k) => `<div style="margin:2px 0"><span class="hint">${ctx.esc(candLabel(r, u, k))}${u.muni ? ' ・' + ctx.esc(u.muni) : ''}</span> <button class="btn sm" data-a="show" data-i="${i}" data-c="${k}">地図で見る</button> ${isC ? '' : `<button class="btn sm pri" data-a="avoid" data-i="${i}" data-c="${k}">この案で避ける</button>`}</div>`).join('') : '')
        + `</div>`
        + (multi ? `<button class="btn sm" data-a="show" data-i="${i}">全候補を見る</button>${isC ? `<button class="btn sm" data-a="unavoid" data-i="${i}">避けるを解除</button>` : ''}`
          : `<button class="btn sm" data-a="show" data-i="${i}">地図で見る</button>` + (isC ? `<button class="btn sm" data-a="unavoid" data-i="${i}">避けるを解除</button>` : r.selected ? `<button class="btn sm pri" data-a="avoid" data-i="${i}">確認して避ける</button>` : ''));
      ul.appendChild(li);
    }
    if (!found.length) ul.innerHTML = '<li class="hint">この範囲で位置が見つかった規制はありませんでした(位置が分からない規制は地図に出しません)</li>';
  }
  function listConfirmed() {
    const ul = document.querySelector('#ac-conf'); if (!ul) return; ul.innerHTML = '';
    for (const [i, c] of confirmed.entries()) { const li = document.createElement('li'); li.innerHTML = `<span class="badge" style="background:#B3261E">✕</span><div class="grow"><div class="nm">${ctx.esc(c.route)}(${ctx.esc(c.status)})</div><div class="hint">${ctx.esc(c.position)}${c.basis ? ' ・根拠: ' + ctx.esc(c.basis) : ''} ・ ${ctx.esc(c.sourceName)} ・ 取得 ${ctx.esc((c.fetchedAt || '').slice(0, 10))}</div></div><button class="btn sm" data-a="del" data-i="${i}">解除</button>`; ul.appendChild(li); }
    if (!confirmed.length) ul.innerHTML = '<li class="hint">「避ける」を確定した規制はありません</li>';
  }
  function setStatus(t) { const e = document.querySelector('#ac-st'); if (e) e.textContent = t || ''; }

  function avoid(r, cand) {
    const c0 = cand || r.selected;
    if (!c0) { window.alert('この規制は区間を特定できていないため、「避ける」を確定できません。'); return; }
    const partial = r.scope !== 'whole';
    const msg = (partial ? `「${r.route}」の公式の記載は「${r.section || r.typeText}」です。\n地図の案(約${Math.round(Math.abs(c0.d1 - c0.d0))}m)は推定であり、実際の規制区間とずれている可能性があります。\n` : `「${r.route}」を全線規制として、OSMの同名の道の全体を避けます。\n`) + '地図で位置を確かめましたか? 確かめた上でこの区間を避けますか?';
    if (!window.confirm(msg)) return;
    const lines = partial ? [c0.pts] : c0.ways.map((w) => w.pts);
    confirmed = confirmed.filter((c) => c.key !== keyOf(r));
    confirmed.push({ key: keyOf(r), route: r.route, status: r.status, position: partial ? '確認済み(区間は推定)' : '確認済み(全線)', basis: c0.basis, confidence: c0.confidence, sourceName: r.sourceName, sourceUrl: r.sourceUrl, fetchedAt: r.fetchedAt, officialUpdated: r.officialUpdated, section: r.section, period: r.period, reason: r.reason, bicycle: r.bicycle, lines });
    saveConf(); drawFound(); listConfirmed(); renderList({ near: found }); ctx.onChange();
  }

  function init(c) {
    ctx = c;
    const $ = (s) => document.querySelector(s);
    $('#ac-relay').value = relayUrl();
    $('#ac-save').onclick = () => { const v = $('#ac-relay').value.trim(); try { localStorage.setItem(LS_RELAY, v); } catch (e) {} setStatus(v ? '中継のURLを保存しました' : '中継のURLを消しました'); };
    let lastAuto = null;
    let running = false;
    async function fetchNow(auto) {
      if (running) return null; running = true; try { return await fetchNow2(auto); } finally { running = false; }
    }
    async function fetchNow2(auto) {
      const pts = ctx.getPoints(); if (!pts.length) { setStatus('先に出発地と目的地を入れてください'); return null; }
      setStatus('通る県を調べています…'); const codes = await ctx.getPrefCodes(); const known = codes.filter((k) => SOURCES[k]);
      if (!known.length) { setStatus('通過する県の自動取得にはまだ対応していません(対応: 埼玉県・東京都)'); return null; }
      const m = 0.08; const bbox = [Math.min(...pts.map((p) => p.lat)) - m, Math.min(...pts.map((p) => p.lon)) - m, Math.max(...pts.map((p) => p.lat)) + m, Math.max(...pts.map((p) => p.lon)) + m].map((v) => +v.toFixed(4));
      const sig = bbox.join(',') + '|' + known.join(',');
      if (auto && lastAuto && lastAuto.sig === sig && Date.now() - lastAuto.t < 600000) { setStatus('直前に取得済みのため再取得しません(10分以内)'); return null; }
      $('#ac-go').disabled = true;
      try {
        const res = await run(bbox, known, setStatus); renderList(res); lastAuto = { sig, t: Date.now() };
        const log = root.FetchCore ? fc().getLog().slice(-6).map((l) => `${l.label}:${l.result}`).join(' / ') : '';
        setStatus(`取得: 規制あり ${res.regulated}路線(全${res.total}行)のうち、この範囲でOSMに同名の道がある ${res.near.length}路線を表示。範囲外/道が見つからない ${res.outside}路線は表示しません。` + (res.fails.length ? ' 失敗: ' + res.fails.join(' / ') : '') + (res.notes.length ? ' 未対応・注意: ' + res.notes.join(' / ') : '') + (log ? ' 〔取得状況 ' + log + '〕' : ''));
      } catch (e) { setStatus('取得できませんでした: ' + e.message); }
      $('#ac-go').disabled = false;
    }
    $('#ac-go').onclick = () => fetchNow(false);
    autoFn = (timeoutMs) => Promise.race([fetchNow(true), new Promise((r) => setTimeout(() => r('timeout'), timeoutMs || 60000))]).catch(() => null);
    $('#ac-list').onclick = (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return; const r = found[+b.dataset.i]; if (!r) return;
      const cand = b.dataset.c != null ? r.usable[+b.dataset.c] : null;
      if (b.dataset.a === 'show') showOne(r, cand);
      else if (b.dataset.a === 'avoid') avoid(r, cand);
      else if (b.dataset.a === 'unavoid') { confirmed = confirmed.filter((c) => c.key !== keyOf(r)); saveConf(); drawFound(); listConfirmed(); renderList({ near: found }); ctx.onChange(); }
    };
    $('#ac-conf').onclick = (e) => { const b = e.target.closest('button[data-a="del"]'); if (!b) return; confirmed.splice(+b.dataset.i, 1); saveConf(); drawFound(); listConfirmed(); if (found.length) renderList({ near: found }); ctx.onChange(); };
    drawFound(); listConfirmed();
  }

  // ---- ルート計算との連携 ----
  // Valhallaの除外地点は最大50個。確定した区間に沿って等間隔に置く(検証で見つかった交差点は優先して追加)
  function samplePoints(budget) {
    const out = boost.slice(0, budget);
    const rest = budget - out.length; if (rest <= 0 || !confirmed.length) return out;
    const lines = confirmed.flatMap((c) => c.lines);
    const total = lenOfLines(lines); const step = Math.max(80, total / rest);
    for (const l of lines) {
      let acc = step / 2; let any = false;
      for (let i = 1; i < l.length; i++) { const d = hav(l[i - 1], l[i]); acc += d; if (acc >= step) { acc = 0; any = true; out.push({ lat: l[i][0], lon: l[i][1] }); } if (out.length >= budget) return out; }
      if (!any) { const mid = l[Math.floor(l.length / 2)]; out.push({ lat: mid[0], lon: mid[1] }); if (out.length >= budget) return out; }
    }
    return out.slice(0, budget);
  }
  // 点列(ルート)が、線(規制区間)から30m以内を通るか。ルートも線も25m間隔に補間して、頂点の間も判定する
  function nearLine(routeD, lineD, tol) {
    const near = [];
    for (const p of lineD) { for (const q of routeD) { if (Math.abs(q[0] - p[0]) < 0.0005 && Math.abs(q[1] - p[1]) < 0.0006 && hav(q, p) < tol) { near.push({ lat: p[0], lon: p[1] }); break; } } }
    return near;
  }
  function hits(routePts) {
    const res = []; if (!routePts || routePts.length < 2) return res; const rd = densify(routePts, 25);
    for (const c of confirmed) {
      const near = c.lines.flatMap((l) => nearLine(rd, densify(l, 25), 30));
      if (near.length) res.push({ route: c.route, points: near });
    }
    return res;
  }
  // まだ「避ける」を確定していない規制の道をルートが通る場合の注意。
  //   kind 'unknown'  : 区間を特定できていない(通れるとは判断しない・除外もできない)
  //   kind 'candidate': 位置の候補はあるが、ユーザーが確定していない
  function warnings(routePts) {
    const res = []; if (!routePts || routePts.length < 2) return res; const rd = densify(routePts, 25);
    for (const r of found) {
      if (confirmed.some((c) => c.key === keyOf(r))) continue;
      const kind = (r.selected || (r.usable && r.usable.length)) ? 'candidate' : 'unknown';
      const near = (r.ways || []).flatMap((w) => nearLine(rd, densify(w.pts, 25), 30));
      if (near.length) res.push({ route: r.route, status: r.status, kind });
    }
    return res;
  }
  function addBoost(h) { for (const x of h) for (const p of x.points.filter((_, i) => i % 2 === 0)) if (!boost.some((b) => hav([b.lat, b.lon], [p.lat, p.lon]) < 25)) boost.push(p); }
  function resetBoost() { boost = []; }
  function active() { return confirmed.length > 0; }
  const exportGeoJSON = () => toGeoJSON();

  root.Closures = { init, autoFetch: (ms) => (autoFn ? autoFn(ms) : Promise.resolve(null)), samplePoints, hits, warnings, addBoost, resetBoost, active, exportGeoJSON, _internal: { run, parseVer: PARSER_VER, SOURCES, keyOf, densify, nearLine } };
})(typeof globalThis !== "undefined" ? globalThis : self);
