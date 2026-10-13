/* 自転車旅メーター: 計測・ルート・GPXの計算部分（ブラウザとNodeの両方で動く純粋関数） */
(function (g) {
  'use strict';
  const MAX_ACC = 30;      // m  これより精度が悪い測位は記録しない
  const MOVE_V = 0.8;      // m/s (2.9 km/h) 未満は停止扱い
  const MAX_V = 33;        // m/s (約119 km/h) を超える移動は測位の飛びとして捨てる
  const MAX_SPEED_OK = 27.8; // m/s (100 km/h) まで最高速度に採用
  const MIN_STEP = 3;      // m  移動とみなす最小の点間距離
  const GAP_S = 30;        // s  これより長い測位の空白は「途切れ」
  const ASC_HYST = 5;      // m  獲得標高のヒステリシス
  const KEEPALIVE_S = 15;  // s  停止中も時刻を残すための点の間隔

  const r6 = v => Math.round(v * 1e6) / 1e6;
  function hav(a, b) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  const emptyStats = () => ({ dist: 0, moving: 0, max: 0, ascent: 0 });

  const SMOOTH_N = 5;      // 平滑化に使う直近の測位数
  const POS_STEP = 8;      // m  速度が取れない端末で、平滑化位置の移動を距離として足す最小幅

  function newRecorder(ride) {
    if (!ride.segs || !ride.segs.length) ride.segs = [[]];
    if (!ride.stats) ride.stats = emptyStats();
    const seg = ride.segs[ride.segs.length - 1];
    const last = seg.length ? seg[seg.length - 1] : null;
    return { segs: ride.segs, stats: ride.stats, gaps: ride.gaps || 0, last, prev: null, win: [], altWin: [], anchor: null,
      spdHist: [], eleBase: null, lastSpeed: 0, paused: false };
  }
  function resetFilters(rec) { rec.prev = null; rec.win = []; rec.altWin = []; rec.anchor = null; rec.spdHist = []; }
  function pause(rec) { rec.paused = true; }
  function resume(rec) {
    rec.paused = false;
    if (rec.segs[rec.segs.length - 1].length) rec.segs.push([]);
    rec.last = null; resetFilters(rec); // 一時停止中の移動は距離に含めない
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  function ascent(rec, alt, acc) {
    if (alt == null || acc > 20) return;
    rec.altWin.push(alt); if (rec.altWin.length > SMOOTH_N) rec.altWin.shift();
    if (rec.altWin.length < 3) return;
    const e = mean(rec.altWin);
    if (rec.eleBase == null) { rec.eleBase = e; return; }
    if (e - rec.eleBase >= ASC_HYST) { rec.stats.ascent += e - rec.eleBase; rec.eleBase = e; }
    else if (rec.eleBase - e >= ASC_HYST) rec.eleBase = e;
  }
  /**
   * 1回の測位を取り込む。fix: {lat, lon, acc(m), alt(m|null), speed(m/s|null), t(ms)}
   * 距離: 端末のGPS速度(ドップラー)があれば「速度×時間」で積分、なければ平滑化した位置の点間距離。
   * 30秒を超える空白(画面オフ等)は直線距離でつなぎ、gaps に数える。
   */
  function addFix(rec, f) {
    if (rec.paused || !(f.acc <= MAX_ACC)) return { added: false };
    const pf = rec.prev;
    let moved = 0, dt = 0, gap = false;
    if (pf) {
      dt = (f.t - pf.t) / 1000;
      if (dt <= 0) return { added: false };
      const dRaw = hav([pf.lat, pf.lon], [f.lat, f.lon]);
      if (dRaw / dt > MAX_V) return { added: false, rejected: 'jump' };
      if (dt > GAP_S) {
        gap = true; rec.win = []; rec.anchor = null; rec.spdHist = [];
        if (dRaw > Math.max(50, f.acc * 2)) {
          const avg = rec.stats.moving > 60 ? rec.stats.dist / rec.stats.moving : 4.5;
          rec.stats.moving += Math.min(dt, dRaw / Math.max(avg, 1));
          moved = dRaw; rec.gaps++;
        }
        rec.lastSpeed = f.speed != null ? f.speed : 0;
      }
    }
    // 位置の平滑化
    rec.win.push([f.lat, f.lon]); if (rec.win.length > SMOOTH_N) rec.win.shift();
    const sm = [mean(rec.win.map(p => p[0])), mean(rec.win.map(p => p[1])), f.t];
    if (pf && !gap) {
      let posSpeed = null;
      if (rec.anchor) {
        const d = hav(rec.anchor, sm), ta = (sm[2] - rec.anchor[2]) / 1000;
        posSpeed = ta > 0 ? d / ta : 0;
        if (d >= Math.max(POS_STEP, f.acc)) {
          if (f.speed == null || pf.speed == null) { if (posSpeed >= MOVE_V) moved = d; }
          rec.anchor = sm;
        }
      } else rec.anchor = sm;
      if (f.speed != null && pf.speed != null) {
        const vm = (f.speed + pf.speed) / 2;
        if (vm >= MOVE_V) moved = vm * dt;
        rec.anchor = sm;
      }
      const spd = f.speed != null ? f.speed : (posSpeed != null ? posSpeed : rec.lastSpeed);
      rec.lastSpeed = spd;
      if (spd >= MOVE_V) rec.stats.moving += Math.min(dt, 30);
      if (f.speed != null && f.acc <= 15) {
        rec.spdHist.push(f.speed); if (rec.spdHist.length > 3) rec.spdHist.shift();
        if (rec.spdHist.length === 3) {
          const med = rec.spdHist.slice().sort((a, b) => a - b)[1];
          if (med <= MAX_SPEED_OK && med > rec.stats.max) rec.stats.max = med;
        }
      }
    } else if (!pf) rec.anchor = sm;
    rec.stats.dist += moved;
    rec.prev = { lat: f.lat, lon: f.lon, t: f.t, speed: f.speed };
    ascent(rec, f.alt, f.acc);
    // 軌跡として保存する点（生の測位）
    const pt = [r6(f.lat), r6(f.lon), f.alt == null ? null : Math.round(f.alt * 10) / 10, f.t, Math.round(f.acc)];
    const seg = rec.segs[rec.segs.length - 1], last = rec.last;
    let store = !last;
    if (last) {
      const dl = hav(last, pt), tl = (pt[3] - last[3]) / 1000;
      store = gap || tl >= KEEPALIVE_S || (rec.lastSpeed >= MOVE_V && dl >= Math.max(MIN_STEP, f.acc * 0.4));
    }
    if (store) { seg.push(pt); rec.last = pt; }
    return { added: true, stored: store, moved };
  }

  /* ---- route ---- */
  function prepRoute(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] || 0, lastI: 0 };
  }
  function nearestIn(rc, lat, lon, a, b) {
    const k = Math.cos(lat * Math.PI / 180) * 111320, ky = 110574;
    let best = { d: Infinity, along: 0, i: 0 };
    for (let i = Math.max(0, a); i < Math.min(b, rc.pts.length - 1); i++) {
      const p = rc.pts[i], q = rc.pts[i + 1];
      const ax = (p[1] - lon) * k, ay = (p[0] - lat) * ky, bx = (q[1] - lon) * k, by = (q[0] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? -(ax * dx + ay * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx, ey = ay + t * dy, d = Math.sqrt(ex * ex + ey * ey);
      if (d < best.d) best = { d, along: rc.cum[i] + t * (rc.cum[i + 1] - rc.cum[i]), i };
    }
    if (rc.pts.length === 1) best = { d: hav(rc.pts[0], [lat, lon]), along: 0, i: 0 };
    return best;
  }
  /** 直前の位置の近く(前後)を優先して探し、外れていれば全体から探す（往復・周回ルートで先の区間に飛ばないように） */
  function nearestOnRoute(rc, lat, lon) {
    let n = nearestIn(rc, lat, lon, rc.lastI - 50, rc.lastI + 400);
    if (n.d > 100) n = nearestIn(rc, lat, lon, 0, rc.pts.length);
    rc.lastI = n.i;
    return n;
  }
  function parseGPX(text) {
    const x = new DOMParser().parseFromString(text, 'application/xml');
    if (x.getElementsByTagName('parsererror').length) throw new Error('GPXとして読めませんでした');
    let nodes = x.getElementsByTagName('trkpt');
    if (!nodes.length) nodes = x.getElementsByTagName('rtept');
    const pts = [];
    for (const n of nodes) {
      const la = parseFloat(n.getAttribute('lat')), lo = parseFloat(n.getAttribute('lon'));
      if (!isFinite(la) || !isFinite(lo)) continue;
      const e = n.getElementsByTagName('ele')[0]; const ev = e ? parseFloat(e.textContent) : NaN;
      pts.push([la, lo, isFinite(ev) ? ev : null]);
    }
    if (pts.length < 2) throw new Error('GPX内にルート(trkpt / rtept)が見つかりませんでした');
    const nm = x.getElementsByTagName('name')[0];
    return { name: nm ? nm.textContent.trim() : '', pts };
  }

  /* ---- GPX export ---- */
  const xesc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const iso = ms => new Date(ms).toISOString();
  function toGPX(ride) {
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="自転車旅メーター" xmlns="http://www.topografix.com/GPX/1/1">\n';
    s += `<metadata><name>${xesc(ride.name)}</name><time>${iso(ride.start)}</time></metadata>\n`;
    for (const m of ride.marks || []) s += `<wpt lat="${m.lat}" lon="${m.lon}"><time>${iso(m.t)}</time><name>${xesc(m.kind + ' ' + hm(m.t))}</name></wpt>\n`;
    s += `<trk><name>${xesc(ride.name)}</name>\n`;
    for (const seg of ride.segs) {
      if (seg.length < 2) continue;
      s += '<trkseg>\n';
      for (const p of seg) s += `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}<time>${iso(p[3])}</time></trkpt>\n`;
      s += '</trkseg>\n';
    }
    return s + '</trk>\n</gpx>\n';
  }

  /* ---- formatting ---- */
  const km = m => (m / 1000).toFixed(2);
  function hms(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  function hm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtDate(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${hm(ms)}`; }
  function fileStamp(ms) { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

  /* ---- browser helpers ---- */
  async function thumb(file, max) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('画像を変換できませんでした')), 'image/jpeg', 0.8));
  }
  /** 架空の周回走行（半径約1.5km、時速15〜30km）。室内での動作確認用 */
  function simulator(start) {
    const c0 = start ? [start.lat, start.lon] : [35.7020, 139.5600];
    const R = 1500, k = Math.cos(c0[0] * Math.PI / 180) * 111320;
    let ang = 0, t = Date.now(), alt = 60;
    return function () {
      const sp = 4.2 + 2.5 * Math.sin(ang * 3) + (Math.random() - .5);
      t += 1000; ang += sp / R;
      alt = 60 + 25 * Math.sin(ang * 2) + (Math.random() - .5) * 2;
      const lat = c0[0] + (R * Math.sin(ang)) / 110574 + (Math.random() - .5) * 0.00002;
      const lon = c0[1] + (R * (1 - Math.cos(ang))) / k + (Math.random() - .5) * 0.00002;
      // navigator.geolocation が返す GeolocationPosition と同じ形
      return { coords: { latitude: lat, longitude: lon, accuracy: 4 + Math.random() * 4, altitude: alt, speed: sp }, timestamp: t };
    };
  }

  const api = { MAX_ACC, MOVE_V, MAX_V, GAP_S, hav, emptyStats, newRecorder, pause, resume, addFix, prepRoute, nearestOnRoute, parseGPX, toGPX, km, hms, hm, fmtDate, fileStamp, thumb, simulator };
  g.RideCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
