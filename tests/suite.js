// lazy-gmaps.js suite: headless Chrome against a mocked Maps JavaScript API.
// Usage: node tests/suite.js lazy-gmaps.js ["name filter"]
const { chromium } = require("playwright");
const fs = require("fs");
const LIB = fs.readFileSync(process.argv[2], "utf8");
const ONLY = process.argv[3] || "";
const HUMAN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const BOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Records every map, marker and popup in window.__maps / __markers / __info.
const MOCK_API = `(function(){
    var cb=new URL(document.currentScript.src).searchParams.get('callback');
    var m=(window.google=window.google||{}).maps=window.google.maps||{};
    function Ev(){this.h={};} Ev.prototype.addListener=function(n,f){(this.h[n]=this.h[n]||[]).push(f);return{remove:function(){}}};
    Ev.prototype.fire=function(n){var s=this;(this.h[n]||[]).forEach(function(f){f.call(s,{})});};
    function Map(el,o){Ev.call(this);this.o=o;this.el=el;var host=el.closest('[data-gmap]')||el;
        window.__maps=(window.__maps||[]).concat({id:host.id,center:o.center,zoom:o.zoom,mapId:o.mapId||null,styles:o.styles||null,opts:o});
        window.__mapObjs=(window.__mapObjs||[]).concat(this);var self=this;setTimeout(function(){self.fire('idle')},30);}
    Map.prototype=Object.create(Ev.prototype);
    Map.prototype.fitBounds=function(b){this.fitted=b.n};Map.prototype.setOptions=function(o){this.set=o};
    function Marker(o){Ev.call(this);this.o=o;
        window.__markers=(window.__markers||[]).concat({kind:'legacy',icon:o.icon||null,title:o.title,host:o.map&&(o.map.el.closest('[data-gmap]')||{}).id});}
    Marker.prototype=Object.create(Ev.prototype);Marker.prototype.setMap=function(m){this.removed=!m;window.__removed=(window.__removed||0)+1};
    function AdvancedMarkerElement(o){Ev.call(this);
        window.__markers=(window.__markers||[]).concat({kind:'advanced',img:o.content?o.content.src:null,size:o.content?[o.content.width,o.content.height]:null,title:o.title,host:o.map&&(o.map.el.closest('[data-gmap]')||{}).id});}
    AdvancedMarkerElement.prototype=Object.create(Ev.prototype);
    AdvancedMarkerElement.prototype.addListener=function(n,f){window.__advAddListener=1;return Ev.prototype.addListener.call(this,n,f)};   // Google warns: use gmp- events
    AdvancedMarkerElement.prototype.addEventListener=function(n,f){(this.h[n]=this.h[n]||[]).push(f)};
    function InfoWindow(o){var c=(o||{}).content;window.__info=(window.__info||[]).concat({html:c?c.innerHTML:'',text:c?c.textContent:''});}
    InfoWindow.prototype.open=function(){window.__infoOpened=(window.__infoOpened||0)+1;};InfoWindow.prototype.close=function(){};
    function LatLngBounds(){this.n=0} LatLngBounds.prototype.extend=function(){this.n++};
    function Size(w,h){this.width=w;this.height=h}
    m.event={addListenerOnce:function(o,n,f){o.addListener(n,f)},addListener:function(o,n,f){return o.addListener(n,f)},
        clearInstanceListeners:function(){window.__cleared=(window.__cleared||0)+1}};
    m.importLibrary=function(n){
        window.__libs=(window.__libs||[]).concat(n);
        if(n==='maps'){m.Map=Map;m.InfoWindow=InfoWindow;m.LatLngBounds=LatLngBounds;m.Size=Size;}
        if(n==='marker'){m.Marker=Marker;m.marker={AdvancedMarkerElement:AdvancedMarkerElement};}
        return Promise.resolve({});
    };
    if (cb) cb.split('.').reduce(function(o,k){return o[k];},window)();
    if (window.__authFail) setTimeout(function(){ window.gm_authFailure(); }, 20);
})();`;

const SCRIPT = `<script src="/lazy-gmaps.js" defer></script>`;
const page = ({ cfg = "{key:'KEY'}", head = SCRIPT, body = "", tail = "" }) => `<!doctype html><html><head><meta charset="utf-8">
<style>.map{height:300px;width:600px}.spacer{height:3000px}</style>
<script>window.lazyGMapsConfig=${cfg};</script>${head}
</head><body>${body}
<script>window.calls=[];
    function addMarkers(map, ctx){ calls.push('addMarkers:'+ctx.el.id+':'+ctx.options.zoom+':'+!!ctx.marker); }
    var Site={maps:{init:function(map,ctx){ calls.push('dotted:'+ctx.el.id); return new Promise(function(r){ setTimeout(r,50); }); }}};
    function badInit(){ calls.push('badInit'); throw new Error('oops'); }
    function rejects(){ return Promise.reject(new Error('later')); }
</script>${tail}
</body></html>`;
const M = (id, extra = "") => `<div id="${id}" class="map" data-gmap data-gmap-lat="-31.95" data-gmap-lng="115.86" ${extra}></div>`;
const SPACER = `<div class="spacer"></div>`;

let failed = 0, total = 0;
async function run(browser, name, opts, steps) {
    if (ONLY && !name.includes(ONLY)) return;
    const ctx = await browser.newContext({ userAgent: opts.ua || HUMAN, viewport: opts.viewport || { width: 1280, height: 800 }, colorScheme: opts.colorScheme || "light" });
    if (!opts.webdriver) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
    if (opts.init) await ctx.addInitScript(opts.init);
    const n = { script: 0, urls: [] }, logs = [];
    const files = { "/lazy-gmaps.js": LIB, ...opts.files };
    await ctx.route("https://site.test/**", async (r) => {
        const path = new URL(r.request().url()).pathname;
        if (files[path] === undefined) return r.fulfill({ contentType: "text/html", body: page(opts) });
        if (opts.delays?.[path]) await new Promise((res) => setTimeout(res, opts.delays[path]));
        return r.fulfill({ contentType: "text/javascript", body: files[path] });
    });
    await ctx.route(/https:\/\/maps\.(googleapis|google)\.com\/maps\/api\/js.*/, async (r) => {
        n.script++; n.urls.push(r.request().url());
        if (opts.failScript) return r.abort();
        if (opts.scriptDelay) await new Promise((res) => setTimeout(res, opts.scriptDelay));
        return r.fulfill({ contentType: "text/javascript", body: opts.mapsBody ?? MOCK_API });
    });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
    p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
    await p.goto("https://site.test/page.html");
    await p.waitForTimeout(opts.wait || 400);
    if (!opts.midLoad) await p.waitForFunction(() => !document.querySelector('[data-gmap-state="loading"]'), null, { timeout: 3000 }).catch(() => {});
    const snap = () => p.evaluate(() => ({
        maps: window.__maps || [], markers: window.__markers || [], info: window.__info || [], calls: window.calls || [], libs: window.__libs || [],
        states: [...document.querySelectorAll("[data-gmap]")].map((e) => (e.id || "?") + "=" + e.getAttribute("data-gmap-state")),
        links: [...document.querySelectorAll(".lgm-fallback a")].map((a) => a.closest("[data-gmap]").id),
    }));
    const results = [];
    const check = (label, ok, info) => results.push({ label, ok: !!ok, info });
    try { await steps(p, snap, check, n, logs); } catch (e) { check("threw: " + e.message, false); }
    await ctx.close();
    const bad = results.filter((r) => !r.ok);
    total++; if (bad.length) failed++;
    console.log(`${bad.length ? "FAIL" : "PASS"}  ${name}`);
    bad.forEach((r) => console.log("      ✗", r.label, JSON.stringify(r.info ?? null).slice(0, 700)));
}
const scrollTo = (p, id) => p.evaluate((id) => document.getElementById(id).scrollIntoView(), id).then(() => p.waitForTimeout(400));
const has = (logs, text) => logs.filter((l) => l.includes(text)).length;

(async () => {
    const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });

    // ================= basics =================
    await run(b, "basic: map near the viewport is built with centre, zoom and marker; link removed", {
        body: M("a", `data-gmap-zoom="12" data-gmap-title="Office"`) },
        async (p, snap, check, n, logs) => {
            const s = await snap(), m = s.maps[0];
            check("one map", s.maps.length === 1 && m.center.lat === -31.95 && m.center.lng === 115.86 && m.zoom === 12, s.maps);
            check("legacy marker with title", s.markers.length === 1 && s.markers[0].kind === "legacy" && s.markers[0].title === "Office", s.markers);
            check("ready, link gone", s.states.join() === "a=ready" && s.links.length === 0, s);
            check("one script with key, v and our callback", n.script === 1 && /key=KEY/.test(n.urls[0]) && /v=weekly/.test(n.urls[0]) && /callback=google.maps.__ib__/.test(n.urls[0]), n);
            check("libraries maps + marker", s.libs.join() === "maps,marker", s.libs);
            check("canvas visible", (await p.$eval("#a .lgm-canvas", (c) => getComputedStyle(c).opacity)) === "1");
            check("no console noise", logs.length === 0, logs);
        });
    await run(b, "basic: map below the fold waits for scrolling; no script until then", { body: SPACER + M("a") },
        async (p, snap, check, n) => {
            let s = await snap();
            check("waiting with a link", s.states.join() === "a=waiting" && s.links.join() === "a" && n.script === 0, { s, n });
            check("link to Google Maps", (await p.$eval("#a a", (a) => a.href + "|" + a.target + "|" + a.textContent)) ===
                "https://www.google.com/maps/search/?api=1&query=-31.95,115.86|_blank|Open in Google Maps");
            await scrollTo(p, "a"); s = await snap();
            check("built on scroll", s.maps.length === 1 && s.states.join() === "a=ready" && n.script === 1, { s, n });
        });
    await run(b, "basic: two maps share one script; each built once", { body: M("a") + M("b") },
        async (p, snap, check, n) => {
            await p.evaluate(() => { LazyGMaps.load(a); LazyGMaps.load(b); window.scrollBy(0, 5); });
            await p.waitForTimeout(300); const s = await snap();
            check("two maps, one script", s.maps.length === 2 && n.script === 1, { s, n });
        });
    await run(b, "basic: server-rendered content is kept instead of the link", {
        body: `<div id="a" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"><p id="srv">Our office</p></div>` },
        async (p, snap, check) => {
            const s = await snap();
            check("no link added, content kept, map built", s.links.length === 0 && (await p.$("#srv")) && s.maps.length === 1, s);
        });
    await run(b, "basic: missing lat/lng → error invalid, console error, nothing loaded", { body: `<div id="a" class="map" data-gmap data-gmap-lat="1"></div>` + M("b") },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("states", s.states.join() === "a=error,b=ready" && s.maps.length === 1 && s.links.length === 0, s);
            check("explained", has(logs, "data-gmap-lat and data-gmap-lng are required") === 1, logs);
            check("reason", (await p.evaluate(() => new Promise((r) => { const d = document.createElement("div"); d.setAttribute("data-gmap", "");
                d.addEventListener("gmap:error", (e) => r(e.detail.reason)); document.body.append(d); LazyGMaps.scan(d); }))) === "invalid");
        });
    await run(b, "basic: zero height warns; hidden parent does not", {
        body: `<div id="a" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div><div style="display:none"><div id="b" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div></div>` },
        async (p, snap, check, n, logs) => { check("one warning", has(logs, "has no height") === 1, logs); });

    // ================= markers and popups =================
    await run(b, "marker: Map ID → advanced marker with sized image; styles dropped", {
        cfg: "{key:'K', marker:'https://cdn.example.com/pin.png', markerSize:'24x33', styles:[{stylers:[{hue:'#f00'}]}]}",
        body: M("a", `data-gmap-map-id="ABC"`) },
        async (p, snap, check) => {
            const s = await snap();
            check("mapId, no styles", s.maps[0].mapId === "ABC" && !s.maps[0].styles, s.maps);
            check("advanced marker", s.markers[0].kind === "advanced" && s.markers[0].img === "https://cdn.example.com/pin.png" && s.markers[0].size.join() === "24,33", s.markers);
        });
    await run(b, "marker: advanced marker popup opens on gmp-click", {
        body: M("a", `data-gmap-map-id="ABC" data-gmap-popup="Hi"`) },
        async (p, snap, check) => {
            const r = await p.evaluate(() => { const m = LazyGMaps.get(document.getElementById("a")).marker; (m.h["gmp-click"] || []).forEach((f) => f()); return { opened: window.__infoOpened, legacy: window.__advAddListener || 0 }; });
            check("opened by gmp-click, no addListener", r.opened === 1 && r.legacy === 0, r);
        });
    await run(b, "marker: no Map ID → legacy marker scaled; per-map icon and size", {
        body: M("a", `data-gmap-marker="/pin.png" data-gmap-marker-size="40"`) },
        async (p, snap, check) => {
            const i = (await snap()).markers[0].icon;
            check("scaled icon", i.url === "/pin.png" && i.scaledSize.width === 40 && i.scaledSize.height === 40, i);
        });
    await run(b, "marker: none / init (off by default) / init + show / init + popup", {
        cfg: "{key:'K', marker:'/cfg.png'}",
        body: M("a", `data-gmap-marker="none"`) + M("b", `data-gmap-init="addMarkers"`) + M("c", `data-gmap-init="addMarkers" data-gmap-marker="SHOW"`) + M("d", `data-gmap-init="addMarkers" data-gmap-popup="Hi"`) },
        async (p, snap, check) => {
            const s = await snap();
            check("markers only on c and d", s.markers.map((m) => m.host).join() === "c,d" && s.markers[0].icon === "/cfg.png", s.markers);
            check("init sees marker", s.calls.join() === "addMarkers:b:15:false,addMarkers:c:15:true,addMarkers:d:15:true", s.calls);
        });
    await run(b, "popup: text only (never HTML), opens on click and with popup-open", {
        body: M("a", `data-gmap-popup="<b>Hi</b>"`) + M("b", `data-gmap-popup="Open" data-gmap-popup-open`) },
        async (p, snap, check) => {
            const s = await snap();
            check("escaped", s.info[0].text === "<b>Hi</b>" && s.info[0].html === "&lt;b&gt;Hi&lt;/b&gt;", s.info);
            check("popup-open opened once", (await p.evaluate(() => window.__infoOpened)) === 1);
            await p.evaluate(() => LazyGMaps.get(a).marker.fire("click"));
            check("click opens", (await p.evaluate(() => window.__infoOpened)) === 2);
        });

    // ================= init functions =================
    await run(b, "init: global and dotted path; async init finishes before ready", {
        body: M("a", `data-gmap-init="addMarkers" data-gmap-zoom="9"`) + M("b", `data-gmap-init="Site.maps.init"`) },
        async (p, snap, check) => {
            const s = await snap();
            check("called with ctx", s.calls.join() === "addMarkers:a:9:false,dotted:b", s.calls);
            check("ready", s.states.join() === "a=ready,b=ready", s.states);
            check("ctx.options is the read attributes", await p.evaluate(() => LazyGMaps.ready(a).then((i) => !!i.map)));
        });
    await run(b, "init: missing, throwing or rejecting → base map kept, ready, console error", {
        body: M("a", `data-gmap-init="nope"`) + M("b", `data-gmap-init="badInit"`) + M("c", `data-gmap-init="rejects"`) },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("three maps, all ready", s.maps.length === 3 && s.states.join() === "a=ready,b=ready,c=ready", s);
            check("explained", has(logs, '"nope" not found') === 1 && has(logs, '"badInit" failed') === 1 && has(logs, '"rejects" failed') === 1, logs);
        });
    await run(b, "init: defined in a later deferred script → called", {
        body: M("a", `data-gmap-init="lateInit"`), tail: `<script src="/late.js" defer></script>`,
        files: { "/late.js": "window.lateInit = function(){ calls.push('late'); };" }, delays: { "/late.js": 300 }, wait: 800 },
        async (p, snap, check) => { check("called", (await snap()).calls.join() === "late"); });

    // ================= options, styles, dark mode =================
    await run(b, "options: data-gmap-options over config mapOptions; bad JSON ignored with an error", {
        cfg: "{key:'K', mapOptions:{disableDefaultUI:true, gestureHandling:'cooperative'}}",
        body: M("a", `data-gmap-options='{"gestureHandling":"greedy"}'`) + M("b", `data-gmap-options="{bad}"`) },
        async (p, snap, check, n, logs) => {
            const [a, b] = (await snap()).maps.map((m) => m.opts);
            check("merged", a.disableDefaultUI === true && a.gestureHandling === "greedy" && b.gestureHandling === "cooperative", [a, b]);
            check("error", has(logs, "data-gmap-options is not a JSON object") === 1, logs);
        });
    await run(b, "styles: named sets, dark pairs in dark mode, unknown name → default", { colorScheme: "dark",
        cfg: "{key:'K', styles:{default:['L'], 'default/dark':['D'], brand:['B']}}",
        body: M("a") + M("b", `data-gmap-style="brand"`) + M("c", `data-gmap-style="nope"`) },
        async (p, snap, check, n, logs) => {
            const st = (await snap()).maps.map((m) => (m.styles || []).join());
            check("D, B, D", st.join("|") === "D|B|D", st);
            check("unknown explained", has(logs, 'no style set "nope"') === 1, logs);
        });
    await run(b, "styles: light mode and darkMode:false use light sets; array applies to all", {
        cfg: "{key:'K', darkMode:false, styles:{default:['L'], 'default/dark':['D']}}", colorScheme: "dark", body: M("a") },
        async (p, snap, check) => { check("L, no colorScheme", (await snap()).maps.map((m) => m.styles.join() + m.opts.colorScheme).join() === "Lundefined"); });
    await run(b, "dark: unstyled maps follow the system; Map ID and mapOptions.colorScheme respected", {
        body: M("a") + M("b", `data-gmap-map-id="X"`) + M("c", `data-gmap-options='{"colorScheme":"LIGHT"}'`) },
        async (p, snap, check) => {
            const cs = (await snap()).maps.map((m) => String(m.opts.colorScheme));
            check("FOLLOW_SYSTEM, none, LIGHT", cs.join() === "FOLLOW_SYSTEM,undefined,LIGHT", cs);
        });
    await run(b, "libraries: config and per-map extras imported", {
        cfg: "{key:'K', libraries:['geometry']}", body: M("a", `data-gmap-libraries="places, visualization"`) },
        async (p, snap, check) => { check("imported", (await snap()).libs.join() === "maps,marker,geometry,places,visualization"); });
    await run(b, "libraries: config as a comma list works too", { cfg: "{key:'K', libraries:'places, geometry'}", body: M("a") },
        async (p, snap, check) => { const s = await snap(); check("imported", s.libs.join() === "maps,marker,places,geometry" && s.states.join() === "a=ready", s); });
    await run(b, "marker: mapId in config mapOptions counts as a Map ID", {
        cfg: "{key:'K', mapOptions:{mapId:'CFG'}, styles:['S']}", body: M("a") },
        async (p, snap, check) => {
            const s = await snap();
            check("advanced marker, no styles", s.maps[0].mapId === "CFG" && !s.maps[0].styles && s.markers[0].kind === "advanced", s);
        });

    // ================= bots =================
    await run(b, "bots: Googlebot gets the link only; load() and ready() never build", { ua: BOT, viewport: { width: 412, height: 12000 },
        body: M("a") + SPACER + M("b") },
        async (p, snap, check, n) => {
            const s = await snap();
            check("skipped with links", s.states.join() === "a=skipped,b=skipped" && s.links.join() === "a,b", s);
            check("ready → null, load → null", (await p.evaluate(() => Promise.all([LazyGMaps.ready(a), LazyGMaps.load(b)]))).join() === ",");
            await p.waitForTimeout(300);
            check("nothing billable", n.script === 0 && (await snap()).maps.length === 0, n);
        });
    await run(b, "bots: navigator.webdriver with a normal UA → skipped", { webdriver: true, body: M("a") },
        async (p, snap, check, n) => { check("skipped", (await snap()).states.join() === "a=skipped" && n.script === 0); });
    await run(b, "bots: isBot override wins; one that throws falls back to the built-in check", {
        cfg: "[{key:'K', isBot: function(){ return true; }}]", body: M("a") },
        async (p, snap, check) => { check("override", (await snap()).states.join() === "a=skipped"); });
    await run(b, "bots: throwing isBot override → built-in check", {
        cfg: "{key:'K', isBot: function(){ throw 1; }}", body: M("a") },
        async (p, snap, check, n, logs) => { check("built", (await snap()).states.join() === "a=ready" && has(logs, "isBot failed") === 1, logs); });

    // ================= lifecycle =================
    await run(b, "lifecycle: prerendered page waits for activation", {
        init: () => { let pre = true; Object.defineProperty(Document.prototype, "prerendering", { get: () => pre, configurable: true });
            window.__activate = () => { pre = false; document.dispatchEvent(new Event("prerenderingchange")); }; },
        body: M("a") },
        async (p, snap, check, n) => {
            check("nothing during prerender", n.script === 0 && (await snap()).states.join() === "a=waiting", n);
            await p.evaluate(() => window.__activate()); await p.waitForTimeout(400);
            check("loads after", (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: background tab waits until shown", {
        init: () => { let vis = "hidden"; Object.defineProperty(Document.prototype, "visibilityState", { get: () => vis, configurable: true });
            window.__show = () => { vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); }; },
        body: M("a") },
        async (p, snap, check, n) => {
            check("nothing while hidden", n.script === 0, n);
            await p.evaluate(() => window.__show()); await p.waitForTimeout(400);
            check("loads when shown", (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: display:none container loads when shown", { body: M("a", `style="display:none"`) },
        async (p, snap, check, n) => {
            check("nothing hidden", n.script === 0, n);
            await p.evaluate(() => (a.style.display = "block")); await p.waitForTimeout(400);
            check("loads", (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: scan(panel) and scan(container) set up new content once", { body: `<div id="host"></div>` },
        async (p, snap, check) => {
            await p.evaluate(() => {
                host.innerHTML = '<div id="x" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>';
                LazyGMaps.scan(host); LazyGMaps.scan(host); LazyGMaps.scan(x);
                const y = document.createElement("div"); y.id = "y"; y.className = "map"; y.setAttribute("data-gmap", "");
                y.setAttribute("data-gmap-lat", "3"); y.setAttribute("data-gmap-lng", "4"); document.body.append(y); LazyGMaps.scan(y);
            });
            await p.waitForTimeout(400);
            check("two maps", (await snap()).maps.map((m) => m.id).join() === "x,y");
        });
    await run(b, "lifecycle: load() builds an off-screen map now and resolves its instance", { body: SPACER + M("a") },
        async (p, snap, check) => {
            const r = await p.evaluate(() => LazyGMaps.load(a).then((i) => !!i && i.map === LazyGMaps.get(a).map));
            check("resolved with the map", r && (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: ready() called before the map exists; ignores nested containers' events", {
        body: SPACER + `<div id="outer" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"><div id="inner" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div></div>` },
        async (p, snap, check) => {
            await p.evaluate(() => { window.__r = "pending"; LazyGMaps.ready(outer).then((i) => { window.__r = i ? "map" : "null"; }); LazyGMaps.load(inner); });
            await p.waitForTimeout(300);
            check("still pending after inner is ready", (await p.evaluate(() => window.__r)) === "pending");
            await p.evaluate(() => LazyGMaps.load(outer)); await p.waitForTimeout(300);
            check("resolved", (await p.evaluate(() => window.__r)) === "map");
        });
    await run(b, "lifecycle: container removed while loading → no map; re-added + scan() → one map", { scriptDelay: 400, midLoad: true, body: SPACER + M("a") },
        async (p, snap, check) => {
            await p.evaluate(() => { window.__r = "hang"; LazyGMaps.load(a).then((x) => { window.__r = x; }); window.__a = a; a.remove(); });
            await p.waitForTimeout(700); check("no map", (await snap()).maps.length === 0);
            check("load() promise settles with null", (await p.evaluate(() => window.__r)) === null);
            await p.evaluate(() => { document.body.append(__a); LazyGMaps.scan(); LazyGMaps.load(__a); }); await p.waitForTimeout(400);
            check("one map", (await snap()).maps.length === 1);
        });
    await run(b, "modal: destroy releases the map; load again builds a new one; destroy while loading builds nothing", { scriptDelay: 300, midLoad: true, wait: 100,
        body: SPACER + M("a", `data-gmap-popup="Hi"`) + M("b") },
        async (p, snap, check) => {
            await p.evaluate(() => LazyGMaps.load(a)); await p.waitForTimeout(600);
            const r = await p.evaluate(() => new Promise((res) => {
                a.addEventListener("gmap:destroy", (e) => res({ detail: !!e.detail.map }));
                LazyGMaps.destroy(a);
            }).then((x) => ({ ...x, state: a.getAttribute("data-gmap-state"), canvas: a.querySelectorAll(".lgm-canvas").length,
                link: a.querySelectorAll(".lgm-fallback").length, get: LazyGMaps.get(a), removed: window.__removed, cleared: window.__cleared })));
            check("cleaned up", r.detail && r.state === null && r.canvas === 0 && r.link === 0 && r.get === null && r.removed === 1 && r.cleared === 1, r);
            await p.evaluate(() => LazyGMaps.load(a)); await p.waitForTimeout(300);
            check("second map", (await snap()).maps.length === 2);
            await p.evaluate(() => { LazyGMaps.load(b); LazyGMaps.destroy(b); }); await p.waitForTimeout(300);
            check("destroyed mid-load builds nothing", (await snap()).maps.length === 2);
        });

    // ================= script order and config =================
    await run(b, "order: config array pushed by a later deferred script; unknown setting warns", {
        cfg: "[{key:'K', zoom:9}]", head: SCRIPT + `<script src="/theme.js" defer></script>`,
        files: { "/theme.js": "lazyGMapsConfig.push({ zoom: 11, darkClass: 'x' });" }, body: M("a") },
        async (p, snap, check, n, logs) => {
            check("later wins", (await snap()).maps[0].zoom === 11);
            check("unknown warned", has(logs, 'unknown setting "darkClass"') === 1, logs);
        });
    await run(b, "order: API calls from a deferred script before start wait for it", {
        head: SCRIPT + `<script src="/site.js" defer></script>`, body: SPACER + M("a"),
        files: { "/site.js": "LazyGMaps.load(document.getElementById('a')).then(function(i){ window.__got = !!i; });" } },
        async (p, snap, check) => { check("loaded", (await snap()).maps.length === 1 && (await p.evaluate(() => window.__got))); });
    await run(b, "order: script injected after the page loaded still works", { head: "",
        tail: `<script>addEventListener("load", function(){ setTimeout(function(){ var s=document.createElement("script"); s.src="/lazy-gmaps.js"; document.head.append(s); }, 50); });</script>`,
        body: M("a"), wait: 800 },
        async (p, snap, check) => { check("built", (await snap()).maps.length === 1); });
    await run(b, "order: included twice → warning, one copy runs", { head: SCRIPT + `<script src="/lazy-gmaps.js?2" defer></script>`, body: M("a") },
        async (p, snap, check, n, logs) => { check("one map, one script", (await snap()).maps.length === 1 && n.script === 1 && has(logs, "loaded twice") === 1, { n, logs }); });

    // ================= failures =================
    await run(b, "failure: script blocked → error load, link, ready() null, no message for visitors", { failScript: true, body: M("a") },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("error with link", s.states.join() === "a=error" && s.links.join() === "a" && s.maps.length === 0, s);
            check("ready null", (await p.evaluate(() => LazyGMaps.ready(a))) === null);
            check("console", has(logs, "the map could not load") === 1, logs);
        });
    await run(b, "failure: script never calls back → error after the timeout", { mapsBody: "/* nothing */", cfg: "{key:'K', timeout:300}", body: M("a"), wait: 700 },
        async (p, snap, check, n, logs) => { check("error", (await snap()).states.join() === "a=error" && has(logs, "timed out") === 1, logs); });
    await run(b, "failure: auth error → maps replaced by the link, later maps error, site hook still runs, logged once", {
        init: () => { window.__authFail = true; window.gm_authFailure = () => { window.__siteHook = (window.__siteHook || 0) + 1; }; },
        body: M("a", `data-gmap-popup="x"`) + M("b") + SPACER + M("c"), wait: 600 },
        async (p, snap, check, n, logs) => {
            await scrollTo(p, "c"); const s = await snap();
            check("all error with links", s.states.join() === "a=error,b=error,c=error" && s.links.join() === "a,b,c", s);
            check("built once each, never again", s.maps.length === 2, s.maps);
            const r = await p.evaluate(() => Promise.all([LazyGMaps.load(a), LazyGMaps.ready(c)]).then((x) => ({ x, get: LazyGMaps.get(a), canvas: a.querySelectorAll(".lgm-canvas").length, hook: window.__siteHook })));
            check("released", r.x.join() === "," && r.get === null && r.canvas === 0 && r.hook >= 1, r);
            check("reason auth", await p.evaluate(() => new Promise((res) => { document.addEventListener("gmap:error", (e) => res(e.detail.reason)); LazyGMaps.destroy(c); LazyGMaps.load(c); })) === "auth");
            await p.waitForTimeout(200);
            check("still two maps, one log", (await snap()).maps.length === 2 && has(logs, "Google rejected the API key") === 1, logs);
        });
    await run(b, "existing tag: maps refuse with the link; no second script; logged once", {
        body: M("a") + M("b"), tail: `<script src="https://maps.googleapis.com/maps/api/js?key=OLD"></script>` },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("blocked", s.states.join() === "a=error,b=error" && s.links.join() === "a,b" && s.maps.length === 0, s);
            check("only the old script", n.script === 1 && /key=OLD/.test(n.urls[0]), n);
            check("once", has(logs, "another script loads Google Maps") === 1, logs);
        });
    await run(b, "existing tag: added by other code after start → refused when the map activates", { scriptDelay: 200, body: SPACER + M("a") },
        async (p, snap, check) => {
            await p.evaluate(() => { const t = document.createElement("script"); t.src = "https://maps.google.com/maps/api/js?key=OLD"; document.body.append(t); });
            await scrollTo(p, "a"); await p.waitForTimeout(300);
            check("blocked", (await snap()).states.join() === "a=error");
        });
    await run(b, "existing tag: window.google.maps already present → blocked", {
        init: () => { window.google = { maps: { Map: function () {} } }; }, body: M("a") },
        async (p, snap, check, n) => { check("blocked", (await snap()).states.join() === "a=error" && n.script === 0); });

    // ================= robustness and CSS =================
    await run(b, "robust: public API never throws on bad input", { body: M("a") },
        async (p, snap, check, n, logs) => {
            const r = await p.evaluate(async () => {
                const out = [];
                for (const f of ["scan", "load", "ready", "get", "destroy"]) for (const x of [null, undefined, 5, "x", {}]) {
                    try { out.push(await LazyGMaps[f](x)); } catch (e) { return "threw " + f; }
                }
                return out.filter((x) => x != null).length;
            });
            check("no throws, all null/undefined", r === 0, r);
            check("map unaffected", (await snap()).states.join() === "a=ready");
        });
    await run(b, "robust: invalid rootMargin is reported and maps still load", { cfg: "{key:'K', rootMargin:'nope'}", body: M("a") },
        async (p, snap, check, n, logs) => { check("loaded", (await snap()).maps.length === 1 && has(logs, "invalid rootMargin") === 1, logs); });
    await run(b, "robust: a gmap:ready listener that throws does not break the map", {
        tail: `<script>document.addEventListener("gmap:ready", function(){ throw new Error("site bug"); });</script>`, body: M("a") + M("b") },
        async (p, snap, check) => { check("both ready", (await snap()).states.join() === "a=ready,b=ready"); });
    await run(b, "css: injected first with the page nonce; zero specificity; css:false adds none", {
        head: `<script nonce="abc">0</script>` + SCRIPT + `<style>.map{position:static}</style>`, body: M("a") },
        async (p, snap, check) => {
            const r = await p.evaluate(() => { const s = document.head.querySelector("style"); return { first: s === document.head.firstElementChild, nonce: s.nonce, pos: getComputedStyle(a).position }; });
            check("first, nonce, site wins", r.first && r.nonce === "abc" && r.pos === "static", r);
        });
    await run(b, "css: css:false adds no stylesheet", { cfg: "{key:'K', css:false}", body: M("a") },
        async (p, snap, check) => { check("none", (await p.evaluate(() => document.querySelectorAll("style").length)) === 1); });

    await b.close();
    console.log(`\n${total - failed}/${total} passed`);
    process.exit(failed ? 1 : 0);
})();
