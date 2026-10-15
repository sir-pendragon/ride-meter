/* ride-meter 実API診断(開発用)。通常の画面には出ない。
   起動: アドレスの末尾に ?rtdiag=1 を付けて開く(例: .../route/index.html?rtdiag=1)。画面の下に診断パネルが出て、「診断を開始」を押したときだけ通信する。
   やること: 実際の Valhalla(/route・/locate・/trace_attributes)と Overpass に、このアプリの実際の処理(compute)で、4つの条件+経由地つきを順番に問い合わせ、
            応答の形・回数・時間・エラー・取得できた属性を JSON にまとめる。
   しないこと: 利用者の地点・通行止め・APIキーは使わない/出さない。診断中は端末への保存(localStorage・RTStore)を止め、終了時に保存内容が変わっていないことを確かめる。
   削除: このファイルと、index.html の「RT-DIAG:BEGIN 〜 RT-DIAG:END」の1か所、tests/diag.test.js・tests/e2e/diag-flow.pw.py を消すだけ。 */
(function (root) {
  'use strict';
  const VERSION = 1;
  /* 診断用の固定地点(公開されている駅のおおよその位置。道路に載らないときは、診断の失敗として記録される。パネルで書き換えられる) */
  const PRESET = { id: 'ome-okutama', label: '青梅駅 → 御嶽駅(経由) → 奥多摩駅(おおよその位置)', s: [35.7878, 139.2762], v: [35.8054, 139.1934], g: [35.8091, 139.0973] };
  const LIMITS = { valhallaCap: 40, gapMs: 1500, cooldownMs: 60000, goWaitMs: 60000, scnTimeoutMs: 150000 };
  const CLIENT_ID = 'sir-pendragon.github.io/ride-meter';
  const REQUIRED = ['length', 'road_class', 'use', 'surface'];            // どの辺にも出ないなら異常
  const OPTIONAL = ['lane_count', 'speed_limit', 'cycle_lane', 'bridge', 'tunnel', 'travel_mode']; // 該当する道がなければ出ないことがある
  const ENUM = ['surface', 'road_class', 'use', 'travel_mode', 'cycle_lane'];

  /* ---------- 純粋関数(Nodeでも試験する) ---------- */
  const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
  /* 座標らしい数・APIキー・URLの中身を消す */
  function scrub(s) {
    return String(s == null ? '' : s).replace(/-?\d{1,3}\.\d{4,}/g, '<数>').replace(/AIza[0-9A-Za-z_-]{20,}/g, '<キー>')
      .replace(/https?:\/\/[^\s"')]+/g, (u) => { try { return new URL(u).origin; } catch (e) { return '<url>'; } }).slice(0, 200);
  }
  /* 応答の「形」だけ(値は入れない) */
  function schemaOf(v, d) {
    d = d == null ? 8 : d;
    if (v === null) return 'null';
    if (Array.isArray(v)) return d <= 0 ? ['…'] : [v.length ? schemaOf(v[0], d - 1) : 'empty'];
    if (typeof v === 'object') { if (d <= 0) return '{…}'; const o = {}; for (const k of Object.keys(v).slice(0, 40)) o[k] = schemaOf(v[k], d - 1); return o; }
    return typeof v;
  }
  function newAgg() { const a = { traces: 0, edges: 0, km: 0, present: {}, values: {}, bridge: 0, tunnel: 0 }; for (const k of REQUIRED.concat(OPTIONAL)) a.present[k] = 0; for (const k of ENUM) a.values[k] = {}; return a; }
  function addEdges(a, edges) {
    if (!Array.isArray(edges)) return;
    a.traces++;
    for (const e of edges) {
      if (!e || typeof e !== 'object') continue;
      a.edges++; a.km += +e.length || 0;
      for (const k of Object.keys(a.present)) if (e[k] !== undefined && e[k] !== null) a.present[k]++;
      for (const k of ENUM) if (e[k] !== undefined && e[k] !== null) { const v = scrub(e[k]); a.values[k][v] = (a.values[k][v] || 0) + 1; }
      if (e.bridge === true) a.bridge++;
      if (e.tunnel === true) a.tunnel++;
    }
  }
  /* 1つのルートの辺と、ルートの長さ(m)の整合 */
  function edgeFit(edges, lenM) {
    if (!Array.isArray(edges) || !edges.length || !(lenM > 0)) return null;
    const km = edges.reduce((x, e) => x + (+e.length || 0), 0);
    return r3(km * 1000 / lenM);
  }
  const pathGet = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : (Array.isArray(x) ? x[0] : x)[k]), o);

  /* 判定。確認できなかったものは「未確認」にし、成功にしない */
  function buildChecks(rep) {
    const C = [];
    const add = (id, item, res, detail) => C.push({ id, item, result: res, detail: detail || '' });
    const calls = rep.calls || [];
    const of = (p) => calls.filter((c) => c.svc === 'valhalla' && c.path === p);
    // /route
    const rs = of('/route'), rsch = rep.schemas['/route'];
    if (!rs.length) add('route.format', '1', '未確認', '/route の呼び出しがありませんでした');
    else {
      const okc = rs.filter((c) => c.status === 200).length;
      const shape = rsch && pathGet(rsch, 'trip.legs.shape') === 'string', len = rsch && pathGet(rsch, 'trip.summary.length') === 'number';
      add('route.format', '1', okc && shape ? 'OK' : (okc ? 'NG' : 'NG'), `応答 ${okc}/${rs.length} 件が200。trip.legs[].shape=${shape ? 'あり(文字列)' : 'なし'}、trip.summary.length=${len ? 'あり' : 'なし'}`);
    }
    // /locate
    const ls = of('/locate'), lsch = rep.schemas['/locate'];
    if (!ls.length) add('locate.format', '1', '未確認', '/locate の呼び出しがありませんでした');
    else {
      const okc = ls.filter((c) => c.status === 200).length, acc = lsch && pathGet(lsch, 'edges.edge.access.bicycle');
      add('locate.format', '1', okc && acc === 'boolean' ? 'OK' : 'NG', `応答 ${okc}/${ls.length} 件が200。edges[].edge.access.bicycle=${acc || 'なし'}`);
    }
    // /trace_attributes
    const ts = of('/trace_attributes'), A = rep.traceAttrs;
    if (!ts.length) add('trace.format', '1', '未確認', '/trace_attributes の呼び出しがありませんでした');
    else {
      const okc = ts.filter((c) => c.status === 200).length;
      const miss = REQUIRED.filter((k) => !A.present[k]), optMiss = OPTIONAL.filter((k) => !A.present[k]);
      let res = 'OK', d = `応答 ${okc}/${ts.length} 件が200。辺 ${A.edges} 本(${r3(A.km)} km)`;
      const bad = ts.filter((c) => c.status !== 200);
      if (bad.length) { res = 'NG'; d += `。失敗 ${bad.length} 件(` + [...new Set(bad.map((c) => (c.status || c.err) + (c.error && c.error.error_code ? '/code' + c.error.error_code : '')))].join(',') + ')'; }
      if (!okc || !A.edges) res = 'NG';
      else if (res === 'NG') { /* 失敗あり */ }
      else if (miss.length) { res = 'NG'; d += `。必須の属性が1本も出ない: ${miss.join(',')}`; }
      else if (optMiss.length) { res = '一部未確認'; d += `。出現しなかった属性(その道に無いだけの可能性): ${optMiss.join(',')}`; }
      add('trace.format', '1', res, d);
    }
    // 条件ごと
    for (const s of rep.scenarios) {
      if (s.kind !== 'mode') continue;
      const okm = s.error ? false : s.cands > 0 && s.sel >= 0;
      add('mode.' + s.id, '3', s.skipped ? '未確認' : okm ? 'OK' : 'NG', s.skipped ? ('実行せず: ' + s.skipped) : okm ? `候補 ${s.cands} 本(追加 ${s.auto} 本)、距離 ${s.best && s.best.km} km、獲得 ${s.best && s.best.gain} m、${s.ms} ms、通信 ${s.valhalla} 回` : `候補を作れませんでした(${s.error || '候補なし'})`);
    }
    // 道路属性と長さの整合
    const fits = rep.scenarios.filter((s) => s.best && s.best.edgeFit != null);
    if (!fits.length) add('attrs.fit', '2', '未確認', '道路属性を取得できた選択候補がありません');
    else { const bad = fits.filter((s) => s.best.edgeFit < 0.75 || s.best.edgeFit > 1.25); add('attrs.fit', '2', bad.length ? 'NG' : 'OK', '辺の長さ合計 ÷ ルートの長さ: ' + fits.map((s) => s.id + '=' + s.best.edgeFit).join(' / ') + '(0.75〜1.25を許容。橋・トンネル補正の位置合わせの条件と同じ)'); }
    // 経由地つき
    const via = rep.scenarios.find((s) => s.id === 'cmf-via');
    if (!via || via.skipped) add('via.attrs', '2', '未確認', via ? ('実行せず: ' + via.skipped) : '経由地つきの場面がありません');
    else add('via.attrs', '2', via.best && via.best.edgeFit != null && via.best.edgeFit >= 0.75 && via.best.edgeFit <= 1.25 ? 'OK' : 'NG', `経由地つきでも道路属性を取得できたか: 辺の長さ比 ${via.best ? via.best.edgeFit : 'なし'}、1ルートの区間数 ${via.best ? via.best.legs : '不明'}`);
    // 自動経由地
    const autos = rep.scenarios.reduce((n, s) => n + (s.auto || 0), 0), locTried = rep.scenarios.reduce((n, s) => n + (s.xlog ? s.xlog.locate || 0 : 0), 0);
    add('explore.auto', '2', autos > 0 ? 'OK' : '未確認', autos > 0 ? `自動の経由地による追加候補が ${autos} 本できました` : '追加候補はできませんでした(改善の余地がない・経由地が通れると確認できない等。自動経由地の実動作は未確認)');
    add('explore.locate', '2', locTried > 0 && ls.some((c) => c.status === 200) ? 'OK' : '未確認', locTried > 0 ? `探索で /locate を ${locTried} 回呼びました` : '探索の中で /locate は呼ばれませんでした(単体の確認呼び出しの結果は locate.format を参照)');
    // 橋・トンネル補正
    const fixed = rep.scenarios.reduce((n, s) => n + (s.fixedCands || 0), 0), st = A.bridge + A.tunnel;
    add('struct.fix', '2', st === 0 ? '未確認' : fixed > 0 ? 'OK' : '未確認', st === 0 ? 'この経路には橋・トンネルの辺が出ませんでした(補正の実動作は未確認)' : fixed > 0 ? `橋/トンネルの辺 ${st} 本。補正が入った候補 ${fixed} 本` : `橋/トンネルの辺 ${st} 本はあったが、補正は入りませんでした(位置のずれが25%を超える、または標高差がなかった可能性。原因は未確認)`);
    // Overpass
    const ov = calls.filter((c) => c.svc === 'overpass');
    add('overpass', '5', !ov.length ? '未確認' : ov.some((c) => c.status === 200) ? 'OK' : 'NG', ov.length ? `Overpass ${ov.length} 回(200: ${ov.filter((c) => c.status === 200).length}、その他: ${[...new Set(ov.filter((c) => c.status !== 200).map((c) => c.status || c.err))].join(',') || 'なし'})。取得済みの範囲は端末のキャッシュで再利用` : 'Overpass は呼ばれませんでした(キャッシュ済み、または景観・峠・自転車ルートの探索なし)');
    add('cors.xclientid', '5', rep.xClientId === 'allowed' ? 'OK' : rep.xClientId === 'blocked' ? 'NG' : '未確認', rep.xClientId === 'allowed' ? 'ヘッダー X-Client-Id を付けた /locate が通りました(アプリに付けられる見込み。付与は別途判断)' : rep.xClientId === 'blocked' ? 'X-Client-Id を付けた通信がブラウザに拒否されました(CORS不許可の可能性。アプリには付けない)' : '試験していません');
    // 負荷
    const v = calls.filter((c) => c.svc === 'valhalla'), lim = v.filter((c) => c.status === 429 || c.status === 503);
    add('limits', '5', lim.length ? 'NG' : 'OK', `Valhalla ${v.length} 回(上限 ${LIMITS.valhallaCap} 回)。429/503: ${lim.length} 回。診断全体 ${rep.totals.ms} ms`);
    add('storage', '6', rep.privacy.storageUnchanged ? 'OK' : 'NG', `診断の前後で端末の保存内容は${rep.privacy.storageUnchanged ? '同じでした' : '変わっていました'}。診断中に止めた書き込み ${rep.privacy.blockedWrites} 回`);
    return C;
  }
  /* 出力に座標・キーが残っていないかの自己点検(小数4桁以上の数・AIza…) */
  function leaks(json) { return /-?\d{1,3}\.\d{4,}/.test(json) || /AIza[0-9A-Za-z_-]{20,}/.test(json); }

  /* ---------- ブラウザでの実行 ---------- */
  function classify(url, VAL) {
    let u; try { u = new URL(url, typeof location !== 'undefined' ? location.href : undefined); } catch (e) { return { svc: 'other', host: '?' }; }
    if (VAL && u.origin === VAL) return { svc: 'valhalla', path: u.pathname };
    if (/overpass/.test(u.hostname)) return { svc: 'overpass', host: u.hostname };
    if (/\/xyz\/dem\//.test(u.pathname) || /cyberjapan/.test(u.hostname)) return { svc: 'dem', host: u.hostname };
    return { svc: 'other', host: u.hostname };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function start(ctx) {
    const { st, VAR, VAL, compute } = ctx;
    const $ = (s) => document.querySelector(s);
    const ctl = { calls: [], schemas: {}, agg: newAgg(), valCalls: 0, abort: '', scn: '', blocked: 0, running: false, lastEnd: 0, counts: {} };
    const lsSnap = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } } catch (e) { return 'ERR'; } return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); };

    /* 診断のあいだ、端末への保存を止める(このページを閉じるまで。利用者の保存データを診断の地点で上書きしないため) */
    const P = Storage.prototype, o = { set: P.setItem, rem: P.removeItem, clr: P.clear };
    P.setItem = function (k, v) { if (this === localStorage) { ctl.blocked++; return; } return o.set.call(this, k, v); };
    P.removeItem = function (k) { if (this === localStorage) { ctl.blocked++; return; } return o.rem.call(this, k); };
    P.clear = function () { if (this === localStorage) { ctl.blocked++; return; } return o.clr.call(this); };
    if (root.RTStore) { root.RTStore.set = async () => { ctl.blocked++; return false; }; root.RTStore.remove = async () => { ctl.blocked++; }; }

    /* 通信の記録(URL・本文は残さない。種別・パス・状態・時間だけ) */
    const origFetch = root.fetch.bind(root);
    root.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const c = classify(url, VAL), t = Date.now();
      if (c.svc === 'valhalla') {
        if (ctl.abort) throw new Error('診断を中止しました: ' + ctl.abort);
        if (ctl.valCalls >= LIMITS.valhallaCap) { ctl.abort = 'Valhalla の呼び出し回数が上限(' + LIMITS.valhallaCap + ')に達した'; throw new Error(ctl.abort); }
        ctl.valCalls++;
      }
      const rec = { scn: ctl.scn, svc: c.svc };
      if (c.path) rec.path = c.path; if (c.host && c.svc !== 'other') rec.host = c.host;
      try {
        const r = await origFetch(input, init);
        rec.status = r.status; rec.ms = Date.now() - t;
        if (c.svc === 'valhalla' || c.svc === 'overpass') {
          if (r.status === 429) ctl.abort = 'HTTP 429(利用制限)を受けた';
          if (c.svc === 'valhalla') r.clone().json().then((j) => {
            if (r.ok) {
              if (!ctl.schemas[c.path]) ctl.schemas[c.path] = schemaOf(j);
              if (c.path === '/trace_attributes') addEdges(ctl.agg, j && j.edges);
            } else if (j && typeof j === 'object') rec.error = { error_code: j.error_code, status_code: j.status_code, error: scrub(j.error) };
          }).catch(() => {});
        } else { ctl.counts[c.svc + ':' + ctl.scn] = (ctl.counts[c.svc + ':' + ctl.scn] || 0) + 1; return r; }
        if (ctl.calls.length < 300) ctl.calls.push(rec);
        return r;
      } catch (e) {
        rec.err = scrub(e && e.message); rec.ms = Date.now() - t;
        if (c.svc === 'valhalla' || c.svc === 'overpass') { if (ctl.calls.length < 300) ctl.calls.push(rec); } else ctl.counts[c.svc + ':' + ctl.scn] = (ctl.counts[c.svc + ':' + ctl.scn] || 0) + 1;
        throw e;
      }
    };

    /* 診断のあいだ、通行止め(自動取得・保存分)は使わない。結果が利用者の地点や中継サーバーの状態に左右されないようにするため */
    const CL = root.Closures, clSaved = {};
    const clStub = { autoFetch: () => Promise.resolve(), hits: () => [], warnings: () => [], samplePoints: () => [], gapText: () => '' };
    if (CL) for (const k of Object.keys(clStub)) { clSaved[k] = CL[k]; CL[k] = clStub[k]; }
    st.closures = [];

    /* ---------- パネル ---------- */
    const box = document.createElement('div');
    box.id = 'rt-diag-panel';
    box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;max-height:78vh;overflow:auto;background:#10151c;color:#e6edf3;border:2px solid #d29922;border-radius:10px;padding:10px;font:13px/1.5 system-ui,sans-serif';
    const fld = (id, v) => `<input id="${id}" value="${v}" inputmode="decimal" style="width:7.5em;background:#0d1117;color:#e6edf3;border:1px solid #444;border-radius:4px;padding:2px 4px">`;
    box.innerHTML = `<b style="color:#d29922">診断モード(開発用)</b>　<span style="opacity:.8">通常の画面ではありません。診断が終わったら「終了」を押してください。</span>
<div style="margin:6px 0">${PRESET.label}<br>
 出発 ${fld('dg-s1', PRESET.s[0])} ${fld('dg-s2', PRESET.s[1])}<br>経由 ${fld('dg-v1', PRESET.v[0])} ${fld('dg-v2', PRESET.v[1])}<br>到着 ${fld('dg-g1', PRESET.g[0])} ${fld('dg-g2', PRESET.g[1])}</div>
<div style="opacity:.85">押すと、実際の Valhalla・Overpass に通信します(目安: Valhalla 15〜35回、Overpass 数回。1回だけ、順番に。上限 ${LIMITS.valhallaCap} 回・429で中止)。診断中と、このページを閉じるまで、端末への保存は止めます。利用者の地点・通行止め・APIキーは使いません。</div>
<div style="margin:8px 0"><button id="dg-go" style="padding:6px 12px">診断を開始</button> <button id="dg-end" style="padding:6px 12px">終了(再読み込み)</button></div>
<div id="dg-log" style="white-space:pre-wrap;opacity:.9"></div>
<div id="dg-out" hidden><div style="margin:6px 0"><button id="dg-dl" style="padding:6px 12px">JSONを保存</button> <button id="dg-cp" style="padding:6px 12px">コピー</button></div><textarea id="dg-ta" readonly rows="8" style="width:100%;background:#0d1117;color:#e6edf3;font:11px monospace"></textarea></div>`;
    document.body.appendChild(box);
    const logEl = box.querySelector('#dg-log'), say = (t) => { logEl.textContent = t; };

    const num = (id, d) => { const v = parseFloat(box.querySelector(id).value); return Number.isFinite(v) ? v : d; };
    async function waitGo() { const t = Date.now(); while ($('#go') && $('#go').disabled) { if (Date.now() - t > LIMITS.goWaitMs) return false; await sleep(300); } return true; }

    function candInfo(c) {
      const o = { auto: !!c.auto, km: r3(c.len / 1000), gain: c.gain == null ? null : Math.round(c.gain) };
      if (c.m && c.m.fixed != null) o.fixedPts = c.m.fixed;
      try { if (c.zraw && c.D && root.__rt && root.__rt.metrics) { const g = root.__rt.metrics(c.D, c.zraw).gain; o.gainRaw = g == null ? null : Math.round(g); } } catch (e) { }
      if (c.cmf && !c.cmf.excluded) { const m = c.cmf; o.Q = r3(m.Q); o.H = r3(m.H); o.V = m.V == null ? null : r3(m.V); o.S = r3(m.S); o.unk = r3(m.unk); o.walkM = m.walkM == null ? null : Math.round(m.walkM); if (m.g) o.steep = { m9: Math.round((m.g.steep && m.g.steep.t1) || 0), m12: Math.round((m.g.steep && m.g.steep.t2) || 0), m15: Math.round(m.g.m15 || 0), n15: m.g.n15, anomalies: m.g.anom }; if (m.vd) o.scenic = { density: m.vd.density, pointScore: m.vd.pointScore, waterW: m.vd.waterW, waterScore: m.vd.waterScore, share100: r3(m.vd.waterShare), points: m.vd.points }; }
      else if (c.cmf && c.cmf.excluded) o.excluded = c.cmf.excluded;
      if (c.cyc != null) o.cyc = r3(c.cyc);
      if (c.fixInfo) o.fix = c.fixInfo;
      if (c.edges) { o.edges = c.edges.length; o.edgeFit = edgeFit(c.edges, c.len); }
      o.legs = c.shape === null ? 'multi' : 'single';
      return o;
    }
    function xl(x) { if (!x) return null; const o = { mode: x.mode, on: x.on, routes: x.routes, locate: x.locate, ms: x.ms, note: scrub(x.note), stages: [] };
      for (const s of (x.stages || []).slice(0, 5)) { const e = {}; if (s && typeof s === 'object') for (const k of Object.keys(s)) { if (/lat|lon|pt|via|coord|excl/i.test(k)) continue; const v = s[k]; if (typeof v === 'number') e[k] = r3(v); else if (typeof v === 'boolean') e[k] = v; else if (typeof v === 'string') e[k] = scrub(v); } o.stages.push(e); } return o; }

    async function scenario(sc, pts) {
      ctl.scn = sc.id; const t0 = Date.now(), v0 = ctl.valCalls, rec = { id: sc.id, kind: 'mode', mode: sc.mode, points: pts.length };
      if (ctl.abort) { rec.skipped = ctl.abort; return rec; }
      if (!(await waitGo())) { rec.skipped = '前の処理が終わらなかった'; return rec; }
      const sel = $('#obj'); sel.value = sc.mode;
      st.points = pts.map((p, i) => ({ lat: p[0], lon: p[1], name: '診断' + i, k: i === 0 ? 's' : i === pts.length - 1 ? 'g' : 'v' }));
      st.cands = []; st.sel = st.best = null; st.xlog = null; compute._r = 0;
      try { await Promise.race([compute(), sleep(LIMITS.scnTimeoutMs).then(() => { throw new Error('時間切れ(' + LIMITS.scnTimeoutMs / 1000 + '秒)'); })]); } catch (e) { rec.error = scrub(e && e.message); }
      for (let k = 0; k < 40 && st.sel && !st.sel.sfDone; k++) await sleep(200);   // 選ばれた候補の舗装率・橋トンネル補正(表示後に非同期)を待つ
      const stt = scrub(($('#st') || {}).textContent || '');
      if (!st.cands.length && !rec.error) rec.error = stt || '候補なし';
      rec.ms = Date.now() - t0; rec.valhalla = ctl.valCalls - v0; rec.cands = st.cands.length; rec.auto = st.cands.filter((c) => c.auto).length;
      rec.sel = st.cands.indexOf(st.sel); rec.best = st.sel ? candInfo(st.sel) : null; rec.all = st.cands.slice(0, 6).map(candInfo);
      rec.fixedCands = st.cands.filter((c) => c.m && c.m.fixed > 0).length; rec.xlog = xl(st.xlog);
      if (st.cmfErr && st.cmfErr.length) rec.warn = st.cmfErr.map(scrub); if (st.cycErr) rec.cycErr = scrub(st.cycErr);
      rec.apiPerKind = {}; for (const c of ctl.calls.filter((c) => c.scn === sc.id)) { const k = c.svc + (c.path || ''); rec.apiPerKind[k] = (rec.apiPerKind[k] || 0) + 1; }
      for (const k of Object.keys(ctl.counts)) if (k.endsWith(':' + sc.id)) rec.apiPerKind[k.split(':')[0]] = ctl.counts[k];
      return rec;
    }

    async function run() {
      if (ctl.running) return; if (ctl.lastEnd && Date.now() - ctl.lastEnd < LIMITS.cooldownMs) { say('連続して実行しないでください。あと ' + Math.ceil((LIMITS.cooldownMs - (Date.now() - ctl.lastEnd)) / 1000) + ' 秒待ってください。'); return; }
      ctl.running = true; box.querySelector('#dg-go').disabled = true; box.querySelector('#dg-out').hidden = true;
      Object.assign(ctl, { calls: [], schemas: {}, agg: newAgg(), valCalls: 0, abort: '', counts: {}, xcid: '' });
      const S = [num('#dg-s1', PRESET.s[0]), num('#dg-s2', PRESET.s[1])], V = [num('#dg-v1', PRESET.v[0]), num('#dg-v2', PRESET.v[1])], G = [num('#dg-g1', PRESET.g[0]), num('#dg-g2', PRESET.g[1])];
      const custom = [S, V, G].some((p, i) => p[0] !== [PRESET.s, PRESET.v, PRESET.g][i][0] || p[1] !== [PRESET.s, PRESET.v, PRESET.g][i][1]);
      const before = lsSnap(), t0 = Date.now(), scenarios = [];
      const plan = [{ id: 'min', mode: 'min', pts: [S, G] }, { id: 'max', mode: 'max', pts: [S, G] }, { id: 'cyc', mode: 'cyc', pts: [S, G] }, { id: 'cmf', mode: 'cmf', pts: [S, G] }, { id: 'cmf-via', mode: 'cmf', pts: [S, V, G] }];
      try {
        for (let i = 0; i < plan.length; i++) {
          say(`実行中 ${i + 1}/${plan.length}: ${plan[i].id}(通信 ${ctl.valCalls} 回)`);
          scenarios.push(await scenario(plan[i], plan[i].pts));
          await sleep(LIMITS.gapMs);
        }
        if (!ctl.abort) {   // /locate の形式と、X-Client-Id(公開サーバーが求める識別ヘッダー)がCORSで通るかの確認。1回だけ。失敗しても再送しない
          ctl.scn = 'probe-locate'; say('/locate の形式と X-Client-Id の通過を確認しています');
          const body = JSON.stringify({ locations: [{ lat: S[0], lon: S[1] }, { lat: G[0], lon: G[1] }], costing: 'bicycle', verbose: true });
          try { await root.fetch(VAL + '/locate', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Client-Id': CLIENT_ID }, body }); ctl.xcid = 'allowed'; }
          catch (e) { ctl.xcid = ctl.abort ? 'not-tested' : 'blocked'; }
          await sleep(300);
        }
      } finally { ctl.running = false; ctl.lastEnd = Date.now(); box.querySelector('#dg-go').disabled = false; }
      await sleep(400);   // 応答の解析(非同期)が終わるのを待つ
      const after = lsSnap();
      const cnt = {}; for (const c of ctl.calls) { const k = c.svc + (c.path || ''); cnt[k] = (cnt[k] || 0) + 1; }
      for (const k of Object.keys(ctl.counts)) { const s = k.split(':')[0]; cnt[s] = (cnt[s] || 0) + ctl.counts[k]; }
      const ua = navigator.userAgent || '', m = ua.match(/(Chrome|Firefox|Safari)\/(\d+)/);
      const rep = {
        tool: 'ride-meter-diag', version: VERSION, appCache: 'route-v61', at: new Date().toISOString(),
        client: { browser: m ? m[1] + '/' + m[2] : 'unknown', mobile: /Mobile|Android/i.test(ua) },
        route: { preset: PRESET.id, customCoords: custom, note: '地点の座標は結果に含めない' },
        limits: LIMITS, aborted: ctl.abort || null,
        totals: { ms: Date.now() - t0, valhalla: ctl.valCalls, perKind: cnt },
        calls: ctl.calls.map((c) => ({ scn: c.scn, svc: c.svc, path: c.path, host: c.host, status: c.status, ms: c.ms, err: c.err, error: c.error })),
        schemas: ctl.schemas, traceAttrs: { ...ctl.agg, km: r3(ctl.agg.km) }, scenarios,
        xClientId: ctl.xcid || 'not-tested', privacy: { storageUnchanged: before === after && before !== 'ERR', blockedWrites: ctl.blocked, usedUserPoints: false, usedUserClosures: false, usedApiKeys: false },
        terms: 'Valhalla(FOSSGIS公開サーバー): 公平利用。アプリ本体はX-Client-Id未付与(診断で通過可否を1回だけ試験)。Overpass: 目安 1日1万回・1GB未満'
      };
      rep.checks = buildChecks(rep);
      let json = JSON.stringify(rep, null, 1);
      if (leaks(json)) { rep.checks.push({ id: 'privacy.scan', item: '6', result: 'NG', detail: '座標らしい数値またはキーが出力に残っていたため、結果は表示しません' }); json = JSON.stringify({ tool: 'ride-meter-diag', error: '出力に座標らしい数値が含まれたため破棄', checks: rep.checks }, null, 1); }
      else rep.checks.push({ id: 'privacy.scan', item: '6', result: 'OK', detail: '出力に座標・APIキーは含まれていません(自己点検)' }), json = JSON.stringify(rep, null, 1);
      const sum = rep.checks.map((c) => `${c.result === 'OK' ? '✔' : c.result === 'NG' ? '✖' : '？'} ${c.id}: ${c.result}`).join('\n');
      say('完了。通信 Valhalla ' + ctl.valCalls + ' 回 / ' + rep.totals.ms + ' ms' + (ctl.abort ? '\n中止: ' + ctl.abort : '') + '\n' + sum);
      box.querySelector('#dg-ta').value = json; box.querySelector('#dg-out').hidden = false; ctl.json = json;
    }

    box.querySelector('#dg-go').onclick = () => { run().catch((e) => { ctl.running = false; box.querySelector('#dg-go').disabled = false; say('診断で例外: ' + scrub(e && e.message)); }); };
    box.querySelector('#dg-end').onclick = () => { location.href = location.pathname; };
    box.querySelector('#dg-dl').onclick = () => { const b = new Blob([ctl.json || ''], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ride-meter-diag-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    box.querySelector('#dg-cp').onclick = async () => { try { await navigator.clipboard.writeText(ctl.json || ''); say('コピーしました'); } catch (e) { box.querySelector('#dg-ta').select(); say('選択しました。コピーしてください'); } };
    root.__rtDiag = { run, ctl };
  }

  const api = { VERSION, PRESET, LIMITS, scrub, schemaOf, newAgg, addEdges, edgeFit, buildChecks, leaks, classify, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RtDiag = api; if (root.__rtDiagCtx) start(root.__rtDiagCtx); }
})(typeof window !== 'undefined' ? window : globalThis);
