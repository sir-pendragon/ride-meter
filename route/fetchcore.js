// 取得の共通部品: 本文ハッシュによる再解析の省略、10分キャッシュ、指数バックオフ、取得ログ。
// 公式サイトに過剰にアクセスしない・変わっていない資料を再解析しない・失敗理由を残す、ための部分。
(function (root) {
  const LS_CACHE = 'rt-fcache', LS_LOG = 'rt-flog';
  const TTL_MS = 10 * 60 * 1000;          // この時間内の再取得はキャッシュを使う
  const LOG_MAX = 100;
  const STALE_MAX_MS = 7 * 24 * 3600 * 1000; // 取得に失敗したときに前回の内容を使ってよい期間(これを超えたら使わない)

  const defaultStorage = () => { try { return root.localStorage; } catch (e) { return null; } };
  function makeStore(storage) {
    const st = storage || defaultStorage();
    const get = (k, d) => { try { return JSON.parse(st.getItem(k)) ?? d; } catch (e) { return d; } };
    const set = (k, v) => { try { st.setItem(k, JSON.stringify(v)); } catch (e) { /* 容量超過などは無視(キャッシュなしで動く) */ } };
    return { get, set };
  }

  async function sha256Hex(data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const h = await root.crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 再試行するのは「通信エラー・429・5xx」だけ。404などは再試行しない(取得先が無い/変わった、が原因のため)
  function isRetryable(e) { return !e.status || e.status === 429 || e.status >= 500; }
  async function withBackoff(fn, o = {}) {
    const tries = o.tries ?? 3, base = o.base ?? 800, max = o.max ?? 8000;
    const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let err;
    for (let i = 0; i < tries; i++) {
      try { return await fn(i); } catch (e) {
        err = e;
        if (!isRetryable(e) || i === tries - 1) break;
        await sleep(Math.min(max, base * 2 ** i) + Math.floor(Math.random() * 200)); // 800ms, 1.6s, 3.2s… + ゆらぎ
      }
    }
    throw err;
  }

  function describeError(e) {
    const s = e && e.status;
    if (s === 404 || s === 410) return 'リンク切れ(公式ページが見つかりません。削除または移動された可能性)';
    if (s === 403) return '取得を拒否されました(403)';
    if (s === 429) return 'アクセスが多すぎると判断されました(429)。時間をおいてください';
    if (s >= 500) return '公式サイトまたは中継が一時的に応答していません(' + s + ')';
    if (e && e.kind === 'parse') return e.message;
    return '通信できませんでした(' + ((e && e.message) || e) + ')';
  }

  function create(opts = {}) {
    const store = makeStore(opts.storage);
    const now = opts.now || (() => Date.now());
    const sleep = opts.sleep;

    function log(entry) {
      const l = store.get(LS_LOG, []); l.push({ t: new Date(now()).toISOString(), ...entry }); while (l.length > LOG_MAX) l.shift(); store.set(LS_LOG, l);
    }
    const getLog = () => store.get(LS_LOG, []);

    // key: キャッシュのキー(URL等) / fetcher: async()=>({data: string|ArrayBuffer, meta}) / parse: async(data, meta)=>records
    async function load({ key, label, fetcher, parse, ttl, ver }) {
      const cache = store.get(LS_CACHE, {});
      let c = cache[key];
      if (c && (c.ver || null) !== (ver || null)) c = null; // 解析プログラムを変えたら、保存済みの解析結果は使わず再解析する
      const t0 = now();
      if (c && now() - c.checkedAt < (ttl ?? TTL_MS)) {
        log({ key, label, result: 'キャッシュ', detail: '10分以内の再取得のため公式サイトへアクセスしません' });
        return { records: c.records, status: 'キャッシュ', fetchedAt: c.fetchedAt, hash: c.hash, stale: false };
      }
      let got;
      try { got = await withBackoff(() => fetcher(), { sleep }); } catch (e) {
        const msg = describeError(e);
        if (e && (e.status === 404 || e.status === 410)) { delete cache[key]; store.set(LS_CACHE, cache); } // 公式ページが無いなら、古い内容を使い続けない
        log({ key, label, result: '失敗', detail: msg, ms: now() - t0 });
        if (c && now() - c.fetchedAtMs >= STALE_MAX_MS) { delete cache[key]; store.set(LS_CACHE, cache); }
        if (c && !(e && (e.status === 404 || e.status === 410)) && now() - c.fetchedAtMs < STALE_MAX_MS) {
          return { records: c.records, status: '情報期限切れ', fetchedAt: c.fetchedAt, hash: c.hash, stale: true, error: msg };
        }
        const err = new Error(msg); err.status = e && e.status; throw err;
      }
      const hash = await sha256Hex(got.data);
      const fetchedAt = (got.meta && got.meta.fetchedAt) || new Date(now()).toISOString();
      if (c && c.hash === hash) {
        c.checkedAt = now(); c.fetchedAt = fetchedAt; c.fetchedAtMs = now(); store.set(LS_CACHE, cache);
        log({ key, label, result: '変更なし', detail: '本文のハッシュが前回と同じため再解析を省略', ms: now() - t0 });
        return { records: c.records, status: '変更なし', fetchedAt, hash, stale: false };
      }
      let records;
      try { records = await parse(got.data, got.meta || {}); } catch (e) {
        const msg = e && e.kind === 'parse' ? e.message : '解析に失敗しました: ' + ((e && e.message) || e);
        log({ key, label, result: '解析失敗', detail: msg, ms: now() - t0 });
        delete cache[key]; store.set(LS_CACHE, cache); // 構造が変わった可能性があるため、古い解析結果も使わない
        const err = new Error(msg); err.kind = 'parse'; throw err; // 構造が変わった可能性。古い内容は使わない
      }
      cache[key] = { ver: ver || null, fetchedAtMs: now(), hash, etag: (got.meta && got.meta.etag) || null, lastModified: (got.meta && got.meta.lastModified) || null, fetchedAt, checkedAt: now(), records };
      store.set(LS_CACHE, cache);
      log({ key, label, result: '成功', detail: records.length + '件を解析', ms: now() - t0 });
      return { records, status: '更新', fetchedAt, hash, stale: false };
    }
    return { load, getLog };
  }

  const api = { create, withBackoff, sha256Hex, describeError, isRetryable, TTL_MS };
  if (typeof module !== 'undefined') module.exports = api; else root.FetchCore = api;
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this));
