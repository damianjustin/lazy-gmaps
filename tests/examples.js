// examples.html against the mocked Maps API: every map loads, the modal builds and destroys maps.
// Usage: node tests/examples.js lazy-gmaps.js examples.html
const { chromium } = require("playwright");
const fs = require("fs");
const [LIB, HTML] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const MOCK = fs.readFileSync(__dirname + "/suite.js", "utf8").match(/const MOCK_API = `([\s\S]*?)`;/)[1];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

(async () => {
    const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
    const ctx = await b.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", viewport: { width: 1280, height: 4000 } });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
    let scripts = 0;
    const logs = [];
    await ctx.route(/lazy-gmaps(\.min)?\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: LIB }));
    await ctx.route("https://site.test/**", (r) => r.request().url().endsWith(".png")
        ? r.fulfill({ contentType: "image/png", body: PNG }) : r.fulfill({ contentType: "text/html", body: HTML }));
    await ctx.route("https://maps.googleapis.com/maps/api/js**", (r) => { scripts++; return r.fulfill({ contentType: "text/javascript", body: MOCK }); });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
    p.on("pageerror", (e) => logs.push(e.message));
    await p.goto("https://site.test/");
    await p.waitForTimeout(600);

    const results = [];
    const check = (label, ok, info) => results.push({ label, ok: !!ok, info });
    const states = await p.evaluate(() => [...document.querySelectorAll("[data-gmap]")].map((e) => e.getAttribute("data-gmap-state")));
    check("all page maps ready", states.length === 4 && states.every((s) => s === "ready"), states);
    check("one Maps script", scripts === 1, scripts);
    check("init added its markers", await p.evaluate(() => window.__markers.length >= 5), null);

    await p.click("text=Head office"); await p.waitForTimeout(300);
    await p.click("dialog button"); await p.waitForTimeout(100);
    await p.click("text=Bunbury"); await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ maps: window.__maps.map((m) => m.center.lat), popups: window.__infoOpened, open: document.getElementById("map-dialog").open,
        hostMaps: document.querySelectorAll("#dialog-map-host [data-gmap]").length }));
    check("modal built a map per opening", r.maps.length === 6 && r.maps[4] === -31.9523 && r.maps[5] === -33.33 && r.open && r.hostMaps === 1, r);
    check("ready() opened each modal popup", r.popups === 3, r);   // the page's popup-open map, then two modal maps
    check("no console errors or warnings", logs.length === 0, logs);

    await b.close();
    const bad = results.filter((x) => !x.ok);
    results.forEach((x) => console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.label}${x.ok ? "" : "  " + JSON.stringify(x.info).slice(0, 500)}`));
    process.exit(bad.length ? 1 : 0);
})();
