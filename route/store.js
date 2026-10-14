// 端末の設定(Googleマップのキー、中継URL)をブラウザのキャッシュ削除から守る。
// 読む順: localStorage → IndexedDB(複製) → config.js(公開設定の予備)。見つかった値は localStorage に戻す。
// 「サイトデータ」を手動で全削除した場合は端末側の値は消えるが、config.js に値があれば復元される。
(function (root) {
  const KEYS = { 'rt-gkey': 'gmapsKey', 'rt-relay': 'relayUrl' };
  const DB = 'rt-store', OS = 'kv';
  const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) {} } };
  function open() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(OS);
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  const idb = (db, mode, fn) => new Promise((res) => { if (!db) return res(undefined); try { const t = db.transaction(OS, mode); const q = fn(t.objectStore(OS)); t.oncomplete = () => res(q && q.result); t.onerror = () => res(undefined); t.onabort = () => res(undefined); } catch (e) { res(undefined); } });
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(undefined), ms))]);
  async function restore() {
    const cfg = root.RT_CONFIG || {}; const out = {};
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    const db = await withTimeout(open(), 1500);
    for (const k of Object.keys(KEYS)) {
      let v = ls.get(k), from = v ? 'local' : '';
      if (!v) { v = (await withTimeout(idb(db, 'readonly', (s) => s.get(k)), 1500)) || ''; if (v) from = 'idb'; }
      if (!v && cfg[KEYS[k]]) { v = String(cfg[KEYS[k]]).trim(); if (v) from = 'config'; }
      if (v) { if (from !== 'local') ls.set(k, v); if (from !== 'idb') await withTimeout(idb(db, 'readwrite', (s) => s.put(v, k)), 1500); }
      out[k] = from;
    }
    root.__rtStore = { restored: out }; return out;
  }
  async function set(k, v) {
    const ok = ls.set(k, v); const db = await withTimeout(open(), 1500);
    await withTimeout(idb(db, 'readwrite', (s) => s.put(v, k)), 1500); return ok;
  }
  async function remove(k) { ls.del(k); const db = await withTimeout(open(), 1500); await withTimeout(idb(db, 'readwrite', (s) => s.delete(k)), 1500); }
  const api = { restore, set, remove, KEYS };
  if (typeof module !== 'undefined') module.exports = api; else root.RTStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
