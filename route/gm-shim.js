// Googleマップ(Maps JavaScript API)で、アプリが使っている Leaflet の機能(L.map / polyline / marker など)を再現する薄い変換層。
// 使うのは「地図の表示」だけ。ルート計算は従来どおり(Googleは日本で自転車ルートに未対応のため)。
// Googleの規約に合わせ、地図データを保存(キャッシュ)しない。ロゴ・著作権表示はGoogle標準のものをそのまま出す。
(function (root) {
  function create(gm, opts) {
    const o = opts || {};
    const ll = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng !== undefined ? p.lng : p.lon });
    const arr = (pts) => pts.map(ll);

    // ---- 地図 ----
    function GMap(el, mopts) {
      const node = typeof el === 'string' ? document.getElementById(el) : el;
      this.g = new gm.Map(node, {
        center: { lat: 36.5, lng: 138 }, zoom: 5, mapId: o.mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, streetViewControl: false, fullscreenControl: false, gestureHandling: 'greedy',
        zoomControl: !mopts || mopts.zoomControl !== false, clickableIcons: false,
      });
      this._popup = null; this._handlers = {};
    }
    GMap.prototype.setView = function (c, z) { this.g.setCenter(ll(c)); if (z != null) this.g.setZoom(z); return this; };
    GMap.prototype.getCenter = function () { const c = this.g.getCenter(); return { lat: c.lat(), lng: c.lng() }; };
    GMap.prototype.getZoom = function () { return this.g.getZoom(); };
    GMap.prototype.fitBounds = function (b, f) {
      const pad = f && f.padding ? (Array.isArray(f.padding) ? Math.max(f.padding[0], f.padding[1]) : f.padding) : 0;
      this.g.fitBounds(b.g, pad);
      if (f && f.maxZoom) { const map = this.g; gm.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > f.maxZoom) map.setZoom(f.maxZoom); }); }
      return this;
    };
    GMap.prototype.closePopup = function () { if (this._popup) { this._popup.close(); this._popup = null; } return this; };
    GMap.prototype.on = function (ev, fn) {
      if (ev === 'click') this.g.addListener('click', (e) => { this.closePopup(); fn({ latlng: { lat: e.latLng.lat(), lng: e.latLng.lng() } }); });
      return this;
    };
    GMap.prototype._openInfo = function (iw, anchor) { this.closePopup(); this._popup = iw; if (anchor) iw.open({ map: this.g, anchor }); else iw.open({ map: this.g }); };

    // ---- 境界 ----
    function Bounds(points) { this.g = new gm.LatLngBounds(); (points || []).forEach((p) => this.g.extend(ll(p))); }
    Bounds.prototype.getCenter = function () { const c = this.g.getCenter(); return { lat: c.lat(), lng: c.lng() }; };
    Bounds.prototype.extend = function (p) { this.g.extend(ll(p)); return this; };

    // ---- 図形の共通部分 ----
    function Layer() { this._map = null; this._tip = null; this._pop = null; }
    Layer.prototype.addTo = function (target) {
      if (target instanceof Group) { target._add(this); } else { this._attach(target); }
      return this;
    };
    Layer.prototype.remove = function () { this._detach(); return this; };
    Layer.prototype.bindTooltip = function (text) { this._tip = text; this._wireTip(); return this; };
    Layer.prototype.bindPopup = function (content) { this._pop = content; this._wirePop(); return this; };
    Layer.prototype._wireTip = function () {
      if (this._tipWired || !this._events) return; this._tipWired = true;
      const self = this; let iw = null;
      this._events((add) => {
        add('mouseover', () => { if (!self._map || !self._tip) return; iw = iw || new gm.InfoWindow({ disableAutoPan: true }); const d = document.createElement('div'); d.textContent = self._tip; iw.setContent(d); self._openTip(iw); });
        add('mouseout', () => { if (iw) iw.close(); });
      });
    };
    Layer.prototype._wirePop = function () {
      if (this._popWired || !this._events) return; this._popWired = true;
      const self = this;
      this._events((add) => add('click', (e) => {
        if (!self._map || self._pop == null) return;
        const iw = new gm.InfoWindow({ content: typeof self._pop === 'string' ? (() => { const d = document.createElement('div'); d.innerHTML = self._pop; return d; })() : self._pop });
        if (e && e.latLng) iw.setPosition(e.latLng);
        self._map._openInfo(iw, e && e.latLng ? null : self._anchor && self._anchor());
      }));
    };

    // ---- 折れ線 ----
    function Polyline(pts, s) { Layer.call(this); this.pts = arr(pts); this.s = s || {}; this.g = null; }
    Polyline.prototype = Object.create(Layer.prototype);
    Polyline.prototype._build = function () {
      const s = this.s; const w = s.weight || 3, op = s.opacity != null ? s.opacity : 1, col = s.color || '#3388ff';
      const base = { path: this.pts, strokeColor: col, geodesic: false, clickable: true, zIndex: 1 };
      if (s.dashArray) {
        const n = String(s.dashArray).split(/[ ,]+/).map(Number); const dash = n[0] || 8, gap = n[1] || 6;
        return new gm.Polyline({ ...base, strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: op, strokeColor: col, strokeWeight: w, scale: dash / 2 }, offset: '0', repeat: (dash + gap) + 'px' }] });
      }
      return new gm.Polyline({ ...base, strokeOpacity: op, strokeWeight: w });
    };
    Polyline.prototype._attach = function (map) { this._map = map; if (!this.g) this.g = this._build(); this.g.setMap(map.g); };
    Polyline.prototype._detach = function () { if (this.g) this.g.setMap(null); this._map = null; };
    Polyline.prototype._events = function (cb) { const g = this.g || (this.g = this._build()); cb((ev, fn) => g.addListener(ev, fn)); };
    Polyline.prototype._openTip = function (iw) { const pts = this.pts; const m = pts[Math.floor(pts.length / 2)]; iw.setPosition(m); this._map._popupTip = iw; iw.open({ map: this._map.g }); };
    Polyline.prototype.getBounds = function () { return new Bounds(this.pts); };
    // 作成時に g が必要な bind 系のため、_attach 前でも _build 済みにする
    // ---- 円(メートル指定) ----
    function Circle(c, s) { Layer.call(this); this.c = ll(c); this.s = s || {}; this.g = null; }
    Circle.prototype = Object.create(Layer.prototype);
    Circle.prototype._build = function () { const s = this.s; return new gm.Circle({ center: this.c, radius: s.radius || 10, strokeColor: s.color || '#3388ff', strokeWeight: s.weight || 3, strokeOpacity: s.opacity != null ? s.opacity : 1, fillColor: s.fillColor || s.color || '#3388ff', fillOpacity: s.fillOpacity != null ? s.fillOpacity : 0.2, clickable: false }); };
    Circle.prototype._attach = function (map) { this._map = map; if (!this.g) this.g = this._build(); this.g.setMap(map.g); };
    Circle.prototype._detach = function () { if (this.g) this.g.setMap(null); this._map = null; };

    // ---- マーカー(HTML要素。ピクセル指定の丸も同じ仕組み) ----
    function Marker(p, s, kind) { Layer.call(this); this.pos = ll(p); this.s = s || {}; this.kind = kind || 'marker'; this.g = null; this._h = {}; }
    Marker.prototype = Object.create(Layer.prototype);
    Marker.prototype._content = function () {
      const el = document.createElement('div');
      if (this.kind === 'circle') {
        const s = this.s, r = (s.radius || 6) * 2;
        el.style.cssText = `width:${r}px;height:${r}px;border-radius:50%;box-sizing:border-box;border:${s.weight || 2}px solid ${s.color || '#fff'};background:${s.fillColor || '#17211F'};opacity:${s.fillOpacity != null ? Math.max(s.fillOpacity, 0.01) : 1};transform:translateY(50%);pointer-events:none`;
        return el;
      }
      const icon = this.s.icon;
      if (icon && icon.html) { el.innerHTML = icon.html; el.style.transform = 'translateY(50%)'; } else { el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#3388ff;border:2px solid #fff;transform:translateY(50%)'; }
      return el;
    };
    Marker.prototype._ensure = function () {
      if (this.g) return;
      this.g = new gm.marker.AdvancedMarkerElement({ position: this.pos, content: this._content(), gmpDraggable: !!this.s.draggable, gmpClickable: true });
      for (const [ev, fn] of Object.entries(this._h)) this._hook(ev, fn);
    };
    Marker.prototype._hook = function (ev, fn) {
      const self = this;
      if (ev === 'dragend') this.g.addListener('dragend', () => { const p = self.g.position; self.pos = { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }; fn(); });
      else this.g.addListener(ev, fn);
    };
    Marker.prototype.on = function (ev, fn) { this._h[ev] = fn; if (this.g) this._hook(ev, fn); return this; };
    Marker.prototype._attach = function (map) { this._map = map; this._ensure(); this.g.map = map.g; };
    Marker.prototype._detach = function () { if (this.g) this.g.map = null; this._map = null; };
    Marker.prototype.getLatLng = function () { return { lat: this.pos.lat, lng: this.pos.lng }; };
    Marker.prototype.setLatLng = function (p) { this.pos = ll(p); if (this.g) this.g.position = this.pos; return this; };
    Marker.prototype._events = function (cb) { this._ensure(); cb((ev, fn) => { if (ev === 'click') this.g.addListener('click', fn); else if (ev === 'mouseover') this.g.content.addEventListener('mouseenter', fn); else if (ev === 'mouseout') this.g.content.addEventListener('mouseleave', fn); }); };
    Marker.prototype._openTip = function (iw) { iw.open({ map: this._map.g, anchor: this.g }); };
    Marker.prototype._anchor = function () { return this.g; };

    // ---- 吹き出し ----
    function Popup() { this._pos = null; this._content = null; }
    Popup.prototype.setLatLng = function (p) { this._pos = ll(p); return this; };
    Popup.prototype.setContent = function (c) { this._content = c; return this; };
    Popup.prototype.openOn = function (map) {
      const c = typeof this._content === 'string' ? (() => { const d = document.createElement('div'); d.innerHTML = this._content; return d; })() : this._content;
      const iw = new gm.InfoWindow({ content: c, position: this._pos });
      map._openInfo(iw, null); return this;
    };

    // ---- グループ ----
    function Group() { Layer.call(this); this.items = []; }
    Group.prototype = Object.create(Layer.prototype);
    Group.prototype._add = function (l) { this.items.push(l); if (this._map) l._attach(this._map); };
    Group.prototype.addLayer = function (l) { this._add(l); return this; };
    Group.prototype._attach = function (map) { this._map = map; this.items.forEach((l) => l._attach(map)); };
    Group.prototype._detach = function () { this.items.forEach((l) => l._detach()); this._map = null; };
    Group.prototype.clearLayers = function () { this.items.forEach((l) => l._detach()); this.items = []; return this; };

    const stub = { addTo() { return this; } };
    return {
      map: (el, s) => new GMap(el, s),
      polyline: (p, s) => new Polyline(p, s),
      circle: (p, s) => new Circle(p, s),
      circleMarker: (p, s) => new Marker(p, s, 'circle'),
      marker: (p, s) => new Marker(p, s),
      divIcon: (s) => s,
      popup: () => new Popup(),
      layerGroup: () => new Group(),
      latLngBounds: (pts) => new Bounds(pts),
      // 地理院タイルの切り替えは Googleモードでは使わない(Google標準の地図/航空写真ボタンを使う)
      tileLayer: () => ({ addTo() { return this; } }),
      control: { layers: () => ({ addTo() { return this; } }) },
      _kind: 'google', _stub: stub,
    };
  }

  // Googleのスクリプトを読み込む(失敗・タイムアウト・キー不正のとき reject)
  function load(key, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (root.google && root.google.maps && root.google.maps.marker) return resolve(root.google.maps);
      const t = setTimeout(() => reject(new Error('Googleマップの読み込みがタイムアウトしました')), timeoutMs || 10000);
      root.gm_authFailure = () => { root.__gmAuthFailed = true; if (root.__onGmAuthFail) root.__onGmAuthFail(); };
      root.__gmReady = async () => {
        try { await root.google.maps.importLibrary('maps'); await root.google.maps.importLibrary('marker'); clearTimeout(t); resolve(root.google.maps); } catch (e) { clearTimeout(t); reject(e); }
      };
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=quarterly&loading=async&language=ja&region=JP&callback=__gmReady';
      s.async = true; s.onerror = () => { clearTimeout(t); reject(new Error('Googleマップのスクリプトを読み込めません')); };
      document.head.appendChild(s);
    });
  }

  const api = { create, load };
  if (typeof module !== 'undefined') module.exports = api; else root.GMShim = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
