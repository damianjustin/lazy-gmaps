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
        if(n==='core'){m.ColorScheme={LIGHT:'LIGHT',DARK:'DARK',FOLLOW_SYSTEM:'FOLLOW_SYSTEM'};}
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

    // ================= embed (default) =================
    await run(b, "embed: one-line default; iframe near viewport with q, center, zoom, embed key; nothing billable", {
        page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613" data-gmap-zoom="16" data-gmap-title="Perth office"></div>` } },
        async (p, snap, check, n) => {
            const s = await snap(), u = n.embedReq[0];
            check("1 embed", n.embedReq.length === 1, n);
            check("params", q(u, "key") === "KEY" && q(u, "q") === "-31.9523,115.8613" && q(u, "center") === "-31.9523,115.8613" && q(u, "zoom") === "16", u);
            check("no script, no static", n.script === 0 && n.staticReq.length === 0, n);
            check("ready, placeholder gone", s.states[0] === "e1=ready" && s.placeholders === 0, s);
            check("iframe title", (await p.$eval("iframe", (f) => f.title)) === "Perth office");
        });
    await run(b, "embed: below the fold waits for scroll", {
        page: { body: `<div class="spacer"></div><div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` } },
        async (p, snap, check, n) => { check("none yet", n.embedReq.length === 0, n); await scrollTo(p, "e1"); check("after scroll", n.embedReq.length === 1, n); });
    await run(b, "embed: bots still get it (free)", { ua: UA.bot, page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` } },
        async (p, snap, check, n) => { check("embed for bot", n.embedReq.length === 1, n); });
    await run(b, "embed: data-gmap-query instead of lat/lng", {
        page: { body: `<div id="e1" class="map" data-gmap data-gmap-query="4PWQ2VX6+3G"></div>` } },
        async (p, snap, check, n) => { const u = n.embedReq[0]; check("q + key", q(u, "q") === "4PWQ2VX6+3G" && q(u, "key") === "KEY" && !q(u, "center"), u); });
    await run(b, "embed: trigger click shows a button, loads on click", {
        page: { body: `<div id="e1" class="map" data-gmap data-gmap-trigger="click" data-gmap-lat="1" data-gmap-lng="2"></div>` } },
        async (p, snap, check, n) => {
            check("nothing yet", n.embedReq.length === 0, n);
            check("button visible", await p.isVisible("#e1 [data-gmap-load]"));
            await p.click("#e1 [data-gmap-load]"); await p.waitForTimeout(300);
            check("loaded", n.embedReq.length === 1, n);
        });

    // ================= dynamic, auto =================
    await run(b, "dynamic: map near viewport with Map ID, advanced marker with 2x pin, popup as text", {
        page: { body: D("d1", `data-gmap-zoom="14" data-gmap-map-id="ACME" data-gmap-marker="https://cdn.example.com/pin@2x.png" data-gmap-marker-size="24x33" data-gmap-popup="<b>x</b> Open Sat" data-gmap-popup-open data-gmap-title="Acme"`) } },
        async (p, snap, check, n) => {
            const s = await snap();
            check("1 map, ready, no static", s.maps.length === 1 && s.states[0] === "d1=ready" && n.staticReq.length === 0, { s, n });
            check("map options", s.maps[0].zoom === 14 && s.maps[0].mapId === "ACME" && s.maps[0].center.lat === -31.9523, s.maps[0]);
            check("advanced marker w/ pin + size", s.markers[0].kind === "advanced" && /pin@2x/.test(s.markers[0].img) && s.markers[0].size.join() === "24,33", s.markers);
            check("popup escaped + opened", s.info[0].text === "<b>x</b> Open Sat" && !s.info[0].html.includes("<b>"), s.info);
            check("one script with key + libraries", n.script === 1 && /key=KEY/.test(n.scriptUrls[0]) && /libraries=core%2Cmaps%2Cmarker/.test(n.scriptUrls[0]), n.scriptUrls);
        });
    await run(b, "dynamic: no Map ID → legacy marker scaled; config styles + mapOptions; per-map data-gmap-options", {
        page: { cfg: "{key:'K', styles:[{featureType:'poi',stylers:[{visibility:'off'}]}], mapOptions:{disableDefaultUI:true}, marker:'/pin@2x.png', markerSize:'24x33'}",
            body: D("d1", `data-gmap-options='{"scrollwheel":false}'`) } },
        async (p, snap, check) => {
            const s = await snap(), o = s.maps[0].opts;
            check("styles + options merged", s.maps[0].styles.length === 1 && o.disableDefaultUI === true && o.scrollwheel === false, o);
            check("legacy marker scaled", s.markers[0].kind === "legacy" && s.markers[0].icon.url === "https://site.test/pin@2x.png" && s.markers[0].icon.scaledSize.width === 24, s.markers[0]);
        });
    await run(b, "dynamic: popup from <template>; bad template selector doesn't break the map", {
        page: { body: `<template id="tpl"><strong>Acme</strong></template>` + D("d1", `data-gmap-popup-template="#tpl"`) + D("d2", `data-gmap-popup-template="#1bad"`) } },
        async (p, snap, check) => { const s = await snap(); check("template used, both ready", s.info[0].html.includes("<strong>Acme</strong>") && s.states.join() === "d1=ready,d2=ready", s); });
    await run(b, "dynamic: marker none → no marker", { page: { body: D("d1", `data-gmap-marker="none"`) } },
        async (p, snap, check) => { const s = await snap(); check("map, no marker", s.maps.length === 1 && s.markers.length === 0, s); });
    await run(b, "dynamic: gmap:map event, LazyGMaps.get() and .options()", {
        page: { body: D("d1"), head: `<script>document.addEventListener('gmap:map', e => { window.__evt = !!(e.detail.map && e.detail.marker); });</script>` } },
        async (p, snap, check) => {
            const r = await p.evaluate(() => ({ evt: window.__evt, get: !!LazyGMaps.get(document.getElementById("d1")).map, o: LazyGMaps.options(document.getElementById("d1")).mode }));
            check("event + get + options", r.evt && r.get && r.o === "dynamic", r);
        });

    // ================= dynamic, click =================
    const DC = D("c1", `data-gmap-trigger="click" data-gmap-zoom="13" data-gmap-marker="/img/pin@2x.png" data-gmap-marker-size="24x33" data-gmap-title="Lot 460"`);
    await run(b, "dynamic click: static preview (730px box: one zoom level out at half size, pin kept at size, styles), no script until click; click builds same map; focus kept", {
        page: { cfg: "{key:'K', styles:[{featureType:'road',stylers:[{saturation:-70},{hue:'#e7ecf0'}]}]}",
            body: `<div style="width:730px;height:280px">${DC.replace('class="map"', 'style="width:100%;height:100%"')}</div>` } },
        async (p, snap, check, n) => {
            let s = await snap(); const u = n.staticReq[0];
            check("1 static, no script, preview", n.staticReq.length === 1 && n.script === 0 && s.states[0] === "c1=preview", { n, s });
            check("static params", q(u, "center") === "-31.9523,115.8613" && q(u, "zoom") === "12" && q(u, "size") === "365x140" && q(u, "scale") === "2" &&
                q(u, "markers") === "scale:4|icon:https://site.test/img/pin@2x.png|-31.9523,115.8613" && q(u, "style") === "feature:road|saturation:-70|hue:0xe7ecf0", u);
            await p.focus("#c1 .lgm-preview"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
            s = await snap();
            check("1 map, same zoom + styles, ready, preview gone", s.maps.length === 1 && s.maps[0].zoom === 13 && s.maps[0].styles && s.states[0] === "c1=ready" && s.placeholders === 0, s);
            check("focus on container", (await p.evaluate(() => document.activeElement.id)) === "c1");
        });
    await run(b, "dynamic click: double click builds one map", { page: { body: DC } },
        async (p, snap, check) => { await p.dblclick("#c1 .lgm-preview"); await p.waitForTimeout(400); check("1 map", (await snap()).maps.length === 1); });
    await run(b, "dynamic click: data-gmap-preview=none → button only, no static image", { page: { body: D("c1", `data-gmap-trigger="click" data-gmap-preview="none"`) } },
        async (p, snap, check, n) => {
            check("no static", n.staticReq.length === 0, n); check("button visible", await p.isVisible("#c1 [data-gmap-load]"));
            await p.click("#c1 [data-gmap-load]"); await p.waitForTimeout(300); check("map", (await snap()).maps.length === 1);
        });
    await run(b, "dynamic click: marker none → preview has no marker; Map ID → map_id not style", {
        page: { cfg: "{key:'K', styles:[{featureType:'poi',stylers:[{visibility:'off'}]}]}", body: D("c1", `data-gmap-trigger="click" data-gmap-marker="none" data-gmap-map-id="ID1"`) } },
        async (p, snap, check, n) => { const u = n.staticReq[0]; check("no markers, map_id, no style", !q(u, "markers") && q(u, "map_id") === "ID1" && !q(u, "style"), u); });
    await run(b, "dynamic click: data-gmap-static-src (pre-signed) used verbatim", {
        page: { body: D("c1", `data-gmap-trigger="click" data-gmap-static-src="https://maps.googleapis.com/maps/api/staticmap?center=1,2&signature=abc"`) } },
        async (p, snap, check, n) => { check("signed", (n.staticReq[0] || "").includes("signature=abc"), n.staticReq); });
    await run(b, "dynamic click: site CSS resets don't break the preview", {
        page: { head: `<style>img{height:auto;max-width:100%} button{padding:20px;background:red;border:5px solid blue}</style>`,
            body: D("c1", `data-gmap-trigger="click" style="width:1000px;height:300px"`) } },
        async (p, snap, check) => {
            const r = await p.evaluate(() => { const bt = document.querySelector("#c1 .lgm-preview"), i = bt.querySelector("img"), cs = getComputedStyle(bt);
                return { h: Math.round(i.getBoundingClientRect().height), w: Math.round(i.getBoundingClientRect().width), pad: cs.paddingTop, border: cs.borderTopWidth }; });
            check("image fills, reset holds", r.h === 300 && r.w === 1000 && r.pad === "0px" && r.border === "0px", r);
        });

    // ================= init hook =================
    await run(b, "hook: init(map, ctx) runs after the map is built, with ctx.el, ctx.options, ctx.marker", {
        page: { body: D("h1", `data-gmap-init="addMarkers" data-gmap-zoom="9"`), tail: `<script>window.addMarkers = function(map, ctx){ window.__ctx = { el: ctx.el.id, zoom: ctx.options.zoom, marker: !!ctx.marker, google: !!ctx.google, isMap: map === LazyGMaps.get(ctx.el).map }; calls.push('x'); };</script>` } },
        async (p, snap, check) => { const c = await p.evaluate(() => window.__ctx); check("ctx; no default marker with an init function", c.el === "h1" && c.zoom === 9 && c.marker === false && c.google && c.isMap, c); });
    await run(b, "hook: data-gmap-marker=\"show\" keeps the default marker (config icon) with an init function", {
        page: { cfg: "{key:'KEY', marker:'/cfg.png', markerSize:'24x33'}", body: D("h1", `data-gmap-init="addMarkers" data-gmap-marker="show" data-gmap-popup="Hi"`) } },
        async (p, snap, check) => { const s = await snap(); const def = s.markers.find((m) => m.icon && m.icon.url);
            check("default marker with config icon + popup, plus hook marker", def && def.icon.url === "https://site.test/cfg.png" && s.markers.length === 2 && s.info.length === 1, s.markers); });
    await run(b, "hook: two maps share one init → called once each with its own map", {
        page: { body: D("a", `data-gmap-init="addMarkers" data-gmap-zoom="10"`) + D("b", `data-gmap-init="addMarkers" data-gmap-zoom="11"`), viewport: { width: 1280, height: 900 } } },
        async (p, snap, check) => {
            const s = await snap();
            check("called per map with own options", s.calls.sort().join() === "addMarkers:a:10,addMarkers:b:11", s.calls);
            check("2 maps, hook markers on the right map", s.maps.length === 2 && s.markers.filter((m) => m.host === "a").length === 1 && s.markers.filter((m) => m.host === "b").length === 1, s.markers);
        });
    await run(b, "hook: two maps with different inits, styles, pins and triggers don't interfere", {
        page: { cfg: "{key:'K', styles:{ default:[{featureType:'poi',stylers:[{visibility:'off'}]}], dark:[{featureType:'all',stylers:[{invert_lightness:true}]},{featureType:'water',stylers:[{color:'#000000'}]}] }}",
            body: D("x", `data-gmap-init="addMarkers" data-gmap-marker="/a.png"`) + D("y", `data-gmap-init="addOverlay" data-gmap-style="dark" data-gmap-marker="/b.png" data-gmap-trigger="click"`) } },
        async (p, snap, check, n) => {
            let s = await snap();
            check("x built with default style, y only previewed", s.maps.length === 1 && s.maps[0].id === "x" && s.maps[0].styles.length === 1 && s.states[1] === "y=preview", s);
            check("y preview uses dark style", n.staticReq.length === 1 && new URL(n.staticReq[0]).searchParams.getAll("style").join(";") === "feature:all|invert_lightness:true;feature:water|color:0x000000", n.staticReq);
            await p.click("#y .lgm-preview"); await p.waitForTimeout(400);
            s = await snap();
            const y = s.maps.find((m) => m.id === "y");
            check("y has dark style + its own hook; x hook untouched", y && y.styles.length === 2 && s.calls.join() === "addMarkers:x:15,addOverlay:y", { s });
            check("pins per map", s.markers.find((m) => m.host === "x" && m.icon).icon === "https://site.test/a.png" && s.markers.find((m) => m.host === "y" && m.icon).icon === "https://site.test/b.png", s.markers);
            check("one script for both", n.script === 1, n);
        });
    await run(b, "hook throws → base map kept and visible, ready, logged, no second map", { page: { body: D("h1", `data-gmap-init="badInit"`) } },
        async (p, snap, check, n, logs) => {
            let s = await snap();
            const vis = await p.evaluate(() => ({ canvas: document.querySelectorAll("#h1 .lgm-canvas:not(.lgm-canvas--pending)").length }));
            check("ready, map visible", s.states[0] === "h1=ready" && vis.canvas === 1 && s.placeholders === 0, { s, vis });
            check("logged", logs.some((l) => l.includes('"badInit" failed')), logs);
            await p.evaluate(() => LazyGMaps.load(document.getElementById("h1"))); await p.waitForTimeout(200);
            s = await snap(); check("still 1 map, hook once", s.maps.length === 1 && s.calls.length === 1, s);
        });
    await run(b, "hook not defined → base map built, clear console message", { page: { body: D("h1", `data-gmap-init="nope"`) } },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("ready, base map", s.states[0] === "h1=ready" && s.maps.length === 1 && s.maps[0].zoom === 15, s);
            check("message", logs.some((l) => l.includes('data-gmap-init="nope" is not a global function')), logs);
        });

    // ================= bots =================
    await run(b, "bots: Googlebot skips dynamic + preview, embed still loads; button rescues a human", { ua: UA.bot,
        page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` + D("d1") + D("c1", `data-gmap-trigger="click"`) } },
        async (p, snap, check, n) => {
            let s = await snap();
            check("embed only", n.embedReq.length === 1 && n.script === 0 && n.staticReq.length === 0 && s.states.join() === "e1=ready,d1=skipped,c1=skipped", { n, s });
            check("fallback link", (await p.$eval("#d1 .lgm-placeholder a", (a) => a.href)) === "https://www.google.com/maps/search/?api=1&query=-31.9523%2C115.8613");
            await p.click("#d1 [data-gmap-load]"); await p.waitForTimeout(300); check("click loads", (await snap()).maps.length === 1);
        });
    await run(b, "bots: navigator.webdriver with a normal UA → skipped", { webdriver: true, page: { body: D("d1") } },
        async (p, snap, check, n) => { check("skipped", (await snap()).states[0] === "d1=skipped" && n.script === 0, n); });
    await run(b, "bots: tall Googlebot viewport loads nothing billable; same viewport as a human loads all", { ua: UA.bot, viewport: { width: 412, height: 12140 },
        page: { body: D("a") + `<div class="spacer"></div>` + D("b") } },
        async (p, snap, check, n) => { check("none", n.script === 0 && n.staticReq.length === 0, n); });
    await run(b, "bots: (control) tall viewport human loads both", { viewport: { width: 412, height: 12140 }, page: { body: D("a") + `<div class="spacer"></div>` + D("b") } },
        async (p, snap, check) => { check("2 maps", (await snap()).maps.length === 2); });

    // ================= loading lifecycle =================
    await run(b, "lifecycle: two maps, one visible → one built; second on scroll; one script", { page: { body: D("a") + `<div class="spacer"></div>` + D("b") } },
        async (p, snap, check, n) => {
            check("1 map", (await snap()).maps.length === 1);
            await scrollTo(p, "b"); check("2 maps, 1 script", (await snap()).maps.length === 2 && n.script === 1, n);
        });
    await run(b, "lifecycle: embed on top + dynamic below → Maps JS only when dynamic is reached", { page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div><div class="spacer"></div>` + D("d1") } },
        async (p, snap, check, n) => { check("embed only", n.embedReq.length === 1 && n.script === 0, n); await scrollTo(p, "d1"); check("script once", n.script === 1, n); });
    await run(b, "lifecycle: prerendered page waits for activation", {
        init: () => { let pre = true; Object.defineProperty(Document.prototype, "prerendering", { get: () => pre, configurable: true });
            window.__activate = () => { pre = false; document.dispatchEvent(new Event("prerenderingchange")); }; },
        page: { body: D("d1") + `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` } },
        async (p, snap, check, n) => {
            check("nothing during prerender", n.script === 0 && n.embedReq.length === 0, n);
            await p.evaluate(() => window.__activate()); await p.waitForTimeout(400); check("loads after", (await snap()).maps.length === 1 && n.embedReq.length === 1, n);
        });
    await run(b, "lifecycle: hidden container (display:none) loads only when shown", { page: { body: D("d1", `style="display:none"`) } },
        async (p, snap, check, n) => {
            check("nothing hidden", n.script === 0, n);
            await p.evaluate(() => (document.getElementById("d1").style.display = "block")); await p.waitForTimeout(400); check("loads", (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: no IntersectionObserver (old browser) → loads straight away", {
        init: () => { delete window.IntersectionObserver; }, page: { body: `<div class="spacer"></div>` + D("d1") } },
        async (p, snap, check) => { check("loaded without scrolling", (await snap()).maps.length === 1); });
    await run(b, "lifecycle: container removed while the API loads → no map; re-attached + scan() → map", { scriptDelay: 400, page: { body: `<div id="host"></div>` } },
        async (p, snap, check) => {
            await p.evaluate(() => { window.__d = document.createElement("div"); __d.id = "g1"; __d.className = "map"; __d.setAttribute("data-gmap", ""); __d.setAttribute("data-gmap-mode", "dynamic");
                __d.setAttribute("data-gmap-lat", "1"); __d.setAttribute("data-gmap-lng", "2"); document.getElementById("host").appendChild(__d); LazyGMaps.scan(__d); LazyGMaps.load(__d); __d.remove(); });
            await p.waitForTimeout(700); check("no map", (await snap()).maps.length === 0);
            await p.evaluate(() => { document.getElementById("host").appendChild(__d); LazyGMaps.scan(); }); await p.waitForTimeout(400);
            check("map after re-scan", (await snap()).maps.length === 1);
        });
    await run(b, "lifecycle: AJAX content → LazyGMaps.scan(panel) and scan(container)", { page: { body: `<div id="host"></div><div id="host2"></div>` } },
        async (p, snap, check) => {
            await p.evaluate(() => {
                document.getElementById("host").innerHTML = '<div id="a1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="1" data-gmap-lng="2"></div>'; LazyGMaps.scan(document.getElementById("host"));
                const d = document.createElement("div"); d.id = "a2"; d.className = "map"; d.setAttribute("data-gmap", ""); d.setAttribute("data-gmap-lat", "1"); d.setAttribute("data-gmap-lng", "2");
                document.getElementById("host2").appendChild(d); LazyGMaps.scan(d); });
            await p.waitForTimeout(400); const s = await snap(); check("both ready", s.states.join() === "a1=ready,a2=ready", s);
        });
    await run(b, "lifecycle: wrapper included twice → one script, one map", { page: { body: D("d1"), twice: true } },
        async (p, snap, check, n) => { check("once", n.script === 1 && (await snap()).maps.length === 1, n); });
    await run(b, "lifecycle: stale data-gmap-state in cached HTML is ignored", { page: { body: D("d1", `data-gmap-state="skipped"`) } },
        async (p, snap, check) => { check("ready", (await snap()).states[0] === "d1=ready"); });

    // ================= failures =================
    await run(b, "failure: script blocked → silent fallback: link only, no button, no message, click does nothing", { failFirstScript: true, page: { body: D("d1") } },
        async (p, snap, check, n) => {
            let s = await snap();
            const ui = await p.evaluate(() => ({ btn: getComputedStyle(document.querySelector("#d1 [data-gmap-load]")).display,
                link: getComputedStyle(document.querySelector("#d1 .lgm-placeholder a")).display, text: document.getElementById("d1").innerText.trim() }));
            check("error, link only", s.states[0] === "d1=error" && ui.btn === "none" && ui.link !== "none" && ui.text === "Open in Google Maps", { s, ui });
            await p.evaluate(() => document.querySelector("#d1 [data-gmap-load]").click()); await p.waitForTimeout(300); s = await snap();
            check("no retry", s.maps.length === 0 && n.script === 1, { s, n });
        });
    await run(b, "failure: script never calls back → error after timeout", { mapsBody: "/* blocked */", page: { cfg: "{key:'K', timeout:500}", body: D("d1") }, wait: 900 },
        async (p, snap, check) => { check("error", (await snap()).states[0] === "d1=error"); });
    await run(b, "failure: auth error → auth-error on dynamic, later dynamic maps not built, embed untouched", {
        init: () => { window.__authFail = true; }, page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` + D("d1") + `<div class="spacer"></div>` + D("d2") } },
        async (p, snap, check) => {
            await scrollTo(p, "d2"); const s = await snap();
            const link = await p.$$eval("#d1 .lgm-placeholder a", (a) => a.length);
            check("states", s.states.join() === "e1=ready,d1=error,d2=error" && s.maps.length === 1 && link === 1, { s, link });
            const canv = await p.$$eval("#d1 .lgm-canvas", (c) => c.length); check("broken map removed", canv === 0, canv);
        });

    // ================= existing Google Maps tag =================
    await run(b, "existing tag: dynamic maps refuse (fallback link, console error), embed still works, no second script", {
        page: { body: `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>` + D("d1") + D("c1", `data-gmap-trigger="click"`),
            tail: `<script src="https://maps.googleapis.com/maps/api/js?key=OLD&loading=async"></script>` } },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("states", s.states.join() === "e1=ready,d1=error,c1=error" && s.maps.length === 0, s);
            check("only the old script, no static preview", n.script === 1 && /key=OLD/.test(n.scriptUrls[0]) && n.staticReq.length === 0 && n.embedReq.length === 1, n);
            check("console error once", logs.filter((l) => l.includes("another script on this page already loads Google Maps")).length === 1, logs);
            check("link shown", (await p.$$eval("#d1 .lgm-placeholder a", (a) => a.length)) === 1);
        });
    await run(b, "existing tag: maps.google.com host added after start → refused at load time", { scriptDelay: 300,
        page: { body: `<div class="spacer"></div>` + D("d1") } },
        async (p, snap, check, n, logs) => {
            await p.evaluate(() => { const t = document.createElement("script"); t.src = "https://maps.google.com/maps/api/js?key=OLD&libraries=places"; document.body.appendChild(t); });
            await scrollTo(p, "d1"); await p.waitForTimeout(500); const s = await snap();
            check("error, no map", s.states[0] === "d1=error" && s.maps.length === 0, { s, n });
            check("explained", logs.some((l) => l.includes("already loads Google Maps")), logs);
        });

    // ================= developer errors =================
    await run(b, "dev errors: clear console messages, nothing billable", {
        page: { cfg: "{key:'K', styles:{default:[]}}", body:
            `<div id="m1" class="map" data-gmap data-gmap-mode="dynamic"></div>
             <div id="m2" class="map" data-gmap data-gmap-mode="fancy" data-gmap-lat="1" data-gmap-lng="2"></div>
             <div id="m3" class="map" data-gmap data-gmap-trigger="hover" data-gmap-lat="1" data-gmap-lng="2"></div>
             <div id="m5" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-options="{bad}" data-gmap-style="nope" data-gmap-lat="1" data-gmap-lng="2"></div>
             <div id="m6" style="height:0" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>
             <div id="m7" class="map" data-gmap data-gmap-init="x" data-gmap-marker="/p.png" data-gmap-lat="1" data-gmap-lng="2"></div>` } },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("error states", ["m1=error", "m2=error", "m3=error"].every((x) => s.states.includes(x)), s.states);
            const has = (t) => logs.some((l) => l.includes(t));
            check("needs lat/lng", has("dynamic map needs data-gmap-lat and data-gmap-lng"), logs);
            check("unknown mode", has('unknown data-gmap-mode="fancy"'));
            check("unknown trigger", has('unknown data-gmap-trigger="hover"'));
            check("bad JSON", has("data-gmap-options is not a valid JSON object"));
            check("missing style set", has('no style set "nope"'));
            check("zero height", has("zero height"));
            check("dynamic-only attrs on embed", has("apply to dynamic maps only"));
            check("m5 still works (bad JSON/style ignored)", s.states.includes("m5=ready") || s.states.includes("m5=waiting"), s.states);
        });
    await run(b, "dev: SVG pin warns; debug logs decisions; CSS injected first so site CSS wins", {
        page: { cfg: "{key:'K', debug:true}", body: D("d1", `data-gmap-trigger="click" data-gmap-marker="/p.svg" style="position:sticky;top:0"`) } },
        async (p, snap, check, n, logs) => {
            const msgs = []; p.on("console", (m) => msgs.push(m.text())); await p.reload(); await p.waitForTimeout(300);
            check("svg warning", msgs.some((l) => l.includes("SVG marker icons")), msgs);
            check("debug lines", msgs.some((m) => m.startsWith("[lazy-gmaps]") && m.includes("preview")), msgs);
            const r = await p.evaluate(() => ({ first: document.head.firstElementChild.id, pos: getComputedStyle(document.getElementById("d1")).position }));
            check("css first, sticky kept", r.first === "lazy-gmaps-css" && r.pos === "sticky", r);
        });
    await run(b, "dev: per-map data-gmap-libraries imported", { page: { body: D("d1", `data-gmap-libraries="places,geometry"`) } },
        async (p, snap, check) => { const libs = await p.evaluate(() => window.__libs); check("libs", ["maps", "marker", "places", "geometry"].every((l) => libs.includes(l)), libs); });

    await b.close();
    console.log(`\n${total - failed}/${total} scenarios passed`);
    process.exit(failed ? 1 : 0);
})();
