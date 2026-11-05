/*! lazy-gmaps 0.1.0 (c) 2026 Damian Justin, MIT. Includes Google's Maps loader (c) Google LLC, Apache-2.0. */
(() => {
    "use strict";
    if (window.LazyGMaps) return console.warn("lazy-gmaps: loaded twice.");

    // Page-wide settings, from window.lazyGMapsConfig (an object, or an array of objects).
    const config = {
        key: "",
        v: "weekly",
        libraries: [],            // extra libraries to import before a map is built
        zoom: 15,
        mapId: "",
        styles: null,             // an array, or named sets: { default, "default/dark", name, "name/dark" }
        darkMode: true,           // follow the browser's dark mode
        mapOptions: {},           // google.maps.Map options for every map
        marker: "",               // default marker icon URL
        markerSize: "",           // marker display size, e.g. "24x33"
        rootMargin: "200px 0px",  // start loading this far before a map scrolls into view
        timeout: 20000,           // ms to wait for the Maps API
        loaderParams: {},         // language, region, authReferrerPolicy...
        isBot: null,              // function (userAgent) => boolean, replaces the built-in check
        css: true,
        linkText: "Open in Google Maps"
    };

    const maps = new WeakMap();   // container -> { o, state, map, marker, infoWindow }
    const said = new Set();
    let started = false, apiInstalled = false, authFailed = false, blocker = null, bot = null, observer = null;

    const once = id => !said.has(id) && !!said.add(id);
    const warn = (msg, ...x) => once(msg) && console.warn("lazy-gmaps: " + msg, ...x);   // each message once
    const error = (msg, ...x) => console.error("lazy-gmaps: " + msg, ...x);
    const isObject = v => !!v && typeof v === "object" && !Array.isArray(v);

    function readConfig() {
        [].concat(window.lazyGMapsConfig || []).forEach(part => {
            for (const k in part) k in config ? (config[k] = part[k]) : warn(`unknown setting "${k}" ignored.`);
        });
        if (!config.key) warn("set lazyGMapsConfig.key.");
    }

    // ---- bots ----------------------------------------------------------------------------------
    // Crawlers, link previews, automation, HTTP libraries, audits, monitors and AI fetchers, plus
    // Chrome older than 100 (real Chrome updates itself). Bots get the link, never a billed map.
    const BOT_UA = new RegExp("bot|agent|crawl|spider|slurp|external|whatsapp|preview|headless|phantom|selenium|" +
        "puppeteer|playwright|curl|wget|python|java|axios|node-fetch|libwww|http|lighthouse|" +
        "pagespeed|inspect|monitor|uptime|scan|chatgpt-user|claude-|perplexity-user|mediapartners|googleother|" +
        "google-extended|feedfetcher|apis-google|ia_archiver", "i");

    function isBot() {
        const ua = navigator.userAgent || "";
        if (typeof config.isBot === "function") {
            try { return !!config.isBot(ua); } catch (e) { error("isBot failed.", e); }
        }
        const chrome = ua.match(/(?:chrome|chromium|crios)\/(\d+)/i);
        return !ua || navigator.webdriver === true || BOT_UA.test(ua.replace(/cubot/gi, "")) || (!!chrome && +chrome[1] < 100);
    }

    // ---- container ---------------------------------------------------------------------------
    // A map's attributes. An init function gets these as ctx.options.
    function read(el) {
        const a = name => (el.getAttribute("data-gmap-" + name) || "").trim();
        const zoom = parseInt(a("zoom"), 10);
        let options;
        try { options = JSON.parse(a("options") || "{}"); } catch (e) { /* reported below */ }
        if (!isObject(options)) { error("data-gmap-options is not a JSON object.", el); options = {}; }
        const mapOptions = { ...config.mapOptions, ...options };
        return {
            lat: parseFloat(a("lat")),
            lng: parseFloat(a("lng")),
            zoom: isFinite(zoom) ? zoom : config.zoom,
            init: a("init"),
            title: a("title") || el.getAttribute("aria-label") || "",
            marker: a("marker"),
            markerSize: a("marker-size") || config.markerSize,
            popup: a("popup"),
            popupOpen: el.hasAttribute("data-gmap-popup-open"),
            style: a("style"),
            mapId: a("map-id") || mapOptions.mapId || config.mapId,
            libraries: a("libraries").split(","),
            mapOptions
        };
    }

    // A link to Google Maps until the map draws, and for bots and errors. Content already in the
    // container (a server-rendered fallback) is kept instead.
    function addLink(el, o) {
        if (el.children.length || el.textContent.trim() || !isFinite(o.lat) || !isFinite(o.lng)) return;
        const box = document.createElement("div"), a = document.createElement("a");
        box.className = "lgm-fallback";
        a.href = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = config.linkText;
        box.append(a);
        el.append(box);
    }

    function set(el, rec, state, detail) {
        rec.state = state;
        el.setAttribute("data-gmap-state", state);
        el.dispatchEvent(new CustomEvent("gmap:" + state, { bubbles: true, detail }));
    }

    function release(rec) {
        try {
            rec.infoWindow?.close();
            if (rec.marker) rec.marker.setMap ? rec.marker.setMap(null) : (rec.marker.map = null);
            if (rec.map) google.maps.event.clearInstanceListeners(rec.map);
        } catch (e) { /* discarded anyway */ }
        rec.map = rec.marker = rec.infoWindow = null;
    }

    // The last layer: no map, just the link. Visitors see no error; the reason goes to the
    // console and the gmap:error event. The container never builds again until destroy().
    function fallback(el, rec, reason, err = null) {
        release(rec);
        el.querySelector(":scope>.lgm-canvas")?.remove();
        addLink(el, rec.o);
        set(el, rec, "error", { reason, error: err });
    }

    // Another script that loads Google Maps (an old theme tag, a plugin). Two copies of the API
    // break each other, so maps stay as links until it is removed.
    function otherMapsScript() {
        for (const s of document.querySelectorAll('script[src*="/maps/api/js"]')) {
            if (/maps\.google(apis)?\.com\/maps\/api\/js/.test(s.src) && !s.src.includes("callback=google.maps.__ib__")) return s;
        }
        const m = !apiInstalled && window.google?.maps;
        return m && (m.Map || m.importLibrary) ? "window.google.maps" : null;
    }

    function blocked(el, rec) {
        blocker = blocker || otherMapsScript();
        if (blocker && once("blocked")) error("another script loads Google Maps; remove it.", blocker);
        const reason = blocker ? "blocked" : authFailed ? "auth" : "";
        if (reason) fallback(el, rec, reason);
        return !!reason;
    }

    // ---- Google Maps ---------------------------------------------------------------------------
    function installApi() {
        if (apiInstalled) return;
        apiInstalled = true;
        // Google's bootstrap loader, unmodified: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
        (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key: config.key, v: config.v, ...config.loaderParams });

        // Google calls gm_authFailure() for key, referrer and billing errors. A site's own handler still runs.
        let siteHook = window.gm_authFailure;
        function onAuthFailure() {
            if (!authFailed) error("Google rejected the API key.");
            authFailed = true;
            document.querySelectorAll("[data-gmap]").forEach(el => {
                const rec = maps.get(el);
                if (rec && (rec.state === "loading" || rec.state === "ready")) fallback(el, rec, "auth");
            });
            if (typeof siteHook === "function") return siteHook.apply(this, arguments);
        }
        try {
            Object.defineProperty(window, "gm_authFailure", { configurable: true, get: () => onAuthFailure, set: f => { siteHook = f; } });
        } catch (e) { window.gm_authFailure = onAuthFailure; }
    }

    function importLibraries(o) {
        installApi();
        const names = new Set(`maps,marker,${config.libraries},${o.libraries}`.split(",").map(s => s.trim()));   // arrays or comma lists
        names.delete("");
        return Promise.race([
            Promise.all([...names].map(n => google.maps.importLibrary(n))),
            new Promise((_, no) => setTimeout(() => no(Error("timed out")), config.timeout))
        ]);
    }

    // Named style set from data-gmap-style (else "default"); "<name>/dark" wins in dark mode.
    function stylesFor(o) {
        const s = config.styles;
        if (!isObject(s)) return s || null;
        let name = o.style || "default";
        if (!s[name]) { if (o.style) error(`no style set "${name}".`); name = "default"; }
        const dark = config.darkMode && matchMedia("(prefers-color-scheme: dark)").matches;
        return (dark && s[name + "/dark"]) || s[name] || null;
    }

    function addMarker(rec, o, advanced) {
        const g = google.maps, position = { lat: o.lat, lng: o.lng }, title = o.title;
        const url = /^(show)?$/i.test(o.marker) ? config.marker : o.marker;
        const size = /^(\d+)(?:x(\d+))?$/i.exec(o.markerSize), w = size && +size[1], h = size && +(size[2] || size[1]);
        if (advanced && g.marker?.AdvancedMarkerElement) {   // a Map ID needs advanced markers
            let content;
            if (url) {
                content = document.createElement("img");
                Object.assign(content, { src: url, alt: "" }, size && { width: w, height: h });
            }
            rec.marker = new g.marker.AdvancedMarkerElement({ map: rec.map, position, title, content, gmpClickable: true });
        } else {
            rec.marker = new g.Marker({ map: rec.map, position, title, icon: url && size ? { url, scaledSize: new g.Size(w, h) } : url || undefined });
        }
        if (!o.popup) return;
        const text = document.createElement("div");
        text.textContent = o.popup;   // text, never HTML
        rec.infoWindow = new g.InfoWindow({ content: text });
        const open = () => rec.infoWindow.open({ map: rec.map, anchor: rec.marker });
        const m = rec.marker;   // advanced markers are elements and take gmp-click
        m.addEventListener ? m.addEventListener("gmp-click", open) : m.addListener("click", open);
        if (o.popupOpen) open();
    }

    // data-gmap-init names a global function (or dotted path), called as fn(map, ctx) once the
    // base map exists. If it is missing or fails, the base map stays and the console says why.
    async function runInit(el, rec) {
        const name = rec.o.init;
        if (!name) return;
        const fn = name.split(".").reduce((x, k) => x?.[k], window);
        if (typeof fn !== "function") return error(`data-gmap-init "${name}" not found.`, el);
        try {
            await fn.call(window, rec.map, { el, options: rec.o, marker: rec.marker, infoWindow: rec.infoWindow, google });
        } catch (e) {
            error(`data-gmap-init "${name}" failed.`, e, el);
        }
    }

    function build(el, rec) {
        const o = rec.o, g = google.maps;
        const opts = { ...o.mapOptions, center: { lat: o.lat, lng: o.lng }, zoom: o.zoom };
        if (o.mapId) { opts.mapId = o.mapId; delete opts.styles; }
        else opts.styles = opts.styles || stylesFor(o);
        if (!opts.mapId && !opts.styles && config.darkMode && opts.colorScheme == null) {
            opts.colorScheme = "FOLLOW_SYSTEM";   // google.maps.ColorScheme: Google's own dark mode
        }
        rec.canvas = document.createElement("div");
        rec.canvas.className = "lgm-canvas lgm-pending";
        el.append(rec.canvas);
        rec.map = new g.Map(rec.canvas, opts);   // billed
        if (o.marker.toLowerCase() !== "none" && (o.marker || o.popup || !o.init)) {
            try { addMarker(rec, o, !!o.mapId); } catch (e) { error("marker failed.", e, el); }
        }
        const drawn = new Promise(done => { g.event.addListenerOnce(rec.map, "idle", done); setTimeout(done, 5000); });
        return Promise.all([drawn.then(() => rec.canvas.classList.remove("lgm-pending")), runInit(el, rec)]);
    }

    async function activate(el) {
        const rec = maps.get(el);
        if (!rec || rec.state !== "waiting") return;   // one map per container: each one is billed
        observer.unobserve(el);
        if (blocked(el, rec)) return;
        set(el, rec, "loading");
        const current = () => maps.get(el) === rec && rec.state === "loading";
        try {
            await importLibraries(rec.o);
            if (!current()) return;
            if (!el.isConnected) return destroy(el);   // removed meanwhile: scan() can set it up again
            if (authFailed) throw Error("Google rejected the API key");
            await build(el, rec);
        } catch (e) {
            if (!current()) return;
            error("the map could not load.", e, el);
            if (!rec.map) return fallback(el, rec, authFailed ? "auth" : "load", e);   // a built map stays
        }
        if (!current()) return;
        rec.canvas.classList.remove("lgm-pending");
        el.querySelector(":scope>.lgm-fallback")?.remove();
        set(el, rec, "ready", get(el));
    }

    // ---- lazy loading --------------------------------------------------------------------------
    // Nobody is looking at a speculative prerender or a background tab yet.
    const viewable = new Promise(function wait(go) {
        if (document.prerendering) document.addEventListener("prerenderingchange", () => wait(go), { once: true });
        else if (document.visibilityState === "hidden") document.addEventListener("visibilitychange", () => wait(go), { once: true });
        else go();
    });

    function setup(el) {
        const rec = { o: read(el), state: "" };
        maps.set(el, rec);
        if (el.getClientRects().length && !el.offsetHeight) warn("a map has no height.", el);
        addLink(el, rec.o);
        if (!isFinite(rec.o.lat) || !isFinite(rec.o.lng)) {
            error("data-gmap-lat and data-gmap-lng are required.", el);
            return set(el, rec, "error", { reason: "invalid", error: null });
        }
        if (blocked(el, rec)) return;
        if (bot === null) bot = isBot();
        if (bot) return set(el, rec, "skipped", { reason: "bot" });
        set(el, rec, "waiting");
        if (!observer) {
            const seen = entries => entries.forEach(e => e.isIntersecting && activate(e.target));
            try { observer = new IntersectionObserver(seen, { rootMargin: config.rootMargin }); } catch (e) {
                error("invalid rootMargin; ignored.", e);
                observer = new IntersectionObserver(seen);
            }
        }
        viewable.then(() => maps.get(el) === rec && observer.observe(el));
    }

    // ---- public API ------------------------------------------------------------------------------
    // Sets up map containers in root (or root itself) that are new.
    function scan(root = document) {
        const list = [...root.querySelectorAll("[data-gmap]")];
        if (root.matches?.("[data-gmap]")) list.unshift(root);
        for (const el of list) {
            if (maps.has(el)) continue;
            try { setup(el); } catch (e) { error("setup failed.", e, el); }
        }
    }

    // Loads a map now, without waiting for it to scroll into view. Never for bots.
    function load(el) {
        if (!maps.has(el)) setup(el);
        activate(el);
        return ready(el);
    }

    // Resolves { map, marker, infoWindow } once the map is shown, or null if it is skipped,
    // fails or is destroyed.
    function ready(el) {
        const state = maps.get(el)?.state;
        if (state === "ready") return Promise.resolve(get(el));
        if (state === "error" || state === "skipped" || !(el instanceof Element)) return Promise.resolve(null);
        return new Promise(resolve => {
            const names = ["ready", "error", "skipped", "destroy"];
            const done = e => {
                if (e.target !== el) return;   // bubbled from a nested container
                names.forEach(n => el.removeEventListener("gmap:" + n, done));
                resolve(e.type === "gmap:ready" ? get(el) : null);
            };
            names.forEach(n => el.addEventListener("gmap:" + n, done));
        });
    }

    function get(el) {
        const rec = maps.get(el);
        return rec?.map ? { map: rec.map, marker: rec.marker, infoWindow: rec.infoWindow } : null;
    }

    // Removes the map so scan() or load() can set the container up again (a new, billed map).
    function destroy(el) {
        const rec = maps.get(el), detail = get(el);
        if (!rec) return;
        maps.delete(el);
        observer?.unobserve(el);
        release(rec);
        el.querySelectorAll(":scope>.lgm-canvas,:scope>.lgm-fallback").forEach(n => n.remove());
        el.removeAttribute("data-gmap-state");
        el.dispatchEvent(new CustomEvent("gmap:destroy", { bubbles: true, detail }));
    }

    function start() {
        readConfig();
        if (config.css) {   // zero specificity: site CSS always wins
            const s = document.createElement("style");
            s.nonce = document.querySelector("[nonce]")?.nonce || "";
            s.textContent = ":where([data-gmap]){position:relative;overflow:hidden}:where(.lgm-canvas){position:absolute;inset:0}" +
                ":where(.lgm-pending){opacity:0}:where(.lgm-fallback){display:grid;place-items:center;height:100%}";
            document.head.prepend(s);
        }
        blocker = otherMapsScript();
        started = true;
        scan();
    }

    // Start at DOMContentLoaded, after every deferred script (config, init functions) has run.
    // readyState is already "interactive" while deferred scripts run, so ask navigation timing.
    const domReady = new Promise(go => {
        if (document.readyState === "complete" || performance.getEntriesByType("navigation")[0]?.domContentLoadedEventStart) return go();
        document.addEventListener("DOMContentLoaded", go);
        addEventListener("load", go);   // browsers without navigation timing
    });
    // The API never throws into site code, and calls made before the start wait for it.
    const safe = (name, fn, fallback) => (...a) => {
        try { return fn(...a); } catch (e) { error(name + "() failed.", e); return fallback; }
    };
    const later = fn => (...a) => started ? fn(...a) : domReady.then(() => fn(...a));
    domReady.then(safe("start", start));

    const none = Promise.resolve(null);
    window.LazyGMaps = {
        version: "0.1.0",
        scan: later(safe("scan", scan)),
        load: later(safe("load", load, none)),
        destroy: later(safe("destroy", destroy)),
        ready: safe("ready", ready, none),
        get: safe("get", get, null),
        isBot: safe("isBot", isBot, false)
    };
})();
