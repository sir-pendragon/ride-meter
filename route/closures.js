// 通行規制の自動取得(ルート計算のときだけ実行)
// 流れ: 中継から県の公式ページを取得 → 表/PDFを解析 → OSMの同名の道に「推定」で結び付け → 地図で確認して「避ける」を確定
// 原則: 情報がない・位置が特定できないものは地図に出さず、通行可能とも判定しない。名前だけで位置を確定扱いしない。
(function (root) {
  const LS_RELAY = 'rt-relay', LS_CONF = 'rt-confirmed', LS_GJ = 'rt-confirmed-gj';
  const SOURCES = {
    11: [
      { id: 'sai-chichibu', name: '埼玉県 秩父農林振興センター', url: 'https://www.pref.saitama.lg.jp/b0904/tukoseigen/index.html', kind: 'table' },
      { id: 'sai-kawagoe', name: '埼玉県 川越農林振興センター', url: 'https://www.pref.saitama.lg.jp/b0902/forestry/road-closed.html', kind: 'table', closedTable: true },
      { id: 'sai-yorii', name: '埼玉県 寄居林業事務所', url: 'https://www.pref.saitama.lg.jp/b0923/tuukoudome.html', kind: 'table' },
    ],
    2: [{ id: 'aomori-road', name: '青森県 通行規制情報(国道・県道)', url: 'https://www.koutsu-aomori.com/tukodome_map/data/traffic_regulation.json5', kind: 'aomori' }],
    7: [{ id: 'fukushima-road', name: '福島県 道路通行規制情報(国道・県道)', url: 'http://www.pref.fukushima.jp/douro/kisei/kisei-list.htm', kind: 'fukushima', dataBase: 'http://www.pref.fukushima.jp/douro/kisei/json/' }],
    10: [{ id: 'gunma-road', name: '群馬県 道路規制情報(国道・県道)', url: 'https://www.kendobousai-gunma.jp/kisei/RegulationList.htm', kind: 'gunma' }],
    9: [{ id: 'tochigi-yaita', name: '栃木県 矢板森林管理事務所', url: 'https://www.pref.tochigi.lg.jp/d56/tuukoudome/2025rindo.html', kind: 'table', closedTable: true, brSep: true }],
    14: [{ id: 'kanagawa-keneirin', name: '神奈川県 自然環境保全センター(県営林道)', url: 'https://www.pref.kanagawa.jp/docs/f4y/03shinrin/seibi/keneirin/rinndou.html', kind: 'kanagawa' }],
    19: [
      { id: 'yamanashi', name: '山梨県 県営林道通行規制情報', url: 'https://www.pref.yamanashi.jp/rindoujyouhou/list.php', kind: 'yamanashi' },
      { id: 'kofu', muni: '山梨県|甲府市', name: '甲府市 市営林道通行規制情報', url: 'https://www.city.kofu.yamanashi.jp/machi/kotsu/index.html', kind: 'kofu' },
    ],
    20: [
      { id: 'matsumoto', muni: '長野県|松本市', name: '長野県 松本市 林道規制情報', url: 'https://www.city.matsumoto.nagano.jp/site/benricho/3182.html', kind: 'city', parse: 'parseMatsumoto' },
      { id: 'azumino', muni: '長野県|安曇野市', name: '長野県 安曇野市 林道などの道路状況', url: 'https://www.city.azumino.nagano.jp/soshiki/30/91218.html', kind: 'city', parse: 'parseAzumino' },
      { id: 'ina', muni: '長野県|伊那市', name: '長野県 伊那市 南アルプス林道の車両通行規制', url: 'https://www.inacity.jp/kankojoho/sangaku_alps/minamialps/minamialps_tozan/tozanshanominasamahe/rindoutuuko.html', kind: 'city', parse: 'parseIna' },
    ],
    13: [{ id: 'tokyo', name: '東京都 森林事務所', url: 'https://forestry-office.metro.tokyo.lg.jp/about/rin/rin_kisei/index.html', kind: 'tokyo' }],
  };
  const UNSUPPORTED = {};
  const PREF_ALL = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
  const prefName = (k) => PREF_ALL[k - 1] || ('県コード' + k);
  let lastGaps = null;
  let lastRun = null; // 直近のルート調査(取得が最後まで終わったときだけ入る)
  const PREF_NAMES = { 2: '青森県(国道・県道のみ)', 7: '福島県(国道・県道のみ)', 10: '群馬県(国道・県道のみ)', 20: '長野県(松本市・安曇野市・伊那市のみ)', 11: '埼玉県', 13: '東京都', 14: '神奈川県(県営林道)', 19: '山梨県', 9: '栃木県(矢板のみ)' };
  const PDFJS = ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const PARSER_VER = 'p9'; // 解析プログラムを変えたら上げる(保存済みの解析結果を使い回さないため)
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
    if (asBuffer) return { body: await r.arrayBuffer(), meta };
    // 文字コードが UTF-8 でないページ(群馬県は Shift_JIS 系)は、応答の charset に合わせて読む
    const cs = ((r.headers.get('Content-Type') || '').match(/charset=([\w-]+)/i) || [])[1];
    if (cs && !/^utf-?8$/i.test(cs)) { try { return { body: new TextDecoder(cs).decode(await r.arrayBuffer()), meta }; } catch (e) { /* 未対応の文字コード名なら下の既定に */ } }
    return { body: await r.text(), meta };
  }
  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('読み込めません: ' + src)); document.head.appendChild(s); }); }

  const fc = () => (fc._i = fc._i || root.FetchCore.create());
  const perr = (m) => { const e = new Error(m); e.kind = 'parse'; return e; };
  const relayFetcher = (url, asBuffer) => async () => {
    try { const r = await viaRelay(url, asBuffer); return { data: r.body, meta: r.meta }; } catch (e) { throw e; }
  };

  // 山梨県: 一覧(1回)→「規制中・規制予定」の県営林道だけ詳細ページを取得(同時に3件まで)。市町村営は詳細に規制の内容がないため一覧の情報だけ使う
  async function fetchYamanashi(src) {
    const list = await fc().load({
      key: src.url, ver: PARSER_VER, label: src.name + '(一覧)', fetcher: relayFetcher(src.url, false),
      parse: async (body) => { const rows = ClosureYamanashi.parseList(new DOMParser().parseFromString(body, 'text/html'), src.url); if (rows.length < 20) throw perr('山梨県の一覧を読み取れませんでした(ページの構造が変わった可能性)'); return rows; },
    });
    const flagged = list.records.filter((x) => x.kisei || x.yotei);
    const out = []; const fails = [];
    for (const x of flagged.filter((y) => !/^県営/.test(y.mgmt))) {
      out.push({ route: ClosureYamanashi.routeName(x.name), municipality: null, typeText: x.mgmt + ' 規制' + (x.kisei ? '中' : '予定'), section: '', period: null, reason: null, status: '不明', scope: 'unknown',
        note: x.mgmt + 'の林道のため、規制の内容は各市町村に問い合わせが必要(県のページに内容の記載なし)', bicycle: null, rid: 'L' + x.url, sourceUrl: x.url, officialUpdated: null, fetchedAt: new Date().toISOString(), sourceName: src.name, basis: '県公式ページの一覧', stale: list.stale || undefined });
    }
    const todo = flagged.filter((y) => /^県営/.test(y.mgmt)); const today = new Date();
    const worker = async () => {
      while (todo.length) {
        const x = todo.shift();
        try {
          const r = await fc().load({
            key: x.url, ver: PARSER_VER, label: src.name + ' ' + x.name, fetcher: relayFetcher(x.url, false),
            parse: async (body, meta) => ClosureYamanashi.parseDetail(new DOMParser().parseFromString(body, 'text/html'), x.url, meta.fetchedAt || new Date().toISOString(), { today }),
          });
          out.push(...r.records.filter((y) => !y.skip).map((y) => ({ ...y, sourceName: src.name, stale: r.stale || undefined })));
        } catch (e) { fails.push(x.name); }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    if (fails.length) out.failed = fails;
    return { records: tag({ records: out, stale: false }), failed: fails, total: flagged.length };
  }

  const rawText = {}; // ページ本文(解析が走ったときだけ入る。AI二重チェック用)
  async function fetchSource(src) {
    if (src.kind === 'yamanashi') { const r = await fetchYamanashi(src); if (r.failed.length) src._partial = `詳細ページ${r.failed.length}/${r.total}件を取得できませんでした(${r.failed.slice(0, 3).join('・')}${r.failed.length > 3 ? ' ほか' : ''})`; else src._partial = null; const ys = r.records; ys._ai = { key: src.url + '#details', text: ys.filter((x) => x.reason && x.rid && !/^L/.test(x.rid)).map((x) => `【${x.route}】(${x.municipality || ''}) ${x.reason}`).join('\n').slice(0, 39000) }; return ys; }
    if (src.kind === 'aomori' || src.kind === 'fukushima' || src.kind === 'gunma') {
      // 道路(国道・県道)の規制ページ。林道の規制が後から載っても拾えるよう、一覧全体を読む。日付で現在の規制かを判定するため、日付が変わったら再解析する
      const ver = PARSER_VER + '@' + new Date().toISOString().slice(0, 10);
      if (src.kind === 'fukushima') {
        const KINDS = [['災害', 'listSAIGAI'], ['工事', 'listKOUJI'], ['冬期', 'listTOUKI'], ['その他', 'listOTHERS']];
        const lists = []; let stale = null; let newest = null;
        for (const [kind, f] of KINDS) {
          const u = src.dataBase + f + '.json';
          const r = await fc().load({ key: u, ver, label: src.name + '(' + kind + ')', fetcher: relayFetcher(u, false), parse: async (body) => { const a = JSON.parse(body); if (!Array.isArray(a)) throw perr('一覧の形式が違います(ページが変わった可能性)'); return a; } });
          lists.push({ kind, items: r.records }); if (r.stale) stale = r; if (!newest || r.fetchedAt > newest) newest = r.fetchedAt;
        }
        let updated = null;
        try { const ui = src.dataBase + 'info.json'; const r = await fc().load({ key: ui, ver, label: src.name + '(更新日時)', fetcher: relayFetcher(ui, false), parse: async (body) => [JSON.parse(body)] }); const d = (r.records[0] || {}).information_date; if (d) updated = String(d).slice(0, 10); } catch (e) { /* 更新日が取れなくても規制は読む */ }
        const recs = ClosureRoad.parseFukushima(lists, src.url, newest || new Date().toISOString(), { updated }).map((x) => ({ ...x, sourceName: src.name, stale: stale ? true : undefined }));
        recs._ai = { key: src.url, hash: null, text: null }; return recs;
      }
      const r = await fc().load({
        key: src.url, ver, label: src.name, fetcher: relayFetcher(src.url, false),
        parse: async (body, meta) => {
          const at = meta.fetchedAt || new Date().toISOString();
          let recs;
          if (src.kind === 'aomori') { recs = ClosureRoad.parseAomori(body, src.url, at, { lastModified: meta.lastModified }); }
          else {
            const doc = new DOMParser().parseFromString(body, 'text/html');
            if (!doc.querySelector('table') || !/規制路線/.test(body)) throw perr('表を読み取れませんでした(ページの構造が変わった可能性)');
            recs = ClosureRoad.parseGunma(doc, src.url, at); rawText[src.url] = pageText(doc);
          }
          return recs.map((x) => ({ ...x, sourceName: src.name }));
        },
      });
      const tr = tag(r); tr._ai = { key: src.url, hash: r.hash, text: rawText[src.url] || null }; return tr;
    }
    if (src.kind === 'city' || src.kind === 'kofu') {
      // 日付で現在の規制かどうかを判定する解析のため、日付が変わったら再解析する
      const ver = PARSER_VER + '@' + new Date().toISOString().slice(0, 10);
      const toDoc = (b) => new DOMParser().parseFromString(b, 'text/html');
      let pageUrl = src.url;
      if (src.kind === 'kofu') {
        // 甲府市はお知らせごとにページのURLが変わるため、「交通」ページから「市営林道通行規制情報」のリンクを探す
        const idx = await fc().load({
          key: src.url, ver, label: src.name + '(案内ページ)', fetcher: relayFetcher(src.url, false),
          parse: async (body) => { const link = ClosureCity.findKofuLink(toDoc(body), src.url); if (!link) throw perr('市営林道通行規制情報のページが見つかりません(ページが移動した可能性)'); return [{ url: link }]; },
        });
        pageUrl = idx.records[0].url;
      }
      const r = await fc().load({
        key: pageUrl, ver, label: src.name, fetcher: relayFetcher(pageUrl, false),
        parse: async (body, meta) => {
          const doc = toDoc(body); const at = meta.fetchedAt || new Date().toISOString();
          const recs = src.kind === 'kofu' ? ClosureCity.parseKofu(doc, pageUrl, at) : ClosureCity[src.parse](doc, pageUrl, at);
          const has = src.kind === 'kofu' ? /路線名/.test(body) && /通行規制/.test(body) : src.parse === 'parseMatsumoto' ? /規制内容/.test(body) : src.parse === 'parseAzumino' ? /規制等/.test(body) : /南アルプス林道/.test(body);
          if (!has) throw perr('ページの構造を読み取れませんでした(ページが変わった可能性)');
          rawText[pageUrl] = pageText(doc);
          return recs.map((x) => ({ ...x, sourceName: src.name }));
        },
      });
      const tr = tag(r); tr._ai = { key: pageUrl, hash: r.hash, text: rawText[pageUrl] || null }; return tr;
    }
    if (src.kind === 'kanagawa') {
      const r = await fc().load({
        key: src.url, ver: PARSER_VER, label: src.name, fetcher: relayFetcher(src.url, false),
        parse: async (body, meta) => {
          const doc = new DOMParser().parseFromString(body, 'text/html');
          const recs = ClosureKanagawa.parseKanagawa(doc, src.url, meta.fetchedAt || new Date().toISOString());
          if (!recs.length) throw perr('表を読み取れませんでした(ページの構造が変わった可能性)');
          rawText[src.url] = pageText(doc);
          return recs.map((x) => ({ ...x, sourceName: src.name }));
        },
      });
      const tr = tag(r); tr._ai = { key: src.url, hash: r.hash, text: rawText[src.url] || null }; return tr;
    }
    if (src.kind === 'table') {
      const r = await fc().load({
        key: src.url, ver: PARSER_VER, label: src.name, fetcher: relayFetcher(src.url, false),
        parse: async (body, meta) => {
          const doc = new DOMParser().parseFromString(body, 'text/html');
          const recs = ClosureParse.parseClosureTables(doc, src.url, meta.fetchedAt || new Date().toISOString(), { closedTable: !!src.closedTable, brSep: !!src.brSep });
          if (!recs.length) throw perr('表を読み取れませんでした(ページの構造が変わった可能性)');
          rawText[src.url] = [...doc.querySelectorAll('table')].map((t) => [...t.rows].map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\s+/g, ' ').trim()).join(' | ')).join('\n')).join('\n\n').slice(0, 39000);
          return recs.map((x) => ({ ...x, sourceName: src.name }));
        },
      });
      const tr = tag(r); tr._ai = { key: src.url, hash: r.hash, text: rawText[src.url] || null }; return tr;
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

  // Geminiに送る本文: 規制の情報を含まない部分(スクリプト・メニュー・フッター・フォーム等)を除いて、トークンを減らす
  function pageText(doc) {
    const b = doc.body ? doc.body.cloneNode(true) : null; if (!b) return '';
    for (const e of Array.from(b.querySelectorAll('script,style,noscript,svg,nav,footer,form,iframe'))) e.remove();
    return (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 39000);
  }

  async function overpass(q) {
    let err;
    for (const h of OVERPASS) {
      try { const r = await fetch(h, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (j.remark && /error|timed out|timeout|memory/i.test(j.remark)) throw new Error('OSM検索が途中で打ち切られました'); return j.elements || []; } catch (e) { err = e; }
    }
    throw err;
  }

  // ---- 市町村の表(コード→県名・市町村名)と、逆ジオコーダ(地点→市町村コード)。1回の計算の中で共有し、端末に保存する ----
  // 表: 端末保存(90日) → 同じサイトの静的データ(data/muni-table.json) → 国土地理院 muni.js の順に使う
  const LS_MT = 'rt-munitbl', LS_RG = 'rt-rg', RG_MAX = 4000;
  const lsj = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  let muniRawP = null;
  function getMuniRaw() {
    if (muniRawP) return muniRawP;
    const p = (async () => {
      const c = lsj(LS_MT, null);
      if (c && c.t && Object.keys(c.t).length && Date.now() - c.at < 90 * 864e5) return c.t;
      let t = null;
      try { const r = await fetch('../data/muni-table.json'); if (r.ok) { const j = await r.json(); if (j && j.t && Object.keys(j.t).length >= 1000) t = j.t; } } catch (e) { /* 静的データが無ければ国土地理院から取る */ }
      if (!t) {
        const txt = await (await fetch('https://maps.gsi.go.jp/js/muni.js')).text(); t = {};
        for (const m of txt.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) { const a = m[2].split(','); t[m[1].padStart(5, '0')] = [a[1], a[3]]; }
        if (!Object.keys(t).length) throw new Error('市町村の表を読めませんでした');
      }
      try { localStorage.setItem(LS_MT, JSON.stringify({ at: Date.now(), t })); } catch (e) {}
      return t;
    })();
    muniRawP = p; p.catch(() => { if (muniRawP === p) muniRawP = null; });
    return p;
  }
  // 逆ジオコーダ: 同じ地点(小数5桁≒1m)は端末に保存した結果を使う。取得できなかった地点は保存しない
  let rg = null, rgDirty = false;
  const rgKey = (la, lo) => Number(la).toFixed(5) + ',' + Number(lo).toFixed(5);
  async function revGeo(la, lo) {
    if (!rg) rg = new Map(Object.entries(lsj(LS_RG, {})));
    const k = rgKey(la, lo); if (rg.has(k)) return rg.get(k);
    try { const j = await (await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${la}&lon=${lo}`)).json(); const cd = j.results && j.results.muniCd; if (cd) { const v = String(cd).padStart(5, '0'); rg.set(k, v); rgDirty = true; return v; } } catch (e) { /* 判定できない地点は null */ }
    return null;
  }
  function rgSave() {
    if (!rg || !rgDirty) return; rgDirty = false;
    while (rg.size > RG_MAX) rg.delete(rg.keys().next().value);
    try { localStorage.setItem(LS_RG, JSON.stringify(Object.fromEntries(rg))); } catch (e) {}
  }
  // 候補の市町村名を調べる(失敗したら null を返し、候補は除外しない)
  async function muniResolver(centers) {
    const cache = new Map(); const kk = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
    let table = null; try { table = await getMuniRaw(); } catch (e) { table = null; }
    if (table) {
      const uniq = []; for (const c of centers) if (!cache.has(kk(c))) { cache.set(kk(c), null); uniq.push(c); }
      // 同時に10件ずつ、最大240地点まで(国土地理院の逆ジオコーダ。超えた分は判定せず、除外もしない)
      const todo = uniq.slice(0, 240);
      const worker = async () => { while (todo.length) { const c = todo.shift(); const cd = await revGeo(c[0], c[1]); const v = cd && table[cd]; cache.set(kk(c), (v && v[1]) || null); } };
      await Promise.all(Array.from({ length: 10 }, worker)); rgSave();
    }
    return (lat, lon) => cache.get(kk([lat, lon])) || null;
  }

  // ---- Geminiによる二重チェック(中継の /ai を使う。参考情報であり、判定は変えない) ----
  const LS_AI = 'rt-ai', LS_AICACHE = 'rt-aicache', AI_VER = 'a1';
  const aiEnabled = () => !!relayUrl(); // 常に併用する(キーが中継に無いときは、その旨を1回だけ表示して以後の呼び出しを止める)
  let aiBlocked = false;
  async function aiCall(text) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 40000);
    try {
      const r = await fetch(relayUrl() + '/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, today: new Date().toISOString().slice(0, 10) }), signal: ctl.signal });
      if (r.status === 503) { const e = new Error('Geminiのキーが中継に設定されていません'); e.code = 'noconf'; throw e; }
      if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) {} throw new Error('Geminiの呼び出しに失敗しました(' + r.status + (m ? ' ' + m : '') + ')'); }
      const j = await r.json(); if (!j.ok) throw new Error('Geminiの応答を使えませんでした'); return j.items;
    } finally { clearTimeout(tm); }
  }
  // records: 私たちの解析結果(_ai に text/hash/key が付いている)。戻り値: { records(ai付き), aiOnly, note }
  async function aiApply(src, records) {
    const meta = records._ai; const res = { records, aiOnly: [], note: null };
    if (!aiEnabled() || !meta || aiBlocked) return res;
    let hash = meta.hash; const cache = lsj(LS_AICACHE, {});
    try {
      if (!hash && meta.text) hash = await root.FetchCore.sha256Hex(meta.text);
      let ent = cache[meta.key];
      if (!(ent && ent.hash === hash && ent.ver === AI_VER)) {
        if (!meta.text) { res.note = `${src.name}: ページ本文が手元にないため、今回はAIチェックを行いません(ページが変わった時に実施)`; return res; }
        if (meta.text.length < 20) { res.note = `${src.name}: ページ本文がほとんど無いため、AIチェックを行いません`; return res; }
        const items = await aiCall(meta.text);
        const v = AiCheck.verifyItems(items, meta.text);
        ent = { hash, ver: AI_VER, at: new Date().toISOString(), items: v.kept, rejected: v.rejected }; cache[meta.key] = ent;
        for (const k of Object.keys(cache)) { const t = Date.parse(cache[k] && cache[k].at); if (!Number.isFinite(t) || Date.now() - t > 120 * 864e5) delete cache[k]; } // 120日より古い判定結果は消す
        try { localStorage.setItem(LS_AICACHE, JSON.stringify(cache)); } catch (e) {}
      }
      const cmp = AiCheck.compare(records, ent.items);
      cmp.records._ai = meta; res.records = cmp.records;
      res.aiOnly = cmp.aiOnly.map((x) => ({ ...x, sourceName: src.name, sourceUrl: src.url }));
      if (ent.rejected) res.note = `${src.name}: AIの項目のうち${ent.rejected}件は、原文の引用が本文に見つからないため破棄しました`;
    } catch (e) { if (e.code === 'noconf') { aiBlocked = true; res.note = 'Geminiのキーが中継に設定されていないため、二重チェックは行っていません'; } else res.note = `${src.name}: AI二重チェックは行えませんでした(${e.message})`; }
    return res;
  }


  // ルートが通る市町村("県名|市町村名")を国土地理院の逆ジオコーダで調べる。判定できなければ null(絞り込みはしない)
  async function routeMunis(pts, say) {
    if (!pts || !pts.length) return null;
    let tb; try { tb = await getMuniRaw(); } catch (e) { return null; }
    // 約1.5kmごと(最大200地点)+スタート・経由地・到着地。間隔より短い区間だけ通る市町村は拾えないことがある
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    let total = 0; for (let i = 1; i < pts.length; i++) total += hav(pts[i - 1], pts[i]);
    const step = Math.max(1500, total / 200); const sample = [pts[0]]; let acc = 0, next = step;
    for (let i = 1; i < pts.length; i++) { acc += hav(pts[i - 1], pts[i]); if (acc >= next) { sample.push(pts[i]); next += step; } }
    sample.push(pts[pts.length - 1]);
    const keys = new Set(); let ok = 0; const todo = sample.slice(); if (say) say('通る市町村を調べています…');
    const worker = async () => { while (todo.length) { const c = todo.shift(); const cd = await revGeo(c[0], c[1]); const v = cd && tb[cd]; if (v) { ok++; keys.add(v[0] + '|' + root.MuniRegistry.normName(v[1])); } } };
    await Promise.all(Array.from({ length: 8 }, worker)); rgSave();
    return ok >= Math.ceil(sample.length * 0.8) ? keys : null; // 8割未満しか判定できなければ、絞り込みに使わない
  }

  async function run(bbox, codes, say, muniKeys) {
    aiBlocked = false;
    const results = []; const fails = []; const notes = []; const aiOnly = []; const skipped = []; let aiTried = false;
    for (const code of codes) {
      for (const u of UNSUPPORTED[code] || []) notes.push(u);
      const srcs = SOURCES[code];
      if (!srcs) continue;
      for (const s of srcs) {
        if (!root.MuniRegistry.wantsMuni(s, muniKeys)) { skipped.push(s.name); continue; }
        say(`${s.name} を取得中…`);
        try { let part = await fetchSource(s); if (aiEnabled()) { aiTried = true; say(`${s.name} をGeminiで二重チェック中…`); const ap = await aiApply(s, part); part = ap.records; aiOnly.push(...ap.aiOnly); if (ap.note && !notes.includes(ap.note)) notes.push(ap.note); } results.push(...part); if (s._partial) fails.push(`${s.name}: ${s._partial}`); } catch (e) { fails.push(`${s.name}: ${e.message}`); }
      }
    }
    if (skipped.length) notes.push('ルートが通らない市町村のため取得しなかったページ: ' + skipped.join('・'));
    const unk = results.filter((r) => r.status === '不明'); if (unk.length) notes.push(`規制の内容を判定できなかった行が${unk.length}件あります(通行止めとは扱いません。${unk.slice(0, 3).map((r) => r.route).join('・')}${unk.length > 3 ? ' ほか' : ''})。公式ページで確認してください`);
    // 規制のあるものだけを位置付けの対象にする(「特になし」等は位置を付けない)
    const targets = results.filter((r) => r.status === '通行止め' || r.status === '一部規制');
    let located = [];
    if (targets.length) {
      say('OpenStreetMapで同名の道を探しています…');
      try {
        const forest = targets.filter((t) => t.layer !== 'road'), roads = targets.filter((t) => t.layer === 'road');
        const els = forest.length ? await overpass(ClosureLocate.buildQuery(forest, bbox)) : [];
        if (roads.length) { try { els.push(...(await overpass(ClosureLocate.buildRoadQuery(roads, bbox)))); } catch (e) { notes.push('道路(国道・県道)の位置の取得に失敗したため、それらは位置なしになります'); } }
        let landmarks = [];
        if (targets.some((t) => /橋|峠|トンネル|隧道|ダム/.test(t.section || ''))) {
          try { landmarks = ClosureLocate.parseLandmarks(await overpass(ClosureLocate.buildLandmarkQuery(bbox))); } catch (e) { notes.push('橋・峠の位置の取得に失敗したため、橋名・峠名で示された区間は位置不明になります'); }
        }
        // OSMに無い橋名・峠名は、Googleマップの検索(Geocoding)で位置を補う(Google地図のときだけ。座標は保存せず、この実行中だけ使う)
        if (ctx.geocode) {
          const strip = (s) => String(s || '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '');
          const have = new Set(landmarks.map((l) => strip(l.name)));
          const need = new Map();
          for (const t of targets) {
            const sec = ClosureLocate.parseSection(t.section || '', t.scope);
            if (sec.type !== 'landmark') continue;
            for (const nm of [sec.a, sec.b].filter(Boolean)) if (!have.has(strip(nm)) && !need.has(strip(nm))) need.set(strip(nm), { name: nm, hint: t.municipality || '' });
          }
          if (need.size) {
            say(`橋名・峠名 ${Math.min(need.size, 30)}件をGoogleマップで検索しています…`);
            let added = 0, denied = false;
            for (const { name, hint } of [...need.values()].slice(0, 30)) {
              const q = String(hint || '').replace(/[ 　]*[→→].*$/, '').replace(/大字.*$/, '').trim();
              const p = await ctx.geocode(`${name} ${q}`.trim(), bbox);
              if (p && p.denied) { denied = true; break; }
              if (p) { landmarks.push({ name, lat: p.lat, lon: p.lon, kind: 'google', src: 'google' }); added++; }
            }
            if (denied) notes.push('Googleの住所検索(Geocoding API)が許可されていないため、OSMに無い橋名・峠名の位置は補えませんでした');
            else if (added) notes.push(`OSMに無い橋名・峠名のうち${added}件はGoogleマップの検索で位置が得られました(道から150m以内の場合だけ使い、座標は保存しません)`);
          }
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
    // 道路(国道・県道)の規制は、位置が決まらないものを地図に出さない(長い道の全体を「不明」で描くと誤解を招くため)。林道は従来どおり描く
    const isRoadUnk = (r) => r.layer === 'road' && !/林道/.test(r.route) && r.position && (r.position.level === '不明' || r.position.level === 'なし');
    const near = located.filter((r) => r.ways.length > 0 && !isRoadUnk(r));
    const roadUnk = located.filter((r) => r.ways.length > 0 && isRoadUnk(r));
    const outside = located.length - near.length;
    const gaps = {
      unjudged: results.filter((r) => r.status === '不明').map((r) => ({ route: r.route, municipality: r.municipality || '', why: r.note || '規制の内容を判定できませんでした', text: r.reason || r.typeText || '', url: r.sourceUrl, src: r.sourceName })),
      notFound: located.filter((r) => !r.ways || !r.ways.length).map((r) => ({ route: r.route, municipality: r.municipality || '', status: r.status, section: r.section || r.typeText || '', why: (r.position && r.position.reason) || 'この範囲のOSMに同名の道が見つかりません', url: r.sourceUrl, src: r.sourceName })),
      noPos: near.concat(roadUnk).filter((r) => r.position && (r.position.level === '不明' || r.position.level === 'なし')).map((r) => ({ route: r.route, municipality: r.municipality || '', status: r.status, why: r.position.reason, url: r.sourceUrl, src: r.sourceName })),
      aiDiff: results.filter((r) => r.ai && (r.ai.state === '相違' || r.ai.state === 'AIのみ検出')).map((r) => ({ route: r.route, municipality: r.municipality || '', state: r.ai.state, ours: r.status, ai: r.ai.aiStatus, aiSection: r.ai.aiSection, quote: r.ai.quote, url: r.sourceUrl, src: r.sourceName })),
      aiOnly, aiTried, fails: fails.slice(), sources: Object.fromEntries(codes.map((k) => [k, (SOURCES[k] || []).map((s) => ({ name: s.name, url: s.url }))])),
    };
    return { near, total: results.length, regulated: targets.length, outside, fails, notes, gaps };
  }

  const keyOf = (r) => r.sourceName + '|' + r.route + '|' + (r.municipality || '') + '|' + (r.section || '') + (r.rid ? '|' + r.rid : '');
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
  // ---- 取りこぼしの一覧 ----
  function buildGaps(res, allCodes) {
    const g = res ? res.gaps : { unjudged: [], notFound: [], noPos: [], fails: [], sources: {}, aiDiff: [], aiOnly: [] };
    const unsupported = (allCodes || []).filter((k) => !SOURCES[k]).map(prefName);
    lastGaps = { ...g, unsupported, count: g.unjudged.length + g.notFound.length + g.noPos.length + g.fails.length + unsupported.length + (g.aiDiff || []).length + (g.aiOnly || []).length };
    return lastGaps;
  }
  function gapText() {
    if (!lastGaps) return '';
    const p = [];
    if (lastGaps.unsupported.length) p.push(`${lastGaps.unsupported.join('・')}は自動取得に未対応`);
    if (lastGaps.fails.length) p.push(`取得失敗${lastGaps.fails.length}件`);
    if (lastGaps.notFound.length) p.push(`地図上で道を見つけられなかった規制${lastGaps.notFound.length}件`);
    if (lastGaps.noPos.length) p.push(`位置が不明な規制${lastGaps.noPos.length}件`);
    if (lastGaps.unjudged.length) p.push(`内容を判定できなかった行${lastGaps.unjudged.length}件`);
    const ad = (lastGaps.aiDiff || []).length + (lastGaps.aiOnly || []).length; if (ad) p.push(`AIの二重チェックで食い違い・未取り込みが${ad}件`);
    return p.length ? '取りこぼしの可能性: ' + p.join(' / ') + '。通行止めがないことの保証ではありません。' : '';
  }
  // 画面に出すのは、AIの二重チェックで食い違った項目だけ(それ以外の取りこぼしは、ルート結果の下の一行の注意にとどめる)
  function renderGaps() {
    const el = document.querySelector('#ac-gap'); if (!el) return;
    const g = lastGaps; const ad = g ? (g.aiDiff || []).length + (g.aiOnly || []).length : 0;
    if (!ad) { el.innerHTML = ''; return; }
    const e = ctx.esc; const link = (x) => `<a href="${e(x.url)}" target="_blank" rel="noopener">${e(x.src || '公式ページ')}</a>`;
    const li = (arr, f) => arr.map((x) => `<li style="display:block"><div class="nm" style="white-space:normal"><b>${e(x.route)}</b> <span class="hint">${e(x.municipality || '')}</span></div><div class="hint">${f(x)}</div></li>`).join('');
    el.innerHTML = `<div class="hint"><b>AI(Gemini)の二重チェックで食い違った項目(${ad}件・未確認の参考情報)</b><br>AIの読みは誤ることがあります。通行止めの判定や「避ける」には使っていません。引用は公式ページの本文に実在することを確認済みです。</div><ul class="sr">`
      + li(g.aiDiff || [], (x) => `${e(x.state)} ・ このアプリ: ${e(x.ours)} / AI: ${e(x.ai)}${x.aiSection ? '(' + e(x.aiSection) + ')' : ''} ・ 原文の引用: 「${e(x.quote)}」 ・ ${link(x)}`)
      + li(g.aiOnly || [], (x) => `AIのみ検出 ・ AI: ${e(x.status)}${x.section ? '(' + e(x.section) + ')' : ''} ・ 原文の引用: 「${e(x.quote)}」 ・ ${link(x)}`) + '</ul>';
  }

  // ルートが通る市町村の公式規制ページ(台帳 data/muni-inventory)。自動で内容を読めるのは一部だけで、他は公式ページへのリンクを示す
  let muniRender = 0;
  async function renderMunis(keys, prefCodes) {
    const el = document.querySelector('#ac-munis'); if (!el) return; const my = ++muniRender;
    if (!keys) { el.innerHTML = '<div class="hint">通る市町村を判定できなかったため、市町村の規制ページの一覧は出していません。</div>'; return; }
    const prefs = [...new Set([...keys].map((k) => k.split('|')[0]))].filter((p) => root.MuniRegistry.FILES[p]);
    if (!prefs.length) { el.innerHTML = ''; return; }
    const { reg, errs } = await root.MuniRegistry.load(prefs, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    if (my !== muniRender) return;
    const r = root.MuniRegistry.forRoute(reg, [...keys]); const e = ctx.esc;
    const auto = new Set(Object.values(SOURCES).flat().filter((s) => s.muni).map((s) => s.muni));
    const li = r.listed.map((x) => `<li style="display:block"><b>${e(x.name)}</b> <span class="hint">${e(x.pref)}・${x.status === 'found_empty' ? '今は規制の記載なし' : x.status === 'index_only' ? '専用の一覧なし(道路・防災の案内ページ)' : x.covers_forest_road === true ? '林道を含む' : '林道の記載は未確認'}${x.updated_hint ? '・更新 ' + e(x.updated_hint) : ''}</span> <a href="${e(x.url)}" target="_blank" rel="noopener">公式ページ ↗</a></li>`).join('');
    const un = r.unconfirmed.map((x) => x.name).join('・');
    el.innerHTML = `<div class="hint"><b>ルートが通る市町村の公式の規制ページ</b>(台帳は調査途中。内容はこのアプリでは読まず、リンクだけ示します)</div>${r.listed.length ? `<ul class="sr">${li}</ul>` : '<div class="hint">台帳に確認済みのページがある市町村はありません。</div>'}${un ? `<div class="hint">規制ページを確認できていない市町村: ${e(un)}(ページが無いという意味ではありません。通行止めが無いことの保証でもありません)</div>` : ''}${errs.length ? `<div class="hint">台帳を読めなかった県: ${e(errs.join('・'))}</div>` : ''}`;
    void prefCodes; void auto;
  }

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
      const li = document.createElement('li'); li.className = 'ac';
      const lvl = r.position.level; const e = ctx.esc;
      const badge = `<span class="badge" style="background:${r.status === '通行止め' ? '#B3261E' : '#B58900'};width:auto;border-radius:12px;padding:0 8px">${e(r.status)}</span>`;
      const multi = r.usable && r.usable.length > 1;
      const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
      const rows = [
        row('区間', e(r.section || r.typeText || '記載なし')),
        row('期間', r.period ? e(r.period) : ''),
        row('事由', r.reason ? e(r.reason) : ''),
        row('位置', `<b>${e(lvl)}</b>(${e(r.position.reason)})`),
        row('自転車', r.bicycle == null ? '通行可否の記載なし' : r.bicycle ? '通行可と記載' : '通行不可と記載'),
        row('備考', r.note ? e(r.note) : ''),
        row('注意', r.stale ? '<b>情報期限切れ(取得に失敗したため前回の内容)</b>' : ''),
        row('AI(参考)', r.ai ? `<b>${e(r.ai.state)}</b>${r.ai.aiStatus ? ' ・ AI: ' + e(r.ai.aiStatus) : ''}${r.ai.quote ? ' ・ 引用「' + e(r.ai.quote) + '」' : ''}` : ''),
        row('出典', `<a href="${e(r.sourceUrl)}" target="_blank" rel="noopener">${e(r.sourceName)}</a> ・ 公式の更新 ${e(r.officialUpdated || '不明')} ・ 取得 ${e((r.fetchedAt || '').slice(0, 16).replace('T', ' '))}`),
      ].join('');
      const cands = multi ? '<div class="hint" style="margin-top:4px">候補:</div>' + r.usable.map((u, k) => `<div class="ac-c"><span class="hint">${e(candLabel(r, u, k))}${u.muni ? ' ・' + e(u.muni) : ''}</span><span class="ac-b"><button class="btn sm" data-a="show" data-i="${i}" data-c="${k}">地図で見る</button>${isC ? '' : `<button class="btn sm pri" data-a="avoid" data-i="${i}" data-c="${k}">この案で避ける</button>`}</span></div>`).join('') : '';
      const btns = multi ? `<button class="btn sm" data-a="show" data-i="${i}">全候補を見る</button>${isC ? `<button class="btn sm" data-a="unavoid" data-i="${i}">避けるを解除</button>` : ''}`
        : `<button class="btn sm" data-a="show" data-i="${i}">地図で見る</button>` + (isC ? `<button class="btn sm" data-a="unavoid" data-i="${i}">避けるを解除</button>` : r.selected ? `<button class="btn sm pri" data-a="avoid" data-i="${i}">確認して避ける</button>` : '');
      li.innerHTML = `<div class="ac-h">${badge}<b>${e(r.route)}</b><span class="hint">${e(r.municipality || '')}</span></div><dl class="ac-d">${rows}</dl>${cands}<div class="ac-b">${btns}</div>`;
      ul.appendChild(li);
    }
    if (!found.length) ul.innerHTML = '<li class="hint">この範囲で位置が見つかった規制はありませんでした(位置が分からない規制は地図に出しません)</li>';
  }
  function listConfirmed() {
    const ul = document.querySelector('#ac-conf'); if (!ul) return; ul.innerHTML = '';
    for (const [i, c] of confirmed.entries()) { const li = document.createElement('li'); li.innerHTML = `<span class="badge" style="background:#B3261E">✕</span><div class="grow"><div class="nm">${ctx.esc(c.route)}(${ctx.esc(c.status)})</div><div class="hint">${ctx.esc(c.position)}${c.basis ? ' ・根拠: ' + ctx.esc(c.basis) : ''} ・ ${ctx.esc(c.sourceName)} ・ 取得 ${ctx.esc((c.fetchedAt || '').slice(0, 10))}</div></div><button class="btn sm" data-a="del" data-i="${i}">解除</button>`; ul.appendChild(li); }
    const h = document.querySelector('#ac-conf-h'); if (h) h.hidden = !confirmed.length;
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
    $('#ac-save').onclick = () => { const v = $('#ac-relay').value.trim(); try { localStorage.setItem(LS_RELAY, v); } catch (e) {} try { if (window.RTStore) window.RTStore.set(LS_RELAY, v); } catch (e) {} setStatus(v ? '中継のURLを保存しました' : '中継のURLを消しました'); };
    let lastAuto = null;
    let running = false;
    async function fetchNow(auto) {
      if (running) return null; running = true; try { return await fetchNow2(auto); } finally { running = false; }
    }
    async function fetchNow2(auto) {
      const pts = ctx.getPoints(); if (!pts.length) { setStatus('先にスタートとゴールを入れてください'); return null; }
      setStatus('通る県を調べています…'); const codes = await ctx.getPrefCodes(); const known = codes.filter((k) => SOURCES[k]);
      const muniKeys = ctx.getRoutePts ? await routeMunis(ctx.getRoutePts(), setStatus) : null; renderMunis(muniKeys, codes);
      if (!known.length) { buildGaps(null, codes); renderGaps(); setStatus('通過する県の自動取得にはまだ対応していません(対応: '+Object.keys(SOURCES).map((k)=>PREF_NAMES[k]||k).join('・')+')'); return null; }
      const m = 0.08; const bbox = [Math.min(...pts.map((p) => p.lat)) - m, Math.min(...pts.map((p) => p.lon)) - m, Math.max(...pts.map((p) => p.lat)) + m, Math.max(...pts.map((p) => p.lon)) + m].map((v) => +v.toFixed(4));
      const sig = bbox.join(',') + '|' + known.join(',') + '|' + (muniKeys ? [...muniKeys].sort().join(',') : '-');
      if (!(lastAuto && lastAuto.sig === sig)) lastRun = null; // 別のルートの調査結果を使い回さない
      if (auto && lastAuto && lastAuto.sig === sig && Date.now() - lastAuto.t < 600000) { setStatus('直前に取得済みのため再取得しません(10分以内)'); return null; }
      try {
        const res = await run(bbox, known, setStatus, muniKeys); lastRun = { fails: res.fails.slice(), unsupported: codes.filter((k) => !SOURCES[k]).map(prefName) }; renderList(res); buildGaps(res, codes); renderGaps(); lastAuto = { sig, t: Date.now() };
        const log = root.FetchCore ? fc().getLog().slice(-6).map((l) => `${l.label}:${l.result}`).join(' / ') : '';
        setStatus(`取得: 規制あり ${res.regulated}路線(全${res.total}行)のうち、この範囲でOSMに同名の道がある ${res.near.length}路線を表示。範囲外/道が見つからない ${res.outside}路線は表示しません。` + (res.fails.length ? ' 失敗: ' + res.fails.join(' / ') : '') + (res.notes.length ? ' 未対応・注意: ' + res.notes.join(' / ') : '') + (log ? ' 〔取得状況 ' + log + '〕' : ''));
      } catch (e) { buildGaps({ gaps: { unjudged: [], notFound: [], noPos: [], fails: ['取得できませんでした: ' + e.message], sources: {} } }, codes); renderGaps(); setStatus('取得できませんでした: ' + e.message); }
    }
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
      if (near.length) res.push({ route: r.route, status: r.status, kind, municipality: r.municipality || null, section: r.section || null, period: r.period || null, sourceName: r.sourceName || null, sourceUrl: r.sourceUrl || null });
    }
    return res;
  }
  function addBoost(h) { for (const x of h) for (const p of x.points.filter((_, i) => i % 2 === 0)) if (!boost.some((b) => hav([b.lat, b.lon], [p.lat, p.lon]) < 25)) boost.push(p); }
  function resetBoost() { boost = []; }
  function active() { return confirmed.length > 0; }
  const exportGeoJSON = () => toGeoJSON();

  root.Closures = { init, revGeo, rgSave, muniRaw: getMuniRaw, gapText, lastRun: () => lastRun, autoFetch: (ms) => (autoFn ? autoFn(ms) : Promise.resolve(null)), samplePoints, hits, warnings, addBoost, resetBoost, active, exportGeoJSON, _internal: { run, parseVer: PARSER_VER, SOURCES, keyOf, densify, nearLine } };
})(typeof globalThis !== "undefined" ? globalThis : self);
