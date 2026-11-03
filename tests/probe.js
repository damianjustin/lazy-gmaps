// lazy-gmaps.js v3 suite: headless Chrome, mocked Maps JS, Static Maps and Embed endpoints.
const { chromium } = require("playwright");
const fs = require("fs");
const WRAPPER = fs.readFileSync(process.argv[2], "utf8");
const ONLY = process.argv[3] || "";
const UA = {
  human: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  bot: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const MOCK_API = `(function(){
  window.__scriptRuns=(window.__scriptRuns||0)+1;
  var cb=new URL(document.currentScript.src).searchParams.get('callback');
  var m=(window.google=window.google||{}).maps=window.google.maps||{};
  function Ev(){this.h={};} Ev.prototype.addListener=function(n,f){(this.h[n]=this.h[n]||[]).push(f);return{remove:function(){}}};
  Ev.prototype.fire=function(n){var s=this;(this.h[n]||[]).forEach(function(f){f.call(s,{})});};
  function Map(el,o){Ev.call(this);this.o=o;this.el=el;var host=el.closest('[data-gmap]')||el;
    window.__maps=(window.__maps||[]).concat({id:host.id,center:o.center,zoom:o.zoom,mapId:o.mapId||null,styles:o.styles||null,opts:o});
    window.__mapObjs=(window.__mapObjs||[]).concat(this);el.setAttribute('data-mock-map','1');var self=this;setTimeout(function(){self.fire('idle')},30);}
  Map.prototype=Object.create(Ev.prototype);
  Map.prototype.fitBounds=function(b){this.fitted=b.n};Map.prototype.setOptions=function(o){this.set=o};
  function Marker(o){Ev.call(this);for(var k in o)if(!(k in this))this[k]=o[k];
    window.__markers=(window.__markers||[]).concat({kind:'legacy',icon:o.icon||null,title:o.title,host:o.map&&o.map.el&&(o.map.el.closest('[data-gmap]')||{}).id});window.__lastMarker=this;}
  Marker.prototype=Object.create(Ev.prototype);
  function AdvancedMarkerElement(o){Ev.call(this);window.__markers=(window.__markers||[]).concat({kind:'advanced',img:o.content?o.content.src:null,size:o.content?[o.content.width,o.content.height]:null,title:o.title,host:o.map&&(o.map.el.closest('[data-gmap]')||{}).id});window.__lastMarker=this;}
  AdvancedMarkerElement.prototype=Object.create(Ev.prototype);
  function InfoWindow(o){o=o||{};this.o=o;window.__info=(window.__info||[]).concat({html:o.content?o.content.innerHTML:'',text:o.content?o.content.textContent:''});}
  InfoWindow.prototype.open=function(){window.__infoOpened=(window.__infoOpened||0)+1;};InfoWindow.prototype.setContent=function(){};
  function LatLngBounds(){this.n=0} LatLngBounds.prototype.extend=function(){this.n++};
  function Size(w,h){this.width=w;this.height=h}
  m.event={addListenerOnce:function(obj,n,f){obj.addListener(n,f)},addListener:function(o,n,f){return o.addListener(n,f)}};
  var IMPORT=function(n){
    window.__libs=(window.__libs||[]).concat(n);
    if(n==='maps'){m.Map=Map;m.InfoWindow=InfoWindow;m.LatLngBounds=LatLngBounds;m.Size=Size;}
    if(n==='marker'){m.Marker=Marker;m.marker={AdvancedMarkerElement:AdvancedMarkerElement};}
    return Promise.resolve({});
  };
  if (window.__legacyNoImport) { IMPORT('maps'); IMPORT('marker'); } else m.importLibrary=IMPORT;
  if (cb) cb.split('.').reduce(function(o,k){return o[k];},window)();
  if (window.__authFail) setTimeout(function(){ window.gm_authFailure && window.gm_authFailure(); }, 20);
})();`;

function page({ body, cfg = "{key:'KEY'}", head = "", tail = "", twice = false }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>.map{height:300px;width:600px} .spacer{height:3000px}</style>
<script>window.lazyGMapsConfig=${cfg};</script>
<script src="https://site.test/lazy-gmaps.js" defer></script>${twice ? '<script src="https://site.test/lazy-gmaps.js?2" defer></script>' : ""}${head}
</head><body>${body}
<script>window.calls=[];
  function addMarkers(map, ctx){ calls.push('addMarkers:'+ctx.el.id+':'+ctx.options.zoom); new google.maps.Marker({map:map, position:{lat:0,lng:0}}); }
  function addOverlay(map, ctx){ calls.push('addOverlay:'+ctx.el.id); map.setOptions({ gestureHandling: 'none' }); }
  function badInit(map){ calls.push('badInit'); throw new Error('oops'); }
</script>${tail}
</body></html>`;
}

let failed = 0, total = 0;
async function run(browser, name, opts, steps) {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = await browser.newContext({ userAgent: opts.ua || UA.human, viewport: opts.viewport || { width: 1280, height: 800 } });
  if (!opts.webdriver) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  if (opts.init) await ctx.addInitScript(opts.init);
  const n = { script: 0, staticReq: [], embedReq: [], scriptUrls: [] };
  const logs = [];
  let failFirst = !!opts.failFirstScript;
  await ctx.route("https://site.test/**", (r) => r.request().url().includes("lazy-gmaps.js")
    ? r.fulfill({ contentType: "text/javascript", body: WRAPPER })
    : r.request().url().endsWith(".png") ? r.fulfill({ contentType: "image/png", body: PNG })
    : r.fulfill({ contentType: "text/html", body: page(opts.page) }));
  await ctx.route(/https:\/\/maps\.(googleapis|google)\.com\/maps\/api\/js.*/, async (r) => {
    n.script++; n.scriptUrls.push(r.request().url());
    if (opts.blockScript || failFirst) { failFirst = false; return r.abort(); }
    if (opts.scriptDelay) await new Promise((res) => setTimeout(res, opts.scriptDelay));
    return r.fulfill({ contentType: "text/javascript", body: opts.mapsBody !== undefined ? opts.mapsBody : MOCK_API });
  });
  await ctx.route("https://maps.googleapis.com/maps/api/staticmap**", (r) => { n.staticReq.push(r.request().url()); return r.fulfill({ contentType: "image/png", body: PNG }); });
  await ctx.route("https://www.google.com/maps/embed/**", (r) => { n.embedReq.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<p>embed</p>" }); });
  await ctx.route("https://cdn.example.com/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
  p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await p.goto("https://site.test/page.html");
  await p.waitForTimeout(opts.wait || 400);
  const snap = () => p.evaluate(() => ({
    maps: window.__maps || [], markers: window.__markers || [], info: window.__info || [], calls: window.calls || [],
    states: [...document.querySelectorAll("[data-gmap]")].map((e) => (e.id || "?") + "=" + e.getAttribute("data-gmap-state")),
    placeholders: document.querySelectorAll("[data-gmap-placeholder]").length,
  }));
  const results = [];
  const check = (label, ok, info) => results.push({ label, ok: !!ok, info });
  try { await steps(p, snap, check, n, logs); } catch (e) { check("threw: " + e.message, false); }
  await ctx.close();
  const bad = results.filter((r) => !r.ok);
  total++; if (bad.length) failed++;
  console.log(`${bad.length ? "FAIL" : "PASS"}  ${name}`);
  bad.forEach((r) => console.log("      ✗", r.label, JSON.stringify(r.info === undefined ? null : r.info).slice(0, 700)));
}
const scrollTo = (p, id) => p.evaluate((id) => document.getElementById(id).scrollIntoView(), id).then(() => p.waitForTimeout(400));
const q = (url, k) => new URL(url || "https://x/").searchParams.get(k);
const D = (id, extra = "") => `<div id="${id}" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="-31.9523" data-gmap-lng="115.8613" ${extra}></div>`;

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });

  const E = (id, extra = "") => `<div id="${id}" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2" ${extra}></div>`;
  await run(b, "P-A update() while embed is loading is lost", {
    page: { body: E("e1"), tail: `<script>document.addEventListener('gmap:loading', function(e){ var t=e.target; queueMicrotask(function(){ LazyGMaps.update(t,{lat:5,lng:6}); }); });</script>` } },
    async (p, snap, check, n) => {
      const src = await p.$eval("#e1 iframe", (f) => f.src);
      check("iframe uses updated coords", q(src, "center") === "5,6", { src, opts: await p.evaluate(() => LazyGMaps.options(document.getElementById('e1')).lat) });
    });
  await run(b, "P-B load() in a later deferred script (before start) on click map", {
    page: { body: D("d1", `data-gmap-trigger="click" data-gmap-preview="none"`), tail: `<script type="module">window.__lp = LazyGMaps.load(document.getElementById('d1'));</script>` } },
    async (p, snap, check, n) => { const s = await snap(); check("map built by load()", s.maps.length === 1, s); });
  await run(b, "P-C per-map data-gmap-options styles vs config styles", {
    page: { cfg: `{key:'KEY', styles:{default:[{featureType:'poi',stylers:[{visibility:'off'}]}]}}`, body: D("d1", `data-gmap-options='{"styles":[{"stylers":[{"saturation":-100}]}]}'`) } },
    async (p, snap, check, n) => { const s = await snap(); check("per-map styles win", JSON.stringify(s.maps[0].styles).includes("saturation"), s.maps[0].styles); });
  await run(b, "P-D config pushed after start, then scan() → applied to the new map, one warning", {
    page: { body: `<div id="slot"></div>`, tail: `<script>window.addEventListener('load',function(){ (window.lazyGMapsConfig=[].concat(window.lazyGMapsConfig)).push({styles:{default:[{stylers:[{saturation:1}]}]}}); document.getElementById('slot').innerHTML='<div id="d1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="1" data-gmap-lng="2"></div>'; LazyGMaps.scan(document.getElementById('slot')); });</script>` } },
    async (p, snap, check, n, logs) => {
      await p.waitForTimeout(300); const s = await snap();
      check("late styles applied", s.maps[0] && JSON.stringify(s.maps[0].styles).includes("saturation"), s);
      check("warned once", logs.filter((l) => l.includes("configuration was added after")).length === 1, logs);
    });
  await run(b, "P-E click+preview none with server fallback (no data-gmap-load) → user has a way to load", {
    page: { body: `<div id="d1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-trigger="click" data-gmap-preview="none" data-gmap-lat="1" data-gmap-lng="2"><a data-gmap-placeholder href="https://www.google.com/maps">Open</a></div>` } },
    async (p, snap, check, n) => { check("a load control exists", await p.$("#d1 [data-gmap-load]"), await snap()); });
  await run(b, "P-F existing tag fails to load → foreignReady polling stops", {
    blockScript: true, init: () => { const st = window.setTimeout; window.__polls = 0; window.setTimeout = function (f, ms) { if (ms === 50) window.__polls++; return st.apply(this, arguments); }; },
    page: { cfg: `{key:'KEY', timeout: 500}`, head: `<script async src="https://maps.googleapis.com/maps/api/js?key=K"></script>`, body: D("d1") }, wait: 1000 },
    async (p, snap, check, n) => {
      const a = await p.evaluate(() => window.__polls); await p.waitForTimeout(1500); const b2 = await p.evaluate(() => window.__polls);
      check("polling stopped after error", b2 === a, { a, b2, s: (await snap()).states });
    });
  await run(b, "P-H destroy() then click on server data-gmap-load button → rebuilt?", {
    page: { body: `<div id="d1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="1" data-gmap-lng="2"><button data-gmap-load>Load</button></div>` } },
    async (p, snap, check, n) => {
      // map auto-built; server button removed? it's not a placeholder, so kept
      await p.evaluate(() => LazyGMaps.destroy(document.getElementById('d1')));
      await p.click("#d1 [data-gmap-load]", { force: true }); await p.waitForTimeout(300);
      const s = await snap(); check("destroyed container stays destroyed", s.maps.length === 1, s);
    });
  await run(b, "P-I destroy() before start does not cancel setup", {
    page: { body: D("d1"), tail: `<script type="module">LazyGMaps.destroy(document.getElementById('d1'));</script>` } },
    async (p, snap, check, n) => { const s = await snap(); check("no map after destroy", s.maps.length === 0, s); });
  await run(b, "P-J ready() for a map destroyed while loading", {
    scriptDelay: 300, page: { body: D("d1") }, wait: 50 },
    async (p, snap, check, n) => {
      const r = await p.evaluate(() => { const el = document.getElementById('d1'); const pr = LazyGMaps.ready(el).then(() => 'resolved'); LazyGMaps.destroy(el); return Promise.race([pr, new Promise((r) => setTimeout(() => r('pending'), 1000))]); });
      check("ready settles", r !== 'pending', r);
    });
  await b.close();
  console.log(`\n${total - failed}/${total} scenarios passed`);
})();
