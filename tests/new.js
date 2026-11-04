// New-feature tests for lazy-gmaps.js 0.1.0: script order, config merging, lifecycle API,
// modal destroy/recreate, dark mode, popup templates, server-rendered fallbacks.
const { chromium } = require("playwright");
const fs = require("fs");
const WRAPPER = fs.readFileSync(process.argv[2], "utf8");
const ONLY = process.argv[3] || "";
const HUMAN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const MOCK = fs.readFileSync(__dirname + "/suite.js", "utf8").match(/const MOCK_API = `([\s\S]*?)`;/)[1]
    .replace("Map.prototype.fitBounds=", "Map.prototype.setCenter=function(c){this.center=c;window.__setCenter=c};Map.prototype.setZoom=function(z){this.z=z;window.__setZoom=z};Map.prototype.fitBounds=")
    .replace("Map.prototype.setOptions=function(o){this.set=o};", "Map.prototype.setOptions=function(o){this.set=o;window.__setOptions=(window.__setOptions||[]).concat([o])};")
    .replace("Marker.prototype=Object.create(Ev.prototype);", "Marker.prototype=Object.create(Ev.prototype);Marker.prototype.setPosition=function(p){window.__markerPos=p};Marker.prototype.setMap=function(m){this.removed=!m};")
    .replace("m.event={", "m.event={clearInstanceListeners:function(){window.__cleared=(window.__cleared||0)+1},");

let failed = 0, total = 0;
async function run(browser, name, opts, steps) {
    if (ONLY && !name.includes(ONLY)) return;
    const ctx = await browser.newContext({ userAgent: opts.ua || HUMAN, viewport: { width: 1280, height: 800 }, colorScheme: opts.colorScheme || "light", javaScriptEnabled: opts.noJs ? false : true });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
    const n = { script: 0, staticReq: [], embedReq: [] }, logs = [];
    const files = Object.assign({ "/lazy-gmaps.js": WRAPPER }, opts.files || {});
    await ctx.route("https://site.test/**", async (r) => {
        const path = new URL(r.request().url()).pathname;
        if (files[path] !== undefined) {
            if (opts.delays && opts.delays[path]) await new Promise((res) => setTimeout(res, opts.delays[path]));
            return r.fulfill({ contentType: "text/javascript", body: files[path] });
        }
        return r.fulfill({ contentType: "text/html", body: opts.html });
    });
    await ctx.route(/https:\/\/maps\.googleapis\.com\/maps\/api\/js.*/, async (r) => {
        n.script++;
        if (opts.scriptDelay) await new Promise((res) => setTimeout(res, opts.scriptDelay));
        return r.fulfill({ contentType: "text/javascript", body: MOCK });
    });
    await ctx.route("https://maps.googleapis.com/maps/api/staticmap**", (r) => { if (opts.failStatic) { n.staticReq.push(r.request().url()); return r.fulfill({ status: 403, contentType: "text/plain", body: "denied" }); } n.staticReq.push(r.request().url()); return r.fulfill({ contentType: "image/png", body: PNG }); });
    await ctx.route("https://www.google.com/maps/embed/**", (r) => { n.embedReq.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<p>embed</p>" }); });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
    p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
    await p.goto("https://site.test/page.html");
    await p.waitForTimeout(opts.wait || 500);
    // Then wait for loads in progress to finish (embeds can be slow on a busy machine), unless the
    // test acts while a map is still loading.
    if (!opts.midLoad) await p.waitForFunction(() => !document.querySelector('[data-gmap-state="loading"]'), null, { timeout: 3000 }).catch(() => {});
    const snap =() => p.evaluate(() => ({
        maps: window.__maps || [], markers: window.__markers || [], info: window.__info || [], calls: window.calls || [],
        states: [...document.querySelectorAll("[data-gmap]")].map((e) => (e.id || "?") + "=" + e.getAttribute("data-gmap-state")),
    }));
    const results = [];
    const check = (label, ok, info) => results.push({ label, ok: !!ok, info });
    try { await steps(p, snap, check, n, logs, ctx); } catch (e) { check("threw: " + e.message, false); }
    await ctx.close();
    const bad = results.filter((r) => !r.ok);
    total++; if (bad.length) failed++;
    console.log(`${bad.length ? "FAIL" : "PASS"}  ${name}`);
    bad.forEach((r) => console.log("      ✗", r.label, JSON.stringify(r.info === undefined ? null : r.info).slice(0, 700)));
}
const q = (url, k) => new URL(url || "https://x/").searchParams.get(k);
const doc = (head, body) => `<!doctype html><html><head><meta charset="utf-8"><style>.map{height:300px;width:600px}.spacer{height:3000px}</style>${head}</head><body>${body}</body></html>`;
const EMBED = `<div id="e1" class="map" data-gmap data-gmap-lat="1" data-gmap-lng="2"></div>`;
const DYN = (id, extra = "") => `<div id="${id}" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="-31.95" data-gmap-lng="115.86" ${extra}></div>`;

(async () => {
    const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });

    // ===================== script order =====================
    await run(b, "order: helper deferred in <head>, config in a LATER deferred script → config applied", {
        files: { "/cfg.js": "window.lazyGMapsConfig = { key: 'LATE' };" },
        html: doc(`<script src="/lazy-gmaps.js" defer></script><script src="/cfg.js" defer></script>`, EMBED) },
        async (p, snap, check, n) => { check("embed uses LATE key", q(n.embedReq[0], "key") === "LATE", n.embedReq); });

    await run(b, "order: later deferred script is slow to download → still waits for it", {
        files: { "/cfg.js": "window.lazyGMapsConfig = { key: 'SLOW' };" }, delays: { "/cfg.js": 600 }, wait: 1000,
        html: doc(`<script src="/lazy-gmaps.js" defer></script><script src="/cfg.js" defer></script>`, EMBED) },
        async (p, snap, check, n) => { check("embed uses SLOW key", n.embedReq.length === 1 && q(n.embedReq[0], "key") === "SLOW", n.embedReq); });

    await run(b, "order: init function defined in a later deferred script → called", {
        files: { "/init.js": "function addStuff(map, ctx){ (window.calls = window.calls || []).push('addStuff:' + ctx.el.id); }" },
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script src="/init.js" defer></script>`, DYN("d1", `data-gmap-init="addStuff"`)) },
        async (p, snap, check) => { const s = await snap(); check("hook ran, ready", s.calls.join() === "addStuff:d1" && s.states[0] === "d1=ready", s); });

    await run(b, "order: init function defined in an async script that arrives after load → base map, console error", {
        files: { "/init.js": "window.addStuff = function(map, ctx){ (window.calls = window.calls || []).push('late'); };" }, delays: { "/init.js": 300 }, wait: 900,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`,
            DYN("d1", `data-gmap-init="addStuff"`) + `<script>window.addEventListener('load', () => { const s = document.createElement('script'); s.src = '/init.js'; document.head.append(s); });</script>`) },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("base map shown, init not called, explained", s.states[0] === "d1=ready" && s.maps.length === 1 && s.calls.length === 0 && logs.some((l) => l.includes('data-gmap-init="addStuff" is not a global function')), { s, logs });
        });
    await run(b, "order: init as a dotted path (Site.maps.init)", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script>window.Site={maps:{init:function(m,c){(window.calls=window.calls||[]).push('dotted:'+c.el.id)}}}</script>`, DYN("d1", `data-gmap-init="Site.maps.init"`)) },
        async (p, snap, check) => { const s = await snap(); check("called", s.calls.join() === "dotted:d1", s); });
    await run(b, "order: async init that rejects → map kept, ready, logged", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script>async function asyncBad(){ throw new Error('nope'); }</script>`, DYN("d1", `data-gmap-init="asyncBad"`)) },
        async (p, snap, check, n, logs) => { const s = await snap(); check("ready, logged", s.states[0] === "d1=ready" && s.maps.length === 1 && logs.some((l) => l.includes('"asyncBad" failed')), { s, logs }); });

    await run(b, "order: helper async → works whether it runs before or after DOMContentLoaded", {
        delays: { "/lazy-gmaps.js": 300 }, wait: 900,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" async></script>`, EMBED + DYN("d1")) },
        async (p, snap, check, n) => { const s = await snap(); check("both ready", s.states.join() === "e1=ready,d1=ready", s); });

    await run(b, "order: helper injected after the load event → starts immediately, flagged in the console", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script>`, EMBED + DYN("d1") +
            `<script>window.addEventListener('load', () => setTimeout(() => { const s = document.createElement('script'); s.src = '/lazy-gmaps.js'; document.body.append(s); }, 100));</script>`), wait: 800 },
        async (p, snap, check, n, logs) => { const s = await snap(); check("both ready", s.states.join() === "e1=ready,d1=ready", s); check("flagged", logs.some((l) => l.includes("ran after the page finished loading")), logs); });

    await run(b, "order: helper as a plain (sync) script in <head>, before the containers exist → waits for them", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js"></script>`, EMBED + DYN("d1")) },
        async (p, snap, check) => { const s = await snap(); check("both ready", s.states.join() === "e1=ready,d1=ready", s); });

    await run(b, "order: helper as a plain script at the end of <body>", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script>`, EMBED + DYN("d1") + `<script src="/lazy-gmaps.js"></script>`) },
        async (p, snap, check) => { const s = await snap(); check("both ready", s.states.join() === "e1=ready,d1=ready", s); });

    // ===================== config from several places =====================
    await run(b, "config: plugin array + theme push in a later deferred script → merged, later wins", {
        files: { "/theme.js": "(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ zoom: 9, styles: { hobble: [{ featureType: 'all', stylers: [{ invert_lightness: true }] }] }, mapOptions: { scrollwheel: false } });" },
        html: doc(`<script>(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ key: 'PLUGIN', zoom: 12, styles: { default: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }] }, mapOptions: { disableDefaultUI: true } });</script>
            <script src="/lazy-gmaps.js" defer></script><script src="/theme.js" defer></script>`, DYN("d1") + DYN("d2", `data-gmap-style="hobble"`)) },
        async (p, snap, check, n, logs) => {
            const s = await snap(); const m1 = s.maps.find((m) => m.id === "d1"), m2 = s.maps.find((m) => m.id === "d2");
            check("zoom from theme", m1.zoom === 9, m1);
            check("named style sets merged", m1.styles[0].featureType === "poi" && m2.styles[0].stylers[0].invert_lightness === true, { m1, m2 });
            check("mapOptions merged", m1.opts.disableDefaultUI === true && m1.opts.scrollwheel === false, m1.opts);
            check("no late warning (before start)", !logs.some((l) => l.includes("after the page finished")), logs);
            check("no configure()/config in the API", await p.evaluate(() => LazyGMaps.configure === undefined && LazyGMaps.config === undefined));
        });
    await run(b, "config: pushed late (tag manager) → maps not set up yet get it, built maps don't, key locked, warnings once", {
        html: doc(`<script>window.lazyGMapsConfig=[{key:'K'}]</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1") + `<div class="spacer"></div>` + DYN("d2") + `<div class="spacer"></div>` + DYN("d3")) },
        async (p, snap, check, n, logs) => {
            await p.evaluate(() => { window.lazyGMapsConfig.push({ key: 'OTHER', zoom: 7 }); window.lazyGMapsConfig.push({ mapOptions: { scrollwheel: false } }); });
            await p.evaluate(() => document.getElementById("d2").scrollIntoView()); await p.waitForTimeout(300);
            await p.evaluate(() => document.getElementById("d3").scrollIntoView()); await p.waitForTimeout(300);
            const s = await snap(); const z = (id) => s.maps.find((m) => m.id === id);
            check("d1 built before: zoom 15; d2/d3 later: zoom 7 + mapOptions", z("d1").zoom === 15 && z("d2").zoom === 7 && z("d3").zoom === 7 && z("d3").opts.scrollwheel === false, s.maps);
            check("one script with original key", n.script === 1, n);
            check("late warning once", logs.filter((l) => l.includes("configuration was added after")).length === 1, logs);
            check("locked warning once", logs.filter((l) => l.includes("cannot change once a map has loaded")).length === 1, logs);
        });
    await run(b, "config: unknown setting warns (e.g. an old darkClass)", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', darkClass:'dark'}</script><script src="/lazy-gmaps.js" defer></script>`, EMBED) },
        async (p, snap, check, n, logs) => { check("warned, embed fine", logs.some((l) => l.includes('unknown setting "darkClass"')) && (await snap()).states[0] === "e1=ready", logs); });
    await run(b, "settings: load(el, settings) and scan(root, settings) affect only those maps; page-wide keys ignored", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', zoom: 12}</script><script src="/lazy-gmaps.js" defer></script>`,
            DYN("d1") + DYN("c1", `data-gmap-trigger="click" data-gmap-preview="none"`) + `<div id="host"></div>`) },
        async (p, snap, check, n, logs) => {
            await p.evaluate(() => {
                LazyGMaps.load(document.getElementById("c1"), { zoom: 5, mapOptions: { gestureHandling: "none" }, key: "NOPE", marker: "/x.png" });
                document.getElementById("host").innerHTML = '<div id="a1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="1" data-gmap-lng="2"></div>';
                LazyGMaps.scan(document.getElementById("host"), { zoom: 3 });
            });
            await p.waitForTimeout(400);
            const s = await snap(); const m = (id) => s.maps.find((x) => x.id === id);
            check("c1 zoom 5 + options, d1 zoom 12, a1 zoom 3", m("c1").zoom === 5 && m("c1").opts.gestureHandling === "none" && m("d1").zoom === 12 && m("a1").zoom === 3, s.maps);
            check("marker per call", s.markers.find((x) => x.host === "c1").icon === "https://site.test/x.png", s.markers);
            check("key ignored + warned", n.script === 1 && logs.some((l) => l.includes('"key" is a page-wide setting')), { n, logs });
        });
    await run(b, "config: window.lazyGMapsConfig as an array of objects (push pattern)", {
        html: doc(`<script>(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ key: 'A', zoom: 10 });</script>
            <script>(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ key: 'B' });</script><script src="/lazy-gmaps.js" defer></script>`, EMBED) },
        async (p, snap, check, n) => { check("key B, zoom 10", q(n.embedReq[0], "key") === "B" && q(n.embedReq[0], "zoom") === "10", n.embedReq); });

    // ===================== lifecycle API =====================
    await run(b, "api: ready() resolves with the map once built (called before it exists)", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`,
            `<div class="spacer"></div>` + DYN("d1") + `<script>document.addEventListener('DOMContentLoaded', () => LazyGMaps.ready(document.getElementById('d1')).then((i) => { window.__readyMap = !!(i && i.map && i.marker); }));</script>`) },
        async (p, snap, check) => {
            check("not yet", (await p.evaluate(() => window.__readyMap)) === undefined);
            await p.evaluate(() => document.getElementById("d1").scrollIntoView()); await p.waitForTimeout(400);
            check("resolved with map + marker", (await p.evaluate(() => window.__readyMap)) === true);
            check("already-ready map resolves immediately", await p.evaluate(() => LazyGMaps.ready(document.getElementById("d1")).then((i) => !!i.map)));
        });
    await run(b, "api: update() moves a dynamic map and marker without rebuilding", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")) },
        async (p, snap, check) => {
            await p.evaluate(() => LazyGMaps.update(document.getElementById("d1"), { lat: -33.33, lng: 115.64, zoom: 11 }));
            const r = await p.evaluate(() => ({ c: window.__setCenter, z: window.__setZoom, m: window.__markerPos, maps: window.__maps.length, attr: document.getElementById("d1").getAttribute("data-gmap-lat"), opt: LazyGMaps.options(document.getElementById("d1")).lat }));
            check("moved, still 1 map", r.c.lat === -33.33 && r.z === 11 && r.m.lng === 115.64 && r.maps === 1 && r.attr === "-33.33" && r.opt === -33.33, r);
        });
    await run(b, "api: update() on an embed reloads the free iframe; on a preview requests a new image", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, EMBED + DYN("c1", `data-gmap-trigger="click"`)) },
        async (p, snap, check, n) => {
            await p.evaluate(() => { LazyGMaps.update(document.getElementById("e1"), { lat: 5, lng: 6 }); LazyGMaps.update(document.getElementById("c1"), { zoom: 9 }); });
            await p.waitForTimeout(300);
            check("embed reloaded with new point", n.embedReq.length === 2 && q(n.embedReq[1], "q") === "5,6", n.embedReq);
            check("preview reloaded at zoom 9", n.staticReq.length === 2 && q(n.staticReq[1], "zoom") === "9", n.staticReq);
        });

    // ===================== modal destroy / recreate =====================
    const MODAL = `<button id="openA" onclick="openModal('A',-31.95,115.86)">A</button><button id="openB" onclick="openModal('B',-33.33,115.64)">B</button>
        <div id="modal" style="display:none"></div>
        <script>
            window.events = [];
            document.addEventListener('gmap:destroy', (e) => events.push('destroy:' + e.target.id + ':' + !!(e.detail && e.detail.map)));
            document.addEventListener('gmap:ready', (e) => events.push('ready:' + e.target.id));
            function openModal(name, lat, lng) {
                const m = document.getElementById('modal');
                m.innerHTML = '<div id="map' + name + '" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="' + lat + '" data-gmap-lng="' + lng + '"></div>';
                m.style.display = 'block';
                LazyGMaps.scan(m);
            }
            function closeModal() {
                const m = document.getElementById('modal'), el = m.querySelector('[data-gmap]');
                if (el) LazyGMaps.destroy(el);
                m.innerHTML = ''; m.style.display = 'none';
            }
        </script>`;
    await run(b, "modal: open A, close, open B, close, open A again → a fresh map each time, one script", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, MODAL) },
        async (p, snap, check, n) => {
            await p.click("#openA"); await p.waitForTimeout(300);
            await p.evaluate(() => closeModal());
            await p.click("#openB"); await p.waitForTimeout(300);
            await p.evaluate(() => closeModal());
            await p.click("#openA"); await p.waitForTimeout(300);
            const r = await p.evaluate(() => ({ events: window.events, maps: window.__maps.map((m) => m.id + ':' + m.center.lat), cleared: window.__cleared, removedMarkers: window.__mapObjs.length }));
            check("3 maps with the right centres", r.maps.join() === "mapA:-31.95,mapB:-33.33,mapA:-31.95", r.maps);
            check("events in order, destroy carries the map", r.events.join() === "ready:mapA,destroy:mapA:true,ready:mapB,destroy:mapB:true,ready:mapA", r.events);
            check("listeners cleared on destroy", r.cleared === 2, r.cleared);
            check("Maps script loaded once", n.script === 1, n);
        });
    await run(b, "modal: same element destroyed then loaded again → state reset, then a second map", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")) },
        async (p, snap, check) => {
            const r = await p.evaluate(async () => {
                const el = document.getElementById("d1");
                LazyGMaps.destroy(el);
                const afterDestroy = { state: el.getAttribute("data-gmap-state"), get: LazyGMaps.get(el), canvases: el.querySelectorAll(".lgm-canvas").length };
                LazyGMaps.load(el);
                await Promise.race([LazyGMaps.ready(el), new Promise((r) => setTimeout(r, 1500))]);
                return { afterDestroy, maps: window.__maps.length, state: el.getAttribute("data-gmap-state") };
            });
            check("clean slate after destroy", r.afterDestroy.state === null && r.afterDestroy.get === null && r.afterDestroy.canvases === 0, r.afterDestroy);
            check("rebuilt", r.maps === 2 && r.state === "ready", r);
        });
    await run(b, "modal: closed while the Maps API is still loading → no map is built afterwards", { scriptDelay: 500,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, MODAL), wait: 200 },
        async (p, snap, check) => {
            await p.click("#openA"); await p.waitForTimeout(100);
            await p.evaluate(() => closeModal()); await p.waitForTimeout(800);
            check("no map", (await snap()).maps.length === 0);
        });

    await run(b, "modal: destroyed (element kept on the page) while the API is loading → no map is built", { scriptDelay: 500, midLoad: true,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")), wait: 200 },
        async (p, snap, check) => {
            await p.evaluate(() => LazyGMaps.destroy(document.getElementById("d1"))); await p.waitForTimeout(800);
            const s = await snap(); check("no map, no state", s.maps.length === 0 && s.states[0] === "d1=null", s);
        });

    // ===================== dark mode =====================
    const DARKCFG = `<script>window.lazyGMapsConfig={key:'K', styles:{ default:[{featureType:'poi',stylers:[{visibility:'off'}]}], "default/dark":[{featureType:'all',stylers:[{invert_lightness:true}]}], hobble:[{featureType:'road',stylers:[{saturation:-50}]}], "hobble/dark":[{featureType:'road',stylers:[{lightness:-80}]}], plain:[{featureType:'water',stylers:[{saturation:10}]}] }}</script><script src="/lazy-gmaps.js" defer></script>`;
    await run(b, "dark: browser dark → name/dark pairs; set without a dark pair stays; checked at setup only", { colorScheme: "dark",
        html: doc(DARKCFG, DYN("d1") + DYN("d2", `data-gmap-style="hobble"`) + DYN("d3", `data-gmap-style="plain"`) + DYN("c1", `data-gmap-trigger="click"`)) },
        async (p, snap, check, n) => {
            const s = await snap(); const st = (id) => s.maps.find((m) => m.id === id).styles[0];
            check("default/dark, hobble/dark, plain", st("d1").featureType === "all" && st("d2").stylers[0].lightness === -80 && st("d3").featureType === "water", s.maps);
            check("preview uses the dark pair", q(n.staticReq[0], "style") === "feature:all|invert_lightness:true", n.staticReq);
            check("no colorScheme on styled maps", s.maps.every((m) => m.opts.colorScheme === undefined), s.maps);
            await p.emulateMedia({ colorScheme: "light" }); await p.waitForTimeout(200);
            check("no live switching", (await p.evaluate(() => window.__setOptions)) === undefined && n.staticReq.length === 1);
        });
    await run(b, "dark: browser light → light sets", {
        html: doc(DARKCFG, DYN("d1") + DYN("d2", `data-gmap-style="hobble"`)) },
        async (p, snap, check) => { const s = await snap(); check("light", s.maps[0].styles[0].featureType === "poi" && s.maps[1].styles[0].stylers[0].saturation === -50, s.maps); });
    await run(b, "dark: unstyled maps get Google's FOLLOW_SYSTEM; Map ID and mapOptions.colorScheme are respected", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`,
            DYN("d1") + DYN("d2", `data-gmap-map-id="abc"`) + DYN("d3", `data-gmap-options='{"colorScheme":"LIGHT"}'`)) },
        async (p, snap, check, n) => {
            const s = await snap(); const o = (id) => s.maps.find((m) => m.id === id).opts;
            check("d1 FOLLOW_SYSTEM, d2 none, d3 LIGHT", o("d1").colorScheme === "FOLLOW_SYSTEM" && o("d2").colorScheme === undefined && o("d3").colorScheme === "LIGHT", s.maps);
            check("core imported", await p.evaluate(() => window.__libs.includes("core")));
        });
    await run(b, "dark: darkMode false → light sets and no colorScheme", { colorScheme: "dark",
        html: doc(DARKCFG.replace("key:'K',", "key:'K', darkMode:false,"), DYN("d1") + DYN("d2", `data-gmap-style="none-such"`)) },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("default styles", s.maps[0].styles[0].featureType === "poi" && s.maps[0].opts.colorScheme === undefined, s.maps);
            check("missing set → default + console error", s.maps[1].styles[0].featureType === "poi" && logs.some((l) => l.includes('no style set "none-such"')), logs);
        });

    // ===================== popup templates =====================
    await run(b, "popup: global template filled with escaped title and text; per-map template overrides", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', popupTemplate:'#pop'}</script><script src="/lazy-gmaps.js" defer></script>`,
            `<template id="pop"><div class="card"><h3 data-gmap-field="title"></h3><p data-gmap-field="popup"></p></div></template>
             <template id="other"><em data-gmap-field="popup"></em></template>` +
            DYN("d1", `data-gmap-title="Lot <b>460</b>" data-gmap-popup="Open <img src=x onerror=alert(1)> Sat"`) +
            DYN("d2", `data-gmap-popup="Custom" data-gmap-popup-template="#other"`)) },
        async (p, snap, check) => {
            const s = await snap();
            check("global template used + escaped", s.info[0].html === '<div class="card"><h3 data-gmap-field="title">Lot &lt;b&gt;460&lt;/b&gt;</h3><p data-gmap-field="popup">Open &lt;img src=x onerror=alert(1)&gt; Sat</p></div>', s.info[0]);
            check("per-map template", s.info[1].html === '<em data-gmap-field="popup">Custom</em>', s.info[1]);
        });
    await run(b, "popup: global template only for maps with popup text", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', popupTemplate:'#pop'}</script><script src="/lazy-gmaps.js" defer></script>`,
            `<template id="pop"><b data-gmap-field="popup"></b></template>` + DYN("d1", `data-gmap-title="No popup"`) + DYN("d2", `data-gmap-popup="Yes"`)) },
        async (p, snap, check) => { const s = await snap(); check("one popup", s.info.length === 1 && s.info[0].html.includes("Yes"), s.info); });
    await run(b, "popup: no template → plain text in Google's popup", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1", `data-gmap-popup="Hello"`)) },
        async (p, snap, check) => { const s = await snap(); check("text", s.info[0].html === "Hello", s.info); });

    // ===================== server-rendered fallback =====================
    const SERVER = `<div id="d1" class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="-31.95" data-gmap-lng="115.86">
        <a data-gmap-placeholder href="https://www.google.com/maps/search/?api=1&amp;query=-31.95,115.86">Open in Google Maps</a>
            <p class="address">123 Example St</p></div>`;
    await run(b, "server fallback: helper adds nothing of its own; marked link removed on load, unmarked text kept", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, SERVER) },
        async (p, snap, check) => {
            const r = await p.evaluate(() => ({ own: document.querySelectorAll(".lgm-placeholder").length, link: !!document.querySelector("#d1 a"), addr: !!document.querySelector("#d1 .address"), state: document.getElementById("d1").getAttribute("data-gmap-state") }));
            check("ready, no helper placeholder, link gone, address kept", r.state === "ready" && r.own === 0 && !r.link && r.addr, r);
        });
    await run(b, "server fallback: JavaScript disabled → the server-rendered link is there and nothing billable loads", { noJs: true,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, SERVER) },
        async (p, snap, check, n) => {
            const r = await p.evaluate(() => ({ link: document.querySelector("#d1 a").href, visible: !!document.querySelector("#d1 a").offsetParent }));
            check("link present", r.link.startsWith("https://www.google.com/maps/search/") && r.visible, r);
            check("no Google requests", n.script === 0 && n.staticReq.length === 0 && n.embedReq.length === 0, n);
        });
    await run(b, "server fallback: a bot sees the server link and gets no billable requests", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', isBot: () => true}</script><script src="/lazy-gmaps.js" defer></script>`, SERVER) },
        async (p, snap, check, n) => {
            const r = await p.evaluate(() => ({ link: !!document.querySelector("#d1 a"), state: document.getElementById("d1").getAttribute("data-gmap-state") }));
            check("skipped, link kept", r.state === "skipped" && r.link && n.script === 0 && n.staticReq.length === 0, { r, n });
        });

    await run(b, "csp: strict nonce policy → helper stylesheet and Google loader both allowed", {
        csp: true,
        html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-abc123' 'strict-dynamic'; style-src 'nonce-abc123'; object-src 'none'">
            <style nonce="abc123">.map{height:300px;width:600px}</style>
            <script nonce="abc123">window.lazyGMapsConfig={key:'K'}</script><script nonce="abc123" src="/lazy-gmaps.js" defer></script></head>
            <body>${DYN("d1")}${DYN("c1", 'data-gmap-trigger="click"')}</body></html>` },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            const css = await p.evaluate(() => getComputedStyle(document.getElementById("d1")).position);
            check("both maps ok, CSS applied, no CSP errors", s.states.join() === "d1=ready,c1=preview" && css === "relative" && !logs.some((l) => /Content Security Policy/i.test(l)), { s, css, logs });
        });

    await run(b, "small: popup text on a map with an init function brings the marker back", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script>function noop(){}</script>`, DYN("d1", `data-gmap-init="noop" data-gmap-popup="Hi"`)) },
        async (p, snap, check) => { const s = await snap(); check("marker + popup", s.markers.length === 1 && s.info.length === 1, s); });
    await run(b, "small: an isBot override that throws falls back to the built-in check", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', isBot: () => { throw new Error('x'); }}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")) },
        async (p, snap, check, n, logs) => { const s = await snap(); check("map loaded, error logged", s.states[0] === "d1=ready" && logs.some((l) => l.includes("isBot threw")), { s, logs }); });
    await run(b, "small: data-gmap-trigger=\"CLICK\" (any case) shows the button", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1", `data-gmap-trigger="CLICK" data-gmap-preview="none"`)) },
        async (p, snap, check) => { check("button visible", await p.isVisible("#d1 [data-gmap-load]")); });
    await run(b, "small: invalid attributes corrected, then Show map → map loads", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, `<div id="d1" class="map" data-gmap data-gmap-mode="dynamic"></div>`) },
        async (p, snap, check) => {
            check("error first", (await snap()).states[0] === "d1=error");
            await p.evaluate(() => { const el = document.getElementById("d1"); el.setAttribute("data-gmap-lat", "1"); el.setAttribute("data-gmap-lng", "2"); });
            check("no visible button in error", !(await p.isVisible("#d1 [data-gmap-load]")));
            await p.evaluate(() => LazyGMaps.load(document.getElementById("d1"))); await p.waitForTimeout(400);
            check("load() after fixing → ready", (await snap()).states[0] === "d1=ready");
        });

    // ===================== never throw, isolate failures =====================
    await run(b, "robust: public API never throws on bad input", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")) },
        async (p, snap, check, n, logs) => {
            const r = await p.evaluate(async () => {
                const out = [];
                for (const f of [() => LazyGMaps.load(null), () => LazyGMaps.load("x"), () => LazyGMaps.scan("nope"), () => LazyGMaps.update(null, {}), () => LazyGMaps.update(document.body, null),
                    () => LazyGMaps.destroy(42), () => LazyGMaps.get(undefined), () => LazyGMaps.options({}), () => LazyGMaps.ready(null)]) {
                    try { const v = f(); if (v && v.then) await v; out.push("ok"); } catch (e) { out.push("threw " + e.message); }
                }
                return out;
            });
            check("all ok", r.every((x) => x === "ok"), r);
            check("map unaffected", (await snap()).states[0] === "d1=ready");
        });
    await run(b, "robust: one map's init throws synchronously inside setup → other maps unaffected", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script>function boom(){ throw new Error('boom'); } function ok(m,c){(window.calls=window.calls||[]).push('ok')}</script>`,
            DYN("d1", `data-gmap-init="boom"`) + DYN("d2", `data-gmap-init="ok"`) + EMBED) },
        async (p, snap, check) => { const s = await snap(); check("all ready", s.states.join() === "d1=ready,d2=ready,e1=ready" && s.calls.join() === "ok", s); });
    await run(b, "robust: listener for gmap:ready that throws does not break the map", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script>document.addEventListener('gmap:loading', () => { throw new Error('site bug'); });</script>`, DYN("d1") + EMBED) },
        async (p, snap, check) => { const s = await snap(); check("ready", s.states.join() === "d1=ready,e1=ready", s); });
    await run(b, "robust: static preview image fails → plain Show map button, click still loads", {
        files: {}, failStatic: true,
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("c1", `data-gmap-trigger="click"`)) },
        async (p, snap, check, n, logs) => {
            check("waiting + button visible", (await snap()).states[0] === "c1=waiting" && await p.isVisible("#c1 [data-gmap-load]") && !(await p.$("#c1 .lgm-preview")), { logs });
            await p.click("#c1 [data-gmap-load]"); await p.waitForTimeout(300);
            check("ready", (await snap()).states[0] === "c1=ready");
        });
    await run(b, "robust: included twice → warning, one copy runs", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script src="/lazy-gmaps.js?2" defer></script>`, DYN("d1")) },
        async (p, snap, check, n, logs) => { check("one map + warning", (await snap()).maps.length === 1 && logs.some((l) => l.includes("included more than once")), logs); });

    // ===================== pre-release review fixes =====================
    await run(b, "review: scan(el, settings) from a deferred script before start keeps its settings", {
        files: { "/site.js": "LazyGMaps.scan(document.getElementById('d1'), { zoom: 7 });" },
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script src="/site.js" defer></script>`, DYN("d1")) },
        async (p, snap, check) => { const s = await snap(); check("map built at zoom 7", s.states[0] === "d1=ready" && s.maps.length === 1 && s.maps[0].zoom === 7, s); });
    await run(b, "review: after the key is rejected, a click map scrolled into view requests no static preview", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1") + `<div class="spacer"></div>` + DYN("c1", `data-gmap-trigger="click"`)) },
        async (p, snap, check, n) => {
            await p.evaluate(() => window.gm_authFailure());
            await p.evaluate(() => document.getElementById("c1").scrollIntoView()); await p.waitForTimeout(400);
            const s = await snap();
            check("no static request, c1 in error", n.staticReq.length === 0 && s.states.join() === "d1=error,c1=error", { s, n });
        });
    await run(b, "review: an invalid rootMargin is reported and the default is used", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K', rootMargin:'200'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("d1")) },
        async (p, snap, check, n, logs) => {
            const s = await snap();
            check("map ready, error logged, no page error", s.states[0] === "d1=ready" && logs.some((l) => l.includes('rootMargin "200" is not valid')) && !logs.some((l) => l.startsWith("pageerror")), { s, logs });
        });
    await run(b, "review: a map inside a hidden parent does not warn about zero height", {
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, `<div style="display:none">${DYN("d1")}</div>`) },
        async (p, snap, check, n, logs) => { check("no zero-height warning", !logs.some((l) => l.includes("zero height")), logs); });
    await run(b, "review: the static preview image sends the referrer, like the embed iframe", {
        html: doc(`<meta name="referrer" content="same-origin"><script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`, DYN("c1", `data-gmap-trigger="click"`)) },
        async (p, snap, check, n) => {
            const rp = await p.evaluate(() => { const i = document.querySelector("#c1 .lgm-preview img"); return i && i.referrerPolicy; });
            check("referrerPolicy set", rp === "no-referrer-when-downgrade" && n.staticReq.length === 1, { rp, n });
        });

    // ===================== second review (ChatGPT) =====================
    const CFG = `<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`;
    const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    await run(b, "review2: container removed while loading, re-added and scanned → exactly one map", { scriptDelay: 1500, midLoad: true,
        html: doc(CFG, `<div id="host">${DYN("d1")}</div>`) },
        async (p, snap, check) => {
            const before = await p.evaluate(() => document.getElementById("d1").getAttribute("data-gmap-state"));
            await p.evaluate(() => { window.__d1 = document.getElementById("d1"); __d1.remove(); });
            await p.waitForTimeout(1800);                      // the load finishes while detached
            await p.evaluate(() => { document.getElementById("host").appendChild(__d1); LazyGMaps.scan(document.getElementById("host")); LazyGMaps.scan(document); LazyGMaps.load(__d1); });
            await p.waitForTimeout(800);
            const s = await snap();
            check("was loading, then one map, ready", before === "loading" && s.maps.length === 1 && s.states.join() === "d1=ready", { before, s });
        });
    await run(b, "review2: container removed and re-added while loading → exactly one map", { scriptDelay: 1000, midLoad: true,
        html: doc(CFG, `<div id="host">${DYN("d1")}</div>`) },
        async (p, snap, check) => {
            await p.evaluate(() => { const d = document.getElementById("d1"); d.remove(); document.getElementById("host").appendChild(d); LazyGMaps.scan(document); LazyGMaps.load(d); });
            await p.waitForTimeout(1500);
            const s = await snap();
            check("one map, ready", s.maps.length === 1 && s.states.join() === "d1=ready", s);
        });
    await run(b, "review2: load() from site code does not bill a bot; the Show map click does", { ua: BOT,
        html: doc(CFG, `<div id="host"></div>`) },
        async (p, snap, check, n) => {
            await p.evaluate(() => {
                const el = document.createElement("div"); el.id = "m1"; el.className = "map";
                el.setAttribute("data-gmap", ""); el.setAttribute("data-gmap-mode", "dynamic"); el.setAttribute("data-gmap-lat", "1"); el.setAttribute("data-gmap-lng", "2");
                document.getElementById("host").appendChild(el);
                LazyGMaps.load(el); LazyGMaps.load(el, { zoom: 3 }); LazyGMaps.load(el, undefined, true);
            });
            await p.waitForTimeout(400);
            let s = await snap();
            check("skipped, nothing requested", s.states.join() === "m1=skipped" && n.script === 0 && s.maps.length === 0, { s, n });
            await p.click("#m1 [data-gmap-load]"); await p.waitForTimeout(500);
            s = await snap();
            check("click loads it", s.states.join() === "m1=ready" && n.script === 1 && s.maps.length === 1, { s, n });
        });
    await run(b, "review2: ready() resolves null for a map in error, and when a loading map fails", { scriptDelay: 800, midLoad: true,
        html: doc(CFG, DYN("d1") + `<div id="bad" class="map" data-gmap data-gmap-mode="dynamic"></div>`) },
        async (p, snap, check) => {
            const r = await p.evaluate(async () => {
                const bad = await LazyGMaps.ready(document.getElementById("bad"));
                const d1 = document.getElementById("d1"), state = d1.getAttribute("data-gmap-state");
                const pending = LazyGMaps.ready(d1);
                if (state !== "loading") return { notLoading: state };
                window.gm_authFailure();                              // installed when the API load started
                const timeout = new Promise((res) => setTimeout(() => res("still pending"), 1500));
                return { bad, d1: await Promise.race([pending, timeout]) };
            });
            check("both null", r.bad === null && r.d1 === null, r);
        });
    await run(b, "review2: after auth failure get() is null, the marker is detached and load() builds nothing", {
        html: doc(CFG, DYN("d1", `data-gmap-popup="Hi"`)) },
        async (p, snap, check, n, logs) => {
            const r = await p.evaluate(() => {
                const el = document.getElementById("d1"), before = LazyGMaps.get(el), marker = before && before.marker;
                window.gm_authFailure(); window.gm_authFailure();
                LazyGMaps.load(el);
                return { had: !!(before && before.map), after: LazyGMaps.get(el), removed: !!(marker && marker.removed) };
            });
            await p.waitForTimeout(300);
            const s = await snap();
            const authLogs = logs.filter((l) => l.includes("Google rejected the API key")).length;
            check("get() null, marker detached, one map, error, logged once", r.had && r.after === null && r.removed && s.maps.length === 1 && s.states.join() === "d1=error" && authLogs === 1, { r, s, authLogs });
        });
    await run(b, "review2: update() with invalid values changes nothing and logs an error", {
        html: doc(CFG, DYN("d1")) },
        async (p, snap, check, n, logs) => {
            const r = await p.evaluate(() => {
                const el = document.getElementById("d1");
                LazyGMaps.update(el, { lat: "not-a-number", zoom: 12 });
                LazyGMaps.update(el, { lat: 95 });
                LazyGMaps.update(el, { zoom: 40 });
                LazyGMaps.update(el, { lng: "" });
                const o = LazyGMaps.options(el);
                const kept = { lat: o.lat, lng: o.lng, zoom: o.zoom, attr: el.getAttribute("data-gmap-lat"), setCenter: window.__setCenter };
                LazyGMaps.update(el, { lat: -32, zoom: 9 });
                return { kept, after: { lat: LazyGMaps.options(el).lat, zoom: window.__setZoom } };
            });
            check("bad updates ignored, good update applied", r.kept.lat === -31.95 && r.kept.lng === 115.86 && r.kept.zoom === 15 && r.kept.attr === "-31.95" && r.kept.setCenter === undefined &&
                r.after.lat === -32 && r.after.zoom === 9 && logs.filter((l) => l.includes("update() ignored")).length === 4, { r, logs });
        });
    await run(b, "review2: a Maps script added by another plugin after ours blocks later dynamic maps", {
        html: doc(CFG, DYN("d1") + `<div id="host"></div>`) },
        async (p, snap, check, n) => {
            await p.evaluate(() => {
                const t = document.createElement("script"); t.type = "text/plain"; t.src = "https://maps.googleapis.com/maps/api/js?key=OTHER&callback=initMap"; document.head.appendChild(t);
                const el = document.createElement("div"); el.id = "d2"; el.className = "map";
                el.setAttribute("data-gmap", ""); el.setAttribute("data-gmap-mode", "dynamic"); el.setAttribute("data-gmap-lat", "1"); el.setAttribute("data-gmap-lng", "2");
                el.addEventListener("gmap:error", (e) => { window.__reason = e.detail.reason; });
                document.getElementById("host").appendChild(el); LazyGMaps.load(el);
            });
            await p.waitForTimeout(300);
            const s = await snap();
            check("d1 kept, d2 blocked, one map", s.states.join() === "d1=ready,d2=error" && (await p.evaluate(() => window.__reason)) === "blocked" && s.maps.length === 1, s);
        });
    await run(b, "review2: an exception in the embed's load handling is logged, not thrown", {
        html: doc(CFG + `<script>const sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function (k, v) { if (this.id === "e1" && k === "data-gmap-state" && v === "ready") throw new Error("site patch"); return sa.call(this, k, v); };</script>`, EMBED) },
        async (p, snap, check, n, logs) => {
            check("no page error, logged", !logs.some((l) => l.startsWith("pageerror")) && logs.some((l) => l.includes("the embed could not be shown")), logs);
        });
    await run(b, "review2: scan() and load() with settings, both before start, each keep their settings", {
        files: { "/site.js": "LazyGMaps.scan(document.getElementById('d1'), { zoom: 7 }); LazyGMaps.load(document.getElementById('d2'), { zoom: 8 });" },
        html: doc(`<script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script><script src="/site.js" defer></script>`, DYN("d1") + DYN("d2")) },
        async (p, snap, check) => {
            const s = await snap();
            const z = Object.fromEntries(s.maps.map((m) => [m.id, m.zoom]));
            check("d1 zoom 7, d2 zoom 8, two maps", s.maps.length === 2 && z.d1 === 7 && z.d2 === 8 && s.states.join() === "d1=ready,d2=ready", s);
        });

    // ===================== placeholder look =====================
    await run(b, "placeholder: pill over the pattern, theme button rules don't apply, custom properties do", {
        // The pattern is made hit-testable here so elementFromPoint reports whichever layer is on top.
        html: doc(`<style>button{background:#0040a8;color:#fff;border-radius:0;text-transform:uppercase;font-family:Georgia}
            .lgm-placeholder::before{pointer-events:auto!important}</style>
            <script>window.lazyGMapsConfig={key:'K'}</script><script src="/lazy-gmaps.js" defer></script>`,
            DYN("c1", `data-gmap-trigger="click" data-gmap-preview="none"`) +
            DYN("c2", `data-gmap-trigger="click" data-gmap-preview="none" style="--lgm-pin:#0040a8;--lgm-button-bg:#000;--lgm-pattern:0"`)) },
        async (p, snap, check) => {
            const r = await p.evaluate(() => ["c1", "c2"].map((id) => {
                const box = document.querySelector("#" + id + " .lgm-placeholder"), btn = box.querySelector("[data-gmap-load]");
                const bs = getComputedStyle(btn), ps = getComputedStyle(box, "::before"), rect = btn.getBoundingClientRect();
                const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return { first: box.firstElementChild === btn, svg: !!btn.querySelector("svg"), text: btn.textContent, bg: bs.backgroundColor,
                    radius: bs.borderRadius, transform: bs.textTransform, display: bs.display, onTop: btn.contains(top),
                    fill: getComputedStyle(btn.querySelector("svg")).fill, pattern: /repeating-linear-gradient/.test(ps.backgroundImage), opacity: ps.opacity };
            }));
            const [a, c] = r;
            check("button first, pin + text, pill look, theme rule ignored", a.first && a.svg && a.text === "Show map" && a.bg === "rgb(255, 255, 255)" &&
                a.radius === "999px" && a.transform === "none" && a.display !== "none" && a.fill === "rgb(234, 67, 53)", a);
            check("pattern drawn under the button", a.pattern && a.opacity === "1" && a.onTop, a);
            check("custom properties: pin, background, pattern off", c.fill === "rgb(0, 64, 168)" && c.bg === "rgb(0, 0, 0)" && c.opacity === "0", c);
        });

    await b.close();
    console.log(`\n${total - failed}/${total} new-feature scenarios passed`);
    process.exit(failed ? 1 : 0);
})();
