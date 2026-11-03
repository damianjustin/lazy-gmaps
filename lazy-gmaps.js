/*!
 * lazy-gmaps.js 0.1.0
 * Lazy-loaded Google Maps for any website: free embeds, dynamic maps, click-to-load
 * previews and bot filtering. No dependencies, no build step.
 *
 * Copyright (c) 2026 Damian Justin. Released under the MIT License (see LICENSE).
 *
 * Includes the Google Maps JavaScript API "Dynamic Library Import" bootstrap loader,
 * Copyright Google LLC, licensed under the Apache License, Version 2.0.
 * See THIRD-PARTY-NOTICES.md. Use of Google Maps Platform is subject to Google's terms.
 *
 * Markup:   <div data-gmap data-gmap-lat="-31.95" data-gmap-lng="115.86"></div>
 * Config:   window.lazyGMapsConfig = { key: "YOUR_API_KEY" }   (before this script)
 * Docs:     README.md
 *
 * Visitors never see an error: anything that goes wrong falls back to the simplest layer
 * that still works (the map, then the fallback link) and is explained in the console.
 */
(function () {
  "use strict";
  if (window.LazyGMaps) {
    console.warn("lazy-gmaps: lazy-gmaps.js is included more than once; only the first copy runs.");
    return;
  }

  var VERSION = "0.1.0";

  // ---- configuration ---------------------------------------------------------------------
  var DEFAULTS = {
    key: "",                        // Google Maps Platform API key (JavaScript, Static and Embed APIs)
    v: "weekly",                    // Maps JavaScript API version
    libraries: ["maps", "marker"],  // imported before any dynamic map is built
    zoom: 15,                       // default zoom
    mapId: "",                      // default cloud Map ID
    styles: null,                   // JSON styles: an array, or named sets
                                    //   { default: [...], "default/dark": [...], name: [...], "name/dark": [...] }
    darkMode: true,                 // follow the browser's dark mode (checked when each map is set up)
    mapOptions: {},                 // google.maps.Map options for every dynamic map
    marker: "",                     // default marker icon URL (PNG, JPEG or GIF)
    markerSize: "",                 // default marker display size, e.g. "24x33" (supply a 2x image)
    popupTemplate: "",              // CSS selector of a <template> for popups
    rootMargin: "200px 0px",        // start loading this far before a map scrolls into view
    timeout: 20000,                 // ms before a silent Maps API load counts as an error
    loaderParams: {},               // language, region, mapIds, channel, authReferrerPolicy
    isBot: null,                    // function(userAgent) -> boolean; replaces the built-in check
    css: true,                      // inject the default stylesheet
    debug: false,                   // log every decision to the console
    text: { show: "Show map", explore: "Explore map", open: "Open in Google Maps" }
  };
  var NESTED = ["text", "mapOptions", "loaderParams"];
  var LOADER_KEYS = ["key", "v", "loaderParams"];                         // fixed once a map has used them
  var PAGE_WIDE = LOADER_KEYS.concat(["isBot", "css", "debug", "rootMargin"]); // not per map

  var config = clone(DEFAULTS);
  var configVersion = 0;           // bumped whenever configuration is merged
  var seenConfig = new WeakSet();  // configuration objects already merged
  var loaderLocked = false;        // true once the key has been used in a request

  function clone(o) {
    var c = {};
    Object.keys(o).forEach(function (k) { c[k] = isObject(o[k]) ? Object.assign({}, o[k]) : Array.isArray(o[k]) ? o[k].slice() : o[k]; });
    return c;
  }
  function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // Merges one configuration object into target. Later values win; nested option objects and
  // named style sets are merged. skip(key, value) can veto a key.
  function merge(target, part, skip) {
    Object.keys(part).forEach(function (k) {
      var v = part[k], cur = target[k];
      if (!(k in DEFAULTS)) { warnOnce("unknown:" + k, 'unknown setting "' + k + '" ignored.'); return; }
      if (skip && skip(k, v)) return;
      if (NESTED.indexOf(k) !== -1) {
        if (isObject(v)) target[k] = Object.assign({}, isObject(cur) ? cur : {}, v);
        else if (v != null) warnOnce("nested:" + k, k + " must be an object; ignored.");
        return;
      }
      target[k] = k === "styles" && isObject(v) && isObject(cur) ? Object.assign({}, cur, v) : v;
    });
    if ("libraries" in part) {
      target.libraries = typeof target.libraries === "string" ? target.libraries.split(",") : [].concat(target.libraries || []);
    }
    return target;
  }

  function sameValue(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
  }

  // Reads window.lazyGMapsConfig (an object, or an array of objects so several sources can each
  // push their own). New entries found after start apply to maps that are not set up yet.
  function refreshConfig() {
    var src = window.lazyGMapsConfig, added = false;
    if (src == null) return;
    [].concat(src).forEach(function (part) {
      if (!isObject(part)) { warnOnce("cfgtype", "lazyGMapsConfig entries must be objects; ignored one."); return; }
      if (seenConfig.has(part)) return;
      seenConfig.add(part);
      if (started) {
        warnOnce("late", "configuration was added after the page finished loading. It applies only to maps " +
          "not set up yet. Put window.lazyGMapsConfig before lazy-gmaps.js.");
      }
      merge(config, part, function (k, v) {
        if (!loaderLocked || LOADER_KEYS.indexOf(k) === -1 || sameValue(v, config[k])) return false;
        warnOnce("locked", "key, v and loaderParams cannot change once a map has loaded; the later value is ignored.");
        return true;
      });
      added = true;
    });
    if (added) configVersion++;
  }

  // Settings passed to load() or scan(), layered over the page configuration for those maps only.
  function configWith(extra) {
    if (!extra) return config;
    return merge(clone(config), extra, function (k) {
      if (PAGE_WIDE.indexOf(k) === -1) return false;
      warnOnce("pagewide:" + k, '"' + k + '" is a page-wide setting; set it in lazyGMapsConfig. Ignored here.');
      return true;
    });
  }

  var SELECTOR = "[data-gmap]";
  var MODES = ["embed", "dynamic"], TRIGGERS = ["auto", "click"];

  var states = new WeakMap();      // container -> state (the attribute is only output)
  var settings = new WeakMap();    // container -> resolved options
  var instances = new WeakMap();   // container -> { map, marker, infoWindow } or { iframe }
  var generations = new WeakMap(); // container -> number, bumped by destroy() to cancel pending loads
  var wired = new WeakMap();       // container -> its click handler
  var built = new WeakSet();       // containers whose Google map exists (billed): never build again
  var destroyedEarly = new WeakSet();
  var started = false, apiInstalled = false, authFailed = false;
  var blockedBy = null;            // another script that loads Google Maps
  var botResult = null;
  var observer = null, warned = Object.create(null), early = [], earlyLoads = [];

  // ---- small helpers -----------------------------------------------------------------------
  function log() {
    if (config.debug) console.info.apply(console, ["[lazy-gmaps]"].concat([].slice.call(arguments)));
  }
  function warnOnce(id, msg, el) {
    if (warned[id]) return;
    warned[id] = true;
    console.warn("lazy-gmaps: " + msg, el || "");
  }
  function fail(el, msg, err) {
    if (err) console.error("lazy-gmaps: " + msg, err, el || "");
    else console.error("lazy-gmaps: " + msg, el || "");
  }
  function attr(el, name) { var v = el.getAttribute("data-gmap-" + name); return v === null ? "" : v.trim(); }
  function gen(el) { return generations.get(el) || 0; }
  function isElement(x) { return !!x && x.nodeType === 1; }
  function removeAll(el, sel) { el.querySelectorAll(sel).forEach(function (n) { n.remove(); }); }

  // "24x33" -> { w: 24, h: 33 }; "40" -> { w: 40, h: 40 }
  function parseSize(s) {
    var m = String(s || "").match(/^\s*(\d+)\s*(?:x\s*(\d+))?\s*$/i);
    return m ? { w: +m[1], h: +(m[2] || m[1]) } : null;
  }

  // Marker icons must be absolute for Static Maps (Google fetches them) and PNG, JPEG or GIF.
  function absoluteUrl(url, el) {
    if (!url) return "";
    var abs;
    try { abs = new URL(url, location.href).href; } catch (e) { return url; }
    if (/\.svg(\?|#|$)/i.test(abs)) warnOnce("svg", "Static Maps cannot use SVG marker icons; use a PNG.", el);
    if (abs.indexOf("|") !== -1) warnOnce("pipe", "a '|' in the marker icon URL breaks Static Maps markers.", el);
    return abs;
  }

  function isDark(cfg) {
    return !!(cfg.darkMode && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // Styles for a map: its named set (data-gmap-style, else "default"), using "<name>/dark" when
  // the browser is in dark mode and that set exists. An array applies to every map.
  function stylesFor(el, o, cfg) {
    var s = cfg.styles;
    if (!s || o.mapId) return null;
    if (Array.isArray(s)) {
      if (o.styleName) fail(el, 'data-gmap-style="' + o.styleName + '" needs named style sets in lazyGMapsConfig.styles.');
      return s;
    }
    if (!isObject(s)) return null;
    var name = o.styleName || "default";
    if (o.styleName && !s[name]) {
      fail(el, 'no style set "' + name + '" in lazyGMapsConfig.styles; using "default". Defined: ' + Object.keys(s).join(", "));
      name = "default";
    }
    return (isDark(cfg) && s[name + "/dark"]) || s[name] || null;
  }

  function parseOptions(el) {
    var raw = attr(el, "options");
    if (!raw) return {};
    try {
      var v = JSON.parse(raw);
      if (isObject(v)) return v;
    } catch (e) { /* reported below */ }
    fail(el, "data-gmap-options is not a valid JSON object (use double quotes); ignored: " + raw);
    return {};
  }

  // Everything about one map, merged from the configuration, any per-call settings and its
  // attributes. An init function receives this as ctx.options.
  function resolve(el, extra) {
    var cfg = configWith(extra);
    var lat = parseFloat(attr(el, "lat")), lng = parseFloat(attr(el, "lng")), zoom = parseInt(attr(el, "zoom"), 10);
    var mode = (attr(el, "mode") || "embed").toLowerCase();
    var init = attr(el, "init");
    var markerAttr = attr(el, "marker");
    var markerLower = markerAttr.toLowerCase();
    var mapOptions = Object.assign({}, cfg.mapOptions, mode === "dynamic" ? parseOptions(el) : {});
    var popup = attr(el, "popup");
    var o = {
      mode: mode,
      trigger: (attr(el, "trigger") || "auto").toLowerCase(),
      init: init,
      lat: lat, lng: lng,
      hasPoint: isFinite(lat) && isFinite(lng),
      zoom: isFinite(zoom) ? zoom : cfg.zoom,
      query: attr(el, "query"),
      title: attr(el, "title") || el.getAttribute("aria-label") || "",
      mapId: attr(el, "map-id") || mapOptions.mapId || cfg.mapId,
      styleName: attr(el, "style"),
      // A map with an init function draws its own markers, so the default marker is off unless
      // asked for (data-gmap-marker) or implied by popup text.
      showMarker: markerLower === "none" ? false : (markerAttr || popup ? true : !init),
      markerIcon: absoluteUrl(markerAttr && markerLower !== "show" && markerLower !== "none" ? markerAttr : cfg.marker, el),
      markerSize: parseSize(attr(el, "marker-size") || cfg.markerSize),
      popup: popup,
      popupTemplate: attr(el, "popup-template") || cfg.popupTemplate,
      popupOpen: el.hasAttribute("data-gmap-popup-open"),
      preview: attr(el, "preview").toLowerCase() !== "none",
      libraries: attr(el, "libraries").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      mapOptions: mapOptions,
      darkMode: !!cfg.darkMode
    };
    o.styles = mode !== "dynamic" ? null : mapOptions.styles ? mapOptions.styles : stylesFor(el, o, cfg);
    // Kept off the public object: the configuration this map was resolved with.
    Object.defineProperty(o, "cfg", { value: cfg });
    Object.defineProperty(o, "extra", { value: extra || null });
    Object.defineProperty(o, "cfgVersion", { value: configVersion });
    return o;
  }

  // Options for a map that is about to load. Configuration added since it was set up is
  // picked up here, as long as the map has not been built.
  function current(el) {
    refreshConfig();
    var o = settings.get(el);
    if (!o || o.cfgVersion === configVersion || built.has(el)) return o;
    var n = resolve(el, o.extra);
    n.mode = o.mode;
    n.trigger = o.trigger;
    if (o.invalid) n.invalid = true;
    settings.set(el, n);
    return n;
  }

  function mapsLink(o) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.query || (o.lat + "," + o.lng));
  }

  function localeParams(p) {
    var lp = config.loaderParams || {};
    if (lp.language) p.set("language", lp.language);
    if (lp.region) p.set("region", lp.region);
  }

  // ---- bot and automation check ----------------------------------------------------------
  // Flags self-identified crawlers, automation tools, HTTP libraries and outdated Chrome user
  // agents. A visitor flagged in error can still load the map with the "Show map" button.
  var BOT_UA = new RegExp([
    "bot", "agent", "crawl", "spider", "slurp", "external", "whatsapp", "preview",          // crawlers, link previews
    "headless", "phantom", "selenium", "puppeteer", "playwright",                           // automation
    "curl", "wget", "python", "java", "go-http", "okhttp", "axios", "node-fetch", "libwww",  // scripts and libraries
    "http",                                     // browsers never include a URL in their user agent; bots usually do
    "lighthouse", "pagespeed", "inspect", "monitor", "uptime", "scan",                      // audits and monitors
    "chatgpt-user", "claude-", "perplexity-user", "mediapartners", "googleother",           // fetchers without "bot"
    "google-extended", "feedfetcher", "apis-google", "ia_archiver"                          //   in their names
  ].join("|"), "i");

  function isLikelyBot() {
    var ua = navigator.userAgent || "";
    if (typeof config.isBot === "function") {                // full override
      try { return !!config.isBot(ua); } catch (e) { fail(null, "isBot threw; using the built-in check.", e); }
    }
    if (!ua || navigator.webdriver === true) return true;  // no user agent, or WebDriver automation
    if (BOT_UA.test(ua.replace(/cubot/gi, ""))) return true; // CUBOT is a phone brand
    var chrome = ua.match(/(?:chrome|chromium|crios)\/(\d+)/i);
    return !!chrome && +chrome[1] < 100;                    // Chrome updates automatically
  }

  // ---- default stylesheet --------------------------------------------------------------------
  // Container rules have zero specificity so site CSS always wins. The preview button uses
  // normal specificity so common resets (button{...}, img{height:auto}) cannot distort it.
  function injectCss() {
    if (!config.css || document.getElementById("lazy-gmaps-css")) return;
    var s = document.createElement("style");
    s.id = "lazy-gmaps-css";
    var nonced = document.querySelector("style[nonce], script[nonce]"); // strict Content Security Policy
    if (nonced && nonced.nonce) s.nonce = nonced.nonce;
    s.textContent = [
      ":where([data-gmap]){position:relative;overflow:hidden}",
      ":where(.lgm-canvas){position:absolute;inset:0;width:100%;height:100%;border:0}",
      ":where(.lgm-canvas--pending){opacity:0}",
      ".lgm-preview{all:unset;position:absolute;inset:0;cursor:pointer;display:block}",
      ".lgm-preview img{display:block;width:100%;height:100%;max-width:none;object-fit:cover}",
      ":where(.lgm-preview:focus-visible){outline:3px solid #1a73e8;outline-offset:-3px}",
      ":where(.lgm-badge){position:absolute;right:12px;bottom:12px;padding:10px 14px;border-radius:999px;",
      "background:#fff;color:#1f1f1f;font:500 14px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3)}",
      ":where(.lgm-placeholder){display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:center;",
      "height:100%;padding:16px;box-sizing:border-box;text-align:center}",
      ":where(.lgm-placeholder [data-gmap-load]){display:none}",
      ":where([data-gmap-state=skipped],[data-gmap-state=waiting][data-gmap-trigger=click i]) .lgm-placeholder [data-gmap-load]{display:inline-block}",
      ":where([data-gmap-state=error] [data-gmap-load]){display:none}",
      ":where([data-gmap-state=preview]) [data-gmap-placeholder]:not(.lgm-preview){display:none}"
    ].join("");
    (document.head || document.documentElement).insertBefore(s, (document.head || document.documentElement).firstChild);
  }

  // An empty container gets a link to Google Maps and a "Show map" button (shown only for maps
  // loaded on click, or skipped for bots). Content already in the container, for example
  // rendered by the server, is kept; a button is added if it has none.
  function ensurePlaceholder(el, o) {
    var hasContent = el.children.length || el.textContent.trim();
    if (hasContent && el.querySelector("[data-gmap-load]")) return;
    var box = document.createElement("div");
    box.className = "lgm-placeholder";
    box.setAttribute("data-gmap-placeholder", "");
    if (!hasContent && (o.hasPoint || o.query)) {
      var a = document.createElement("a");
      a.href = mapsLink(o);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = o.cfg.text.open;
      box.appendChild(a);
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-gmap-load", "");
    btn.textContent = o.cfg.text.show;
    box.appendChild(btn);
    el.appendChild(box);
  }

  function removePlaceholders(el) { removeAll(el, "[data-gmap-placeholder]"); }

  // Keep keyboard focus on the map when the button that loaded it is removed.
  function keepFocus(el) {
    var active = document.activeElement;
    if (!active || !el.contains(active) || !active.closest("[data-gmap-placeholder]")) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }

  function emit(el, name, detail) {
    el.dispatchEvent(new CustomEvent("gmap:" + name, { bubbles: true, detail: detail }));
  }
  function setState(el, state, detail) {
    states.set(el, state);
    el.setAttribute("data-gmap-state", state);
    emit(el, state, detail);
    log(el.id ? "#" + el.id : el, "->", state, detail || "");
  }
  function resetState(el) { states.delete(el); el.removeAttribute("data-gmap-state"); }
  function busy(el) { var s = states.get(el); return s === "loading" || s === "ready"; }

  // The last layer: the map is removed and the fallback link shows. Visitors see no message;
  // the reason is in the console and in the gmap:error event.
  function showFallback(el, o, reason, err) {
    keepFocus(el);
    removeAll(el, ".lgm-canvas, .lgm-preview");
    if (o) ensurePlaceholder(el, o);
    setState(el, "error", { reason: reason, error: err || null });
  }

  // ==========================================================================================
  // Embed mode: Maps Embed API iframe (free, unlimited)
  // https://developers.google.com/maps/documentation/embed/embedding-map
  // ==========================================================================================
  function embedUrl(o) {
    loaderLocked = true;
    var p = new URLSearchParams();
    p.set("key", config.key);
    p.set("q", o.query || (o.lat + "," + o.lng));
    if (o.hasPoint) p.set("center", o.lat + "," + o.lng);
    p.set("zoom", String(o.zoom));
    localeParams(p);
    return "https://www.google.com/maps/embed/v1/place?" + p;
  }

  function renderEmbed(el) {
    if (busy(el)) return;
    var o = current(el), g = gen(el);
    if (!o || o.invalid) return;
    if (observer) observer.unobserve(el);
    var iframe = document.createElement("iframe");
    iframe.className = "lgm-canvas";
    iframe.title = o.title || "Map";
    iframe.loading = "lazy";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.addEventListener("load", function () {
      if (gen(el) !== g) return;
      keepFocus(el);
      removePlaceholders(el);
      setState(el, "ready", instances.get(el));
    }, { once: true });
    instances.set(el, { iframe: iframe });
    setState(el, "loading");
    iframe.src = embedUrl(o);
    el.appendChild(iframe);
  }

  // ==========================================================================================
  // Static preview: dynamic maps with data-gmap-trigger="click"
  // https://developers.google.com/maps/documentation/maps-static/start
  // ==========================================================================================
  // JSON map styles as Static Maps "style" parameters, so the preview matches the live map.
  function staticStyles(styles) {
    return (Array.isArray(styles) ? styles : []).map(function (s) {
      var parts = ["feature:" + (s.featureType || "all")];
      if (s.elementType) parts.push("element:" + s.elementType);
      (s.stylers || []).forEach(function (st) {
        Object.keys(st).forEach(function (k) { parts.push(k + ":" + String(st[k]).replace(/^#/, "0x")); });
      });
      return parts.join("|");
    });
  }

  function staticUrl(el, o) {
    var signed = attr(el, "static-src"); // a URL signed on the server is used as is
    if (signed) return signed;
    loaderLocked = true;
    // Static Maps images are at most 640x640 CSS pixels. Larger boxes request a proportionally
    // smaller image, which is scaled up to show the same area as the live map.
    var r = el.getBoundingClientRect();
    var bw = Math.round(r.width) || 640, bh = Math.round(r.height) || 400;
    var f = Math.min(1, 640 / Math.max(bw, bh));
    var p = new URLSearchParams();
    p.set("center", o.lat + "," + o.lng);
    p.set("zoom", String(o.zoom));
    p.set("size", Math.max(1, Math.round(bw * f)) + "x" + Math.max(1, Math.round(bh * f)));
    p.set("scale", "2");
    if (o.showMarker) {
      // With a marker size the icon is a 2x image; marker scale:2 renders it at that size.
      p.set("markers", (o.markerIcon ? (o.markerSize ? "scale:2|" : "") + "icon:" + o.markerIcon + "|" : "") + o.lat + "," + o.lng);
    }
    if (o.mapId) p.set("map_id", o.mapId);
    else staticStyles(o.styles).forEach(function (s) { p.append("style", s); });
    localeParams(p);
    p.set("key", config.key);
    return "https://maps.googleapis.com/maps/api/staticmap?" + p;
  }

  function renderPreview(el) {
    if (states.get(el) !== "waiting") return;
    var o = current(el), g = gen(el);
    if (!o || o.invalid) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lgm-preview";
    btn.setAttribute("data-gmap-load", "");
    btn.setAttribute("data-gmap-placeholder", "");
    btn.setAttribute("aria-label", o.cfg.text.explore + (o.title ? ": " + o.title : ""));
    var img = document.createElement("img");
    img.style.cssText = "width:100%;height:100%;max-width:none;object-fit:cover;display:block";
    img.alt = o.title || "";
    img.decoding = "async";
    // If the image fails (Static Maps API not enabled, quota, signing), drop to the plain
    // "Show map" button: the map still loads on click.
    img.addEventListener("error", function () {
      if (gen(el) !== g || states.get(el) !== "preview") return;
      warnOnce("static", "the static preview image did not load; showing the \"Show map\" button instead. " +
        "Check that the Maps Static API is enabled for the key.", el);
      keepFocus(el);
      btn.remove();
      setState(el, "waiting", { mode: o.mode, trigger: o.trigger });
    }, { once: true });
    img.src = staticUrl(el, o);
    var badge = document.createElement("span");
    badge.className = "lgm-badge";
    badge.textContent = o.cfg.text.explore;
    btn.appendChild(img);
    btn.appendChild(badge);
    el.appendChild(btn);
    setState(el, "preview", { img: img });
  }

  // ==========================================================================================
  // Maps JavaScript API: Google's inline bootstrap loader, unmodified.
  // Copyright Google LLC. Apache License 2.0. See THIRD-PARTY-NOTICES.md.
  // https://developers.google.com/maps/documentation/javascript/load-maps-js-api
  // Defines google.maps.importLibrary without a network request; the API is fetched on the
  // first importLibrary() call, once per page.
  // ==========================================================================================
  function installApi() {
    if (apiInstalled) return;
    apiInstalled = true;
    loaderLocked = true;
    var params = Object.assign({ key: config.key, v: config.v }, config.loaderParams);
    /* eslint-disable */
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})(params);
    /* eslint-enable */
    hookAuthFailure();
  }

  // Google calls window.gm_authFailure() for key, referrer and billing errors. Dynamic maps then
  // fall back to the link. The hook stays in place if the site assigns its own handler; both run.
  function hookAuthFailure() {
    var siteHook = window.gm_authFailure;
    function onAuthFailure() {
      authFailed = true;
      console.error("lazy-gmaps: Google rejected the API key (gm_authFailure). Check the key's restrictions, " +
        "enabled APIs and billing. Dynamic maps show the fallback link instead.");
      document.querySelectorAll(SELECTOR).forEach(function (el) {
        try {
          var o = settings.get(el);
          if (o && o.mode === "dynamic" && busy(el)) showFallback(el, o, "auth");
        } catch (e) { fail(el, "could not show the fallback", e); }
      });
      if (typeof siteHook === "function") return siteHook.apply(this, arguments);
    }
    try {
      Object.defineProperty(window, "gm_authFailure", {
        configurable: true,
        get: function () { return onAuthFailure; },
        set: function (fn) { siteHook = fn; }
      });
    } catch (e) {
      window.gm_authFailure = onAuthFailure;
    }
  }

  // Another <script> (an old theme tag, a plugin) that loads Google Maps. Loading a second copy
  // breaks both, so dynamic maps do not load while it is on the page. Embeds are unaffected.
  function otherMapsScript() {
    if (apiInstalled) return null;
    var tag = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"], script[src*="maps.google.com/maps/api/js"]');
    if (tag) return tag;
    var m = window.google && window.google.maps;
    if (m && (typeof m.Map === "function" || typeof m.importLibrary === "function")) return "window.google.maps";
    return null;
  }

  // Returns true (and shows the fallback) when a dynamic map cannot load at all.
  function dynamicBlocked(el, o) {
    if (!blockedBy) blockedBy = otherMapsScript();
    if (blockedBy) {
      if (!warned.blocked) {
        warned.blocked = true;
        console.error("lazy-gmaps: another script on this page already loads Google Maps. Dynamic maps are " +
          "not loaded, to avoid loading the API twice; visitors see the fallback link. Remove this tag " +
          "(and any code that uses it) so lazy-gmaps.js can load Google Maps. Embeds still work.", blockedBy);
      }
      showFallback(el, o, "blocked");
      return true;
    }
    if (authFailed) { showFallback(el, o, "auth"); return true; }
    return false;
  }

  function importLibraries(names, timeout) {
    installApi();
    var load = Promise.all(names.map(function (n) { return google.maps.importLibrary(n); }));
    var timer = new Promise(function (resolve, reject) {
      setTimeout(function () {
        reject(new Error("the Maps JavaScript API did not load within " + timeout + " ms"));
      }, timeout);
    });
    return Promise.race([load, timer]);
  }

  function librariesFor(o) {
    var all = ["core", "maps"].concat(o.cfg.libraries, o.libraries).map(function (s) { return String(s).trim(); });
    return all.filter(function (s, i) { return s && all.indexOf(s) === i; });
  }

  // ==========================================================================================
  // Dynamic mode: build the map from options, then call the init function
  // ==========================================================================================
  // The init function is global (a function declaration, window.fn = ..., or a dotted path such
  // as "Site.maps.init") and must exist by the time the page has finished parsing.
  function findInit(name) {
    var fn = name.split(".").reduce(function (obj, k) { return obj == null ? obj : obj[k]; }, window);
    return typeof fn === "function" ? fn : null;
  }

  // Popup content: a <template> filled with the map's text, or the text on its own. Text is
  // always inserted as text, never HTML. Fields: [data-gmap-field="title"], [data-gmap-field="popup"].
  function popupContent(el, o) {
    // The global template applies only to maps with popup text; a map's own template always applies.
    if (!o.popup && !attr(el, "popup-template")) return null;
    if (o.popupTemplate) {
      var tpl = null;
      try { tpl = document.querySelector(o.popupTemplate); } catch (e) { /* invalid selector */ }
      if (tpl && tpl.content) {
        var wrap = document.createElement("div");
        wrap.appendChild(tpl.content.cloneNode(true));
        wrap.querySelectorAll("[data-gmap-field]").forEach(function (f) {
          var k = f.getAttribute("data-gmap-field");
          if (k === "title" || k === "popup") f.textContent = o[k];
        });
        return wrap;
      }
      warnOnce("tpl:" + o.popupTemplate, 'popup template "' + o.popupTemplate + '" did not match a <template> element; using plain text.', el);
    }
    if (!o.popup) return null;
    var div = document.createElement("div");
    div.textContent = o.popup;
    return div;
  }

  function addMarkerAndPopup(el, o, map, inst) {
    var position = { lat: o.lat, lng: o.lng };
    var marker, Advanced = google.maps.marker && google.maps.marker.AdvancedMarkerElement;
    if (o.mapId && Advanced) {                 // advanced markers require a Map ID
      var content;
      if (o.markerIcon) {
        content = document.createElement("img");
        content.src = o.markerIcon;
        content.alt = "";
        if (o.markerSize) { content.width = o.markerSize.w; content.height = o.markerSize.h; }
      }
      marker = new Advanced({ map: map, position: position, content: content, title: o.title, gmpClickable: true });
    } else {
      var icon = o.markerIcon || undefined;    // anchored at the image's bottom centre, as in Static Maps
      if (o.markerIcon && o.markerSize) icon = { url: o.markerIcon, scaledSize: new google.maps.Size(o.markerSize.w, o.markerSize.h) };
      marker = new google.maps.Marker({ map: map, position: position, title: o.title, icon: icon });
    }
    inst.marker = marker;

    var content2 = popupContent(el, o);
    if (content2) {
      var infoWindow = new google.maps.InfoWindow({ content: content2 });
      inst.infoWindow = infoWindow;
      var open = function () { infoWindow.open({ map: map, anchor: marker }); };
      marker.addListener("click", open);
      if (o.popupOpen) open();
    }
  }

  // The init function runs after the base map exists. If it is missing or fails, the base map
  // (centre, zoom, styles, marker) stays on screen and the problem is logged.
  function runInit(el, o, map, inst) {
    if (!o.init) return Promise.resolve();
    var fn = findInit(o.init);
    if (!fn) {
      fail(el, 'data-gmap-init="' + o.init + '" is not a global function. The map is shown without it. ' +
        "Define the function in a script that runs before the page finishes loading.");
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      resolve(fn.call(window, map, { el: el, options: o, marker: inst.marker, infoWindow: inst.infoWindow, google: window.google }));
    }).catch(function (err) {
      fail(el, 'the data-gmap-init function "' + o.init + '" failed. The map is shown without the rest of its setup.', err);
    });
  }

  // Resolves once the map has drawn and the init function has finished.
  function buildDynamic(el, o) {
    var canvas = document.createElement("div");
    canvas.className = "lgm-canvas lgm-canvas--pending";
    el.appendChild(canvas);

    var mapOptions = Object.assign({}, o.mapOptions, { center: { lat: o.lat, lng: o.lng }, zoom: o.zoom });
    if (o.mapId) { mapOptions.mapId = o.mapId; delete mapOptions.styles; }
    else if (o.styles) mapOptions.styles = o.styles;
    else if (o.darkMode && mapOptions.colorScheme == null && google.maps.ColorScheme) {
      mapOptions.colorScheme = google.maps.ColorScheme.FOLLOW_SYSTEM; // Google's own dark mode
    }
    var map = new google.maps.Map(canvas, mapOptions);
    built.add(el);

    var inst = { map: map, marker: null, infoWindow: null };
    instances.set(el, inst);
    if (o.showMarker) {
      try { addMarkerAndPopup(el, o, map, inst); } catch (e) { fail(el, "the marker or popup could not be added.", e); }
    }
    emit(el, "map", inst);

    var drawn = new Promise(function (resolve) {
      try { google.maps.event.addListenerOnce(map, "idle", resolve); } catch (e) { resolve(); }
      setTimeout(resolve, 5000);
    }).then(function () { canvas.classList.remove("lgm-canvas--pending"); });

    return Promise.all([drawn, runInit(el, o, map, inst)]);
  }

  var STALE = {};
  function activateDynamic(el) {
    if (busy(el) || built.has(el)) return Promise.resolve(); // never build twice: each build is billed
    var o = current(el);
    if (!o || o.invalid) return Promise.resolve();
    if (observer) observer.unobserve(el);
    if (dynamicBlocked(el, o)) return Promise.resolve();
    var g = gen(el);
    setState(el, "loading");

    return Promise.resolve()
      .then(function () { return importLibraries(librariesFor(o), o.cfg.timeout); })
      .then(function () {
        if (gen(el) !== g) return STALE;                                       // destroyed meanwhile
        if (!el.isConnected) { settings.delete(el); resetState(el); return STALE; } // removed; scan() can restart it
        if (authFailed) throw new Error("Google rejected the API key");
        return buildDynamic(el, o);
      })
      .then(function (r) {
        if (r === STALE || gen(el) !== g || states.get(el) !== "loading") return;
        keepFocus(el);
        removePlaceholders(el);
        setState(el, "ready", instances.get(el));
      })
      .catch(function (err) {
        if (gen(el) !== g || states.get(el) !== "loading") return;
        if (built.has(el)) {           // the map exists (and is billed): keep showing it
          fail(el, "a problem occurred after the map was built; the map is shown.", err);
          keepFocus(el);
          removePlaceholders(el);
          setState(el, "ready", instances.get(el));
          return;
        }
        fail(el, "the map could not be loaded; visitors see the fallback link.", err);
        showFallback(el, o, authFailed ? "auth" : "load", err);
      });
  }

  // ---- loading triggers --------------------------------------------------------------------
  function onVisible(el) {
    try {
      var o = settings.get(el);
      if (!o) return;
      if (o.mode === "embed") renderEmbed(el);
      else if (o.trigger === "click") renderPreview(el);
      else activateDynamic(el);
    } catch (e) {
      fail(el, "the map could not be shown.", e);
    }
  }

  // Loads a map now, bypassing the viewport, click and bot checks (used by [data-gmap-load]).
  function load(el, extra) {
    if (!isElement(el)) { fail(null, "load() needs a map container element."); return Promise.resolve(); }
    if (!started) { destroyedEarly.delete(el); earlyLoads.push([el, extra]); return Promise.resolve(); }
    var o = settings.get(el);
    // Not loaded yet: new settings, or corrected attributes, are applied by setting it up again.
    if (o && !busy(el) && !built.has(el) && (o.invalid || extra)) {
      var combined = extra ? merge(merge({}, o.extra || {}), extra) : o.extra;
      settings.delete(el);
      resetState(el);
      setup(el, combined);
    } else if (!o) {
      setup(el, extra);
    }
    o = settings.get(el);
    if (!o || o.invalid) return Promise.resolve();
    if (o.mode === "embed") { renderEmbed(el); return Promise.resolve(); }
    return activateDynamic(el);
  }

  function wireClick(el) {
    if (wired.has(el)) return;
    function onClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-gmap-load]") : null;
      var s = states.get(el);
      // Only before the map loads; clicks inside a live map, or after an error, are not touched.
      if (!btn || !el.contains(btn) || (s !== "waiting" && s !== "preview" && s !== "skipped")) return;
      e.preventDefault();
      safeLoad(el);
    }
    wired.set(el, onClick);
    el.addEventListener("click", onClick);
  }

  // Wait until the page is being viewed: not a speculative prerender and not a hidden tab.
  function whenViewable(cb) {
    if (document.prerendering) {
      document.addEventListener("prerenderingchange", function () { whenViewable(cb); }, { once: true });
    } else if (document.visibilityState === "hidden") {
      document.addEventListener("visibilitychange", function onVis() {
        if (document.visibilityState === "hidden") return;
        document.removeEventListener("visibilitychange", onVis);
        cb();
      });
    } else {
      cb();
    }
  }

  function observe(el) {
    var g = gen(el);
    whenViewable(function () {
      if (gen(el) !== g || !settings.has(el)) return;
      if (!("IntersectionObserver" in window)) { onVisible(el); return; } // no lazy loading support
      observer = observer || new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          observer.unobserve(en.target);
          onVisible(en.target);
        });
      }, { rootMargin: config.rootMargin });
      observer.observe(el);
    });
  }

  function validate(el, o) {
    if (MODES.indexOf(o.mode) === -1) { fail(el, 'unknown data-gmap-mode="' + o.mode + '". Use embed or dynamic.'); return false; }
    if (TRIGGERS.indexOf(o.trigger) === -1) { fail(el, 'unknown data-gmap-trigger="' + o.trigger + '". Use auto or click.'); return false; }
    if (!o.hasPoint && !(o.mode === "embed" && o.query)) {
      fail(el, o.mode + " map needs data-gmap-lat and data-gmap-lng" + (o.mode === "embed" ? " (or data-gmap-query)" : "") + ".");
      return false;
    }
    if (!config.key) warnOnce("key", "set lazyGMapsConfig.key.");
    if (o.mode === "embed" && (o.init || attr(el, "marker") || attr(el, "map-id"))) {
      warnOnce("embedAttrs", "data-gmap-init, data-gmap-marker and data-gmap-map-id apply to dynamic maps only.", el);
    }
    if (el.getBoundingClientRect().height === 0 && getComputedStyle(el).display !== "none") {
      warnOnce("height", "a map container has zero height; give it a CSS height.", el);
    }
    return true;
  }

  // Sets up one container: placeholder, click handling, then waits for it to be needed.
  function setup(el, extra) {
    var o = resolve(el, extra);
    settings.set(el, o);
    ensurePlaceholder(el, o);
    wireClick(el);
    if (!validate(el, o)) { o.invalid = true; setState(el, "error", { reason: "invalid", error: null }); return; }

    if (o.mode === "dynamic") {          // billed, including static previews
      if (dynamicBlocked(el, o)) return;
      if (botResult === null) botResult = isLikelyBot();
      if (botResult) { setState(el, "skipped", { reason: "bot" }); return; }
    }
    setState(el, "waiting", { mode: o.mode, trigger: o.trigger });
    if (o.trigger === "click" && !(o.mode === "dynamic" && o.preview)) return;
    observe(el);
  }

  // ---- public API ------------------------------------------------------------------------------
  // Finds map containers in root (or root itself) that have not been set up yet. Settings apply
  // to those maps only.
  function scan(root, extra) {
    if (!started) { early.push([root || document, extra]); return; }
    root = root || document;
    if (!root.querySelectorAll) { fail(null, "scan() needs an element or document."); return; }
    refreshConfig();
    var list = [].slice.call(root.querySelectorAll(SELECTOR));
    if (root.matches && root.matches(SELECTOR)) list.unshift(root);

    list.forEach(function (el) {
      if (states.has(el) || settings.has(el)) return;
      if (destroyedEarly.has(el)) { if (el !== root) return; destroyedEarly.delete(el); }
      try {
        setup(el, extra);
      } catch (e) {
        fail(el, "this map could not be set up.", e);
      }
    });
  }

  // Resolves with { map, marker, infoWindow } (or { iframe }) once the map is shown, or with
  // null if the map is destroyed first.
  function ready(el) {
    return new Promise(function (resolve) {
      if (!isElement(el)) { resolve(null); return; }
      if (states.get(el) === "ready") { resolve(instances.get(el) || null); return; }
      var names = ["ready", "destroy"];
      function done(e) {
        if (e.target !== el) return;               // ignore events bubbling from nested containers
        names.forEach(function (n) { el.removeEventListener("gmap:" + n, done); });
        resolve(e.type === "gmap:destroy" ? null : instances.get(el) || null);
      }
      names.forEach(function (n) { el.addEventListener("gmap:" + n, done); });
    });
  }

  // Moves a map and its marker without rebuilding it. Accepts { lat, lng, zoom, query }.
  function update(el, changes) {
    var o = isElement(el) && settings.get(el);
    if (!o || !changes) return;
    ["lat", "lng", "zoom", "query"].forEach(function (k) {
      if (changes[k] === undefined || changes[k] === null) return;
      o[k] = k === "query" ? String(changes[k]) : +changes[k];
      el.setAttribute("data-gmap-" + k, changes[k]);
    });
    o.hasPoint = isFinite(o.lat) && isFinite(o.lng);
    var inst = instances.get(el), pos = { lat: o.lat, lng: o.lng };
    if (inst && inst.iframe) {
      inst.iframe.src = embedUrl(o);
    } else if (inst && inst.map) {
      inst.map.setCenter(pos);
      inst.map.setZoom(o.zoom);
      if (inst.marker) { if (inst.marker.setPosition) inst.marker.setPosition(pos); else inst.marker.position = pos; }
    } else if (states.get(el) === "preview") {
      var img = el.querySelector(".lgm-preview img");
      if (img) img.src = staticUrl(el, o);
    }
    emit(el, "update", { options: o });
  }

  // Removes a map so the container can be set up again with scan() or load(). Building it
  // again is a new billable map load.
  function destroy(el) {
    if (!isElement(el)) return;
    if (!started) { destroyedEarly.add(el); earlyLoads = earlyLoads.filter(function (x) { return x[0] !== el; }); return; }
    var handler = wired.get(el);
    if (handler) { el.removeEventListener("click", handler); wired.delete(el); }
    if (!settings.has(el) && !states.has(el)) return;
    generations.set(el, gen(el) + 1);     // cancels any load in progress
    if (observer) observer.unobserve(el);
    var inst = instances.get(el) || null;
    emit(el, "destroy", inst);
    if (inst) {
      try {
        if (inst.infoWindow && inst.infoWindow.close) inst.infoWindow.close();
        if (inst.marker) { if (inst.marker.setMap) inst.marker.setMap(null); else inst.marker.map = null; }
        if (inst.map && google.maps.event && google.maps.event.clearInstanceListeners) google.maps.event.clearInstanceListeners(inst.map);
      } catch (e) { /* the map is being discarded */ }
    }
    removeAll(el, ".lgm-canvas, .lgm-preview, .lgm-placeholder");
    instances.delete(el);
    settings.delete(el);
    built.delete(el);
    resetState(el);
  }

  // ---- start -----------------------------------------------------------------------------------
  function start() {
    if (started) return;
    refreshConfig();
    started = true;
    try { injectCss(); } catch (e) { fail(null, "the default stylesheet could not be added.", e); }
    blockedBy = otherMapsScript();
    scan(document);
    early.splice(0).forEach(function (a) { safeScan(a[0], a[1]); });
    earlyLoads.splice(0).forEach(function (a) { safeLoad(a[0], a[1]); });
  }

  // The public API never throws into site code.
  function guard(name, fn, fallback) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { fail(null, name + "() failed.", e); return fallback ? fallback() : undefined; }
    };
  }
  function resolved() { return Promise.resolve(null); }
  var safeLoad = guard("load", load, resolved);
  var safeScan = guard("scan", scan);

  window.LazyGMaps = {
    version: VERSION,
    scan: safeScan,
    load: safeLoad,
    ready: guard("ready", ready, resolved),
    update: guard("update", update),
    destroy: guard("destroy", destroy),
    get: guard("get", function (el) { return (isElement(el) && instances.get(el)) || null; }),
    options: guard("options", function (el) { return (isElement(el) && settings.get(el)) || null; }),
    isBot: guard("isBot", isLikelyBot)
  };

  // Start once the page has been parsed and deferred scripts have run (DOMContentLoaded), so
  // configuration and init functions anywhere in the page are in place.
  function domContentLoadedFired() {
    if (document.readyState === "complete") return true;
    if (document.readyState === "loading") return false;
    var nav = window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    return !!(nav && nav.domContentLoadedEventStart > 0);
  }
  function safeStart() {
    try { start(); } catch (e) { fail(null, "could not start.", e); }
  }
  if (domContentLoadedFired()) {
    warnOnce("lateScript", "lazy-gmaps.js ran after the page finished loading (async, or injected by another " +
      "script). Maps still load; include it with <script defer> so it starts with the page.");
    safeStart();
  } else {
    document.addEventListener("DOMContentLoaded", safeStart, { once: true });
    window.addEventListener("load", safeStart, { once: true }); // fallback for browsers without navigation timing
  }
})();
