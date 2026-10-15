// 偽の google.maps(呼び出しを記録するだけ)
(function(){
const log=[];window.__glog=log;
class LL{constructor(la,lo){this._la=la;this._lo=lo}lat(){return this._la}lng(){return this._lo}toJSON(){return{lat:this._la,lng:this._lo}}}
const L=(p)=>p instanceof LL?p:new LL(p.lat,p.lng);
class Evt{constructor(){this.h={}}addListener(e,f){(this.h[e]=this.h[e]||[]).push(f);return{remove(){}}}fire(e,a){(this.h[e]||[]).forEach(f=>f(a))}}
class Map extends Evt{constructor(el,o){super();this.o=o;this.c=o.center;this.z=o.zoom;log.push(['Map',o.mapId,o.mapTypeControl,o.renderingType]);window.__fakeMap=this;el.setAttribute('data-gm','1')}
 setCenter(c){this.c=c;log.push(['setCenter',c])}setZoom(z){this.z=z;log.push(['setZoom',z])}getCenter(){return new LL(this.c.lat,this.c.lng)}getZoom(){return this.z}
 fitBounds(b,p){log.push(['fitBounds',p]);this.z=14}
 click(la,lo){this.fire('click',{latLng:new LL(la,lo)})}}
class Bounds{constructor(){this.pts=[]}extend(p){this.pts.push(p)}getCenter(){const a=this.pts;return new LL(a.reduce((s,p)=>s+p.lat,0)/a.length,a.reduce((s,p)=>s+p.lng,0)/a.length)}}
class Poly extends Evt{constructor(o){super();this.o=o;log.push(['Polyline',o.path.length,o.strokeOpacity,!!o.icons,o.strokeWeight])}setMap(m){this.m=m;log.push(['poly.setMap',!!m])}}
class Circ extends Evt{constructor(o){super();this.o=o;log.push(['Circle',o.radius])}setMap(m){this.m=m;log.push(['circ.setMap',!!m])}}
class IW extends Evt{constructor(o){super();this.o=o||{};this.content=o&&o.content}setContent(c){this.content=c}setPosition(p){this.pos=p}setOptions(o){this.opts=o}open(a){log.push(['iw.open',!!(a&&a.anchor)]);this.opened=true;window.__lastIW=this}close(){this.opened=false;log.push(['iw.close'])}}
class OV{constructor(){log.push(['OV'])}
 setMap(m){const had=this._m;this._m=m;log.push(['ov.setMap',!!m]);if(m&&!had){const root=document.getElementById('map')||document.body;this._panes={overlayMouseTarget:document.createElement('div'),overlayLayer:document.createElement('div')};root.appendChild(this._panes.overlayLayer);root.appendChild(this._panes.overlayMouseTarget);(window.__ov=window.__ov||[]).push(this);this.onAdd&&this.onAdd();this.draw&&this.draw()}else if(!m&&had){this.onRemove&&this.onRemove()}}
 getPanes(){return this._panes}
 getProjection(){return{fromLatLngToDivPixel:(l)=>({x:(l.lng()-139)*1000,y:(36-l.lat())*1000}),fromDivPixelToLatLng:(pt)=>new LL(36-pt.y/1000,139+pt.x/1000)}}}
class Pt{constructor(x,y){this.x=x;this.y=y}}
class Sz{constructor(w,h){this.w=w;this.h=h}}
window.google={maps:{Map,LatLngBounds:Bounds,Polyline:Poly,Circle:Circ,InfoWindow:IW,event:{addListenerOnce(m,e,f){f()}},OverlayView:OV,LatLng:LL,Point:Pt,Size:Sz,RenderingType:{RASTER:'RASTER',VECTOR:'VECTOR'},importLibrary:async(n)=>n==='geocoding'?{Geocoder:class{async geocode(req){return (window.__geocodeFake||(()=>({results:[]})))(req)}}}:({})}};
setTimeout(()=>window.__gmReady&&window.__gmReady(),10);
})();
