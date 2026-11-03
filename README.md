# lazy-gmaps.js

Lazy-loaded Google Maps for any website: free embeds, dynamic maps, click-to-load previews and bot filtering, configured with HTML attributes. One file, no dependencies, no build step.

```html
<div data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613"></div>
```

**Version 0.1.0.** © 2026 Damian Justin. MIT licence. See [Licence](#licence).

## Features

- **Two map modes.** `embed` uses the Maps Embed API (an iframe with Google's marker; no usage charge). `dynamic` uses the Maps JavaScript API, with custom markers, popups, styles and map options.
- **Lazy loading.** Maps load as they approach the viewport, never during a speculative prerender or in a hidden tab. Google's script is downloaded only when the first dynamic map needs it, and only once per page.
- **Click to load.** A dynamic map can show a static image of itself until it is clicked.
- **Bot filtering.** Dynamic maps and static previews are not loaded for crawlers, link-preview services, automation tools or HTTP clients.
- **Extensible.** An init function receives each finished map for custom markers, overlays or layers.
- **Lifecycle API and events.** `ready`, `update`, `destroy` and bubbling `gmap:*` events.
- **Site-wide defaults.** Key, marker, styles (including dark mode), popup template and map options are set once in configuration.
- **Progressive enhancement.** Server-rendered fallback content is kept until the map replaces it.
- **Quiet failures.** Visitors never see an error message. If a map cannot load, the container shows its fallback link; the reason is in the console.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Attributes](#attributes)
- [Configuration](#configuration)
- [JavaScript API](#javascript-api)
- [States and events](#states-and-events)
- [Fallback content](#fallback-content)
- [Errors](#errors)
- [Script loading](#script-loading)
- [Bot filtering](#bot-filtering)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Browser support](#browser-support)
- [Licence](#licence)

---

## Installation

Add the configuration, then the script with `defer`, to the `<head>` of every page that may show a map:

```html
<script>
  window.lazyGMapsConfig = { key: "YOUR_API_KEY" };
</script>
<script src="https://cdn.jsdelivr.net/npm/lazy-gmaps@0.1.0/lazy-gmaps.js" defer></script>
```

To host the file yourself, install it from npm (`npm install lazy-gmaps`) or download `lazy-gmaps.js`, and point `src` at your copy.

The key needs the Maps JavaScript API, Maps Static API and Maps Embed API enabled.

Remove every other `<script src="https://maps.googleapis.com/maps/api/js…">` tag from the page. lazy-gmaps.js loads Google Maps itself, and does not load dynamic maps while another copy is on the page (see [Errors](#errors)).

Each map container needs a height:

```css
.map { height: 400px; }
```

## Usage

### Embed map

```html
<div class="map" data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613" data-gmap-zoom="15"></div>
```

`data-gmap-query` can replace the coordinates with an address, place name, plus code or place ID:

```html
<div class="map" data-gmap data-gmap-query="Kings Park, Perth WA"></div>
```

### Dynamic map

```html
<div class="map" data-gmap data-gmap-mode="dynamic"
     data-gmap-lat="-31.9523" data-gmap-lng="115.8613" data-gmap-zoom="15"
     data-gmap-title="Head office"
     data-gmap-popup="Open Monday to Friday, 9am–5pm"></div>
```

The map is centred on the coordinates and shows a marker there. The marker icon, styles and other defaults come from [configuration](#configuration); attributes override them per map.

### Click to load

```html
<div class="map" data-gmap data-gmap-mode="dynamic" data-gmap-trigger="click"
     data-gmap-lat="-31.9523" data-gmap-lng="115.8613"></div>
```

Until clicked, the container shows a Maps Static API image with the same centre, zoom, marker and styles. Clicking it loads the interactive map in its place. Use `data-gmap-preview="none"` to show a "Show map" button instead of the image.

On an embed map, `data-gmap-trigger="click"` shows a "Show map" button.

### Init function

```html
<div class="map" data-gmap data-gmap-mode="dynamic"
     data-gmap-lat="-31.95" data-gmap-lng="115.86" data-gmap-zoom="10"
     data-gmap-init="addListings"></div>

<script>
  function addListings(map, ctx) {
    const bounds = new google.maps.LatLngBounds();
    listings.forEach((listing) => {
      new google.maps.Marker({ map, position: listing.position, icon: ctx.options.markerIcon });
      bounds.extend(listing.position);
    });
    map.fitBounds(bounds);
  }
</script>
```

Define the function in the page or in a script that loads before the page finishes parsing (inline, or with `defer`). It is called once per map, after the map is created with its styles and options:

| Argument | Contents |
| --- | --- |
| `map` | The `google.maps.Map` |
| `ctx.el` | The container element |
| `ctx.options` | The map's resolved options (see `LazyGMaps.options`) |
| `ctx.marker`, `ctx.infoWindow` | The default marker and popup, if shown |
| `ctx.google` | The `google` namespace |

A map with an init function has no default marker; its coordinates set the initial view. Add `data-gmap-marker="show"` (or popup text) to keep the default marker. The function may return a promise. Several maps can share one function, or each can name its own. A dotted name such as `Site.maps.init` is also accepted.

If the function is missing or throws, the map is still shown with its centre, zoom, styles and marker, and the error is logged to the console.

### Styles and dark mode

Styles are defined in configuration, either as a single array used by every map or as named sets:

```js
window.lazyGMapsConfig = {
  key: "YOUR_API_KEY",
  styles: {
    "default":      [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
    "default/dark": [{ featureType: "all", stylers: [{ invert_lightness: true }] }],
    "muted":        [{ featureType: "all", stylers: [{ saturation: -80 }] }],
    "muted/dark":   [{ featureType: "all", stylers: [{ saturation: -80 }, { lightness: -60 }] }]
  }
};
```

A map uses the `default` set, or the set named by `data-gmap-style="muted"`. When the visitor's browser is in dark mode, the matching `/dark` set is used if there is one. The browser setting is read when the map is set up.

Dynamic maps without styles or a Map ID use Google's own dark mode in dark browsers (`colorScheme: FOLLOW_SYSTEM`). Set `colorScheme` in `mapOptions` or `data-gmap-options` to choose otherwise, or `darkMode: false` to use light styles everywhere.

`styles` given in `data-gmap-options` replace the configured sets for that map. Maps with a Map ID are styled in the Google Cloud console instead.

### Popups

`data-gmap-popup` text is shown in a Google info window when the marker is clicked. Text is always inserted as text, not HTML.

To use the same layout for every popup, point `popupTemplate` at a `<template>` element. Elements with `data-gmap-field="title"` and `data-gmap-field="popup"` receive the map's title and popup text:

```html
<template id="map-popup">
  <div class="popup"><h3 data-gmap-field="title"></h3><p data-gmap-field="popup"></p></div>
</template>
<script>window.lazyGMapsConfig = { key: "YOUR_API_KEY", popupTemplate: "#map-popup" };</script>
```

`data-gmap-popup-template` sets a template for one map. For popups that need full control of their appearance, create them in an init function.

### Map options

Any `google.maps.Map` option can be set for all dynamic maps with `mapOptions`, and per map with JSON in `data-gmap-options`:

```html
<div data-gmap data-gmap-mode="dynamic" data-gmap-options='{"disableDefaultUI": true, "zoomControl": true}' …></div>
```

### Maps added after page load

Containers added later (AJAX, tabs, modals) are set up with `LazyGMaps.scan(container)` or loaded immediately with `LazyGMaps.load(container)`. Both accept settings that apply to those maps only, such as `LazyGMaps.load(el, { zoom: 12, mapOptions: { gestureHandling: "greedy" } })`. Remove a map with `LazyGMaps.destroy(container)`:

```js
function openModal(lat, lng) {
  modalBody.innerHTML = `<div class="map" data-gmap data-gmap-mode="dynamic" data-gmap-lat="${lat}" data-gmap-lng="${lng}"></div>`;
  LazyGMaps.load(modalBody.firstElementChild);
}
function closeModal() {
  LazyGMaps.destroy(modalBody.firstElementChild);
  modalBody.innerHTML = "";
}
```

Each new dynamic map is a separate billable map load.

---

## Attributes

| Attribute | Mode | Description |
| --- | --- | --- |
| `data-gmap` | all | Marks the element as a map. |
| `data-gmap-mode` | all | `embed` (default) or `dynamic`. |
| `data-gmap-trigger` | all | `auto` (default): load near the viewport. `click`: load on click. |
| `data-gmap-lat`, `data-gmap-lng` | all | Coordinates. Required, except for embed maps with `data-gmap-query`. |
| `data-gmap-zoom` | all | Zoom level. Default `zoom` setting (15). |
| `data-gmap-title` | all | Accessible name; also the marker tooltip and the popup template title. |
| `data-gmap-query` | embed | Address, place name, plus code or place ID instead of coordinates. |
| `data-gmap-marker` | dynamic | Marker icon URL, `show`, or `none`. Default: a marker using the `marker` setting; none on maps with an init function unless they have popup text. |
| `data-gmap-marker-size` | dynamic | Marker display size, e.g. `24x33`, for a 2× image. |
| `data-gmap-map-id` | dynamic | Google Cloud Map ID. |
| `data-gmap-style` | dynamic | Name of a style set in `styles`. |
| `data-gmap-options` | dynamic | JSON object of `google.maps.Map` options. |
| `data-gmap-popup` | dynamic | Popup text for the marker. |
| `data-gmap-popup-template` | dynamic | CSS selector of a `<template>` for this map's popup. |
| `data-gmap-popup-open` | dynamic | Opens the popup when the map loads. |
| `data-gmap-init` | dynamic | Name of a global function called as `fn(map, ctx)`, e.g. `addListings` or `Site.maps.init`. |
| `data-gmap-libraries` | dynamic | Additional Google libraries for this map, e.g. `places,geometry`. |
| `data-gmap-preview` | dynamic, click | `none` shows a button instead of a static image. |
| `data-gmap-static-src` | dynamic, click | Preview image URL to use as is, e.g. a URL signed on the server. |

Inside a container, `data-gmap-load` marks an element that loads the map when clicked, and `data-gmap-placeholder` marks content to remove once the map is shown.

## Configuration

`window.lazyGMapsConfig` accepts the following settings. Set it before lazy-gmaps.js. Attributes override settings per map.

| Setting | Default | Description |
| --- | --- | --- |
| `key` | `""` | Google Maps Platform API key. |
| `v` | `"weekly"` | Maps JavaScript API version. |
| `libraries` | `["maps", "marker"]` | Libraries imported for every dynamic map. |
| `zoom` | `15` | Default zoom. |
| `mapId` | `""` | Default Map ID. |
| `styles` | `null` | Style array, or named sets `{ "default", "default/dark", "name", "name/dark" }`. |
| `darkMode` | `true` | Follow the browser's dark mode (see [Styles and dark mode](#styles-and-dark-mode)). |
| `mapOptions` | `{}` | `google.maps.Map` options for every dynamic map. |
| `marker` | `""` | Default marker icon URL (PNG, JPEG or GIF). |
| `markerSize` | `""` | Default marker display size, e.g. `"24x33"`. |
| `popupTemplate` | `""` | CSS selector of the default popup `<template>`. |
| `rootMargin` | `"200px 0px"` | Distance from the viewport at which maps start loading. |
| `timeout` | `20000` | Milliseconds before a Maps JavaScript API load is treated as failed. |
| `loaderParams` | `{}` | `language`, `region`, `mapIds`, `channel`, `authReferrerPolicy`. |
| `isBot` | `null` | `function (userAgent)` returning `true` for bots; replaces the built-in check. |
| `css` | `true` | Inject the default stylesheet. |
| `debug` | `false` | Log each decision to the console. |
| `text` | | Labels: `show` ("Show map"), `explore` ("Explore map"), `open` ("Open in Google Maps"). |

### Combining configuration from several sources

Settings can come from more than one place, for example a plugin and a theme. Each source pushes its own object; later entries override earlier ones setting by setting, and `mapOptions`, `loaderParams`, `text` and named `styles` sets are merged.

```js
(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ key: "YOUR_API_KEY" });
(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ mapOptions: { scrollwheel: false } });
```

All configuration must be in place before lazy-gmaps.js: in inline scripts or scripts without `async`, earlier in the page.

## JavaScript API

| Method | Description |
| --- | --- |
| `LazyGMaps.scan(root?, settings?)` | Sets up containers inside `root` (or `root` itself) that are not yet set up. `settings` apply to those maps only. |
| `LazyGMaps.load(el, settings?)` | Loads a map immediately, ignoring the viewport, click and bot checks. `settings` apply to this map only. |
| `LazyGMaps.ready(el)` | Promise resolving with `{ map, marker, infoWindow }` (or `{ iframe }`) once the map is shown, or with `null` if it is destroyed first. |
| `LazyGMaps.update(el, { lat, lng, zoom, query })` | Moves a map and its marker without rebuilding it. |
| `LazyGMaps.destroy(el)` | Removes a map, its click handling and its state, cancelling any load in progress. The container can then be set up again with `scan()` or `load()`. |
| `LazyGMaps.get(el)` | `{ map, marker, infoWindow }`, `{ iframe }` or `null`. |
| `LazyGMaps.options(el)` | The map's resolved options, or `null`. |
| `LazyGMaps.isBot()` | `true` if the current visitor is treated as a bot. |
| `LazyGMaps.version` | `"0.1.0"`. |

Per-call `settings` take the same form as `lazyGMapsConfig`. `key`, `v`, `loaderParams`, `isBot`, `css`, `debug` and `rootMargin` apply to the whole page and are set only in `lazyGMapsConfig`.

The API does not throw: invalid arguments are reported in the console.

## States and events

Each container has a `data-gmap-state` attribute and dispatches a matching `gmap:<state>` event. All events bubble, so one listener on `document` covers every map.

| State | Meaning |
| --- | --- |
| `waiting` | Waiting for the viewport or a click. |
| `preview` | Showing a static image (dynamic map with click trigger). |
| `loading` | Loading. |
| `ready` | Shown. `event.detail` is `{ map, marker, infoWindow }` or `{ iframe }`. |
| `skipped` | Not loaded because the visitor was identified as a bot. The "Show map" button still loads it. |
| `error` | The map could not be shown; the container shows its fallback link. `event.detail.reason` is `invalid`, `blocked`, `auth` or `load` (see [Errors](#errors)). |

Other events:

| Event | When | `event.detail` |
| --- | --- | --- |
| `gmap:map` | The map object exists, before the init function runs | `{ map, marker, infoWindow }` |
| `gmap:update` | After `LazyGMaps.update()` | `{ options }` |
| `gmap:destroy` | Before `LazyGMaps.destroy()` removes the map | `{ map, marker, infoWindow }`, `{ iframe }` or `null` |

After `destroy`, the container has no state.

```js
document.addEventListener("gmap:ready", (e) => {
  analytics.track("map_shown", { id: e.target.id, mode: LazyGMaps.options(e.target).mode });
});
```

Map interaction events (click, drag, zoom) are available on the map object via `ready()` or `get()`.

## Fallback content

Content inside a container is shown until the map loads:

- Elements marked `data-gmap-placeholder` are removed when the map is shown.
- Unmarked content stays.
- An element marked `data-gmap-load` loads the map when clicked.
- An empty container receives an "Open in Google Maps" link and a "Show map" button. The button is visible only on maps that load on click and for visitors identified as bots. A container whose content has no `data-gmap-load` element receives the button only.

To support visitors without JavaScript, render the fallback on the server:

```php
<div class="map" data-gmap data-gmap-mode="dynamic"
     data-gmap-lat="<?php echo esc_attr( $lat ); ?>" data-gmap-lng="<?php echo esc_attr( $lng ); ?>">
  <a data-gmap-placeholder
     href="https://www.google.com/maps/search/?api=1&amp;query=<?php echo rawurlencode( $lat . ',' . $lng ); ?>">
    Open in Google Maps
  </a>
</div>
```

Do not render Maps Static API images on the server: they would load for bots and be billed. lazy-gmaps.js adds the preview image after the bot check.

## Errors

Visitors never see an error message. When a map cannot be shown, the container shows its fallback: the "Open in Google Maps" link, or the content rendered by the server. The reason is logged to the console and given in the `gmap:error` event.

| Reason | Cause | Fix |
| --- | --- | --- |
| `invalid` | Missing coordinates, or an unknown mode or trigger. | Correct the attributes. |
| `blocked` | Another script on the page loads Google Maps. Loading a second copy breaks both, so dynamic maps are not loaded. Embed maps still load. | Remove the other `maps/api/js` script tag. |
| `auth` | Google rejected the API key. | Check the key's referrer restrictions, enabled APIs and billing. |
| `load` | The Maps JavaScript API failed to load or did not respond within `timeout`. | Check the network panel and the key. |

Problems that leave a usable map are logged without changing the state:

- a missing or failing init function (the base map is shown);
- a marker icon or popup template that cannot be used;
- a static preview image that fails to load (a "Show map" button replaces it).

## Script loading

Include the configuration, then lazy-gmaps.js with `defer`, in `<head>`. lazy-gmaps.js starts when the page has been parsed, so maps anywhere in the page are found, and init functions defined anywhere in the page are available.

Everything a map needs must be on the page by then:

- configuration in `window.lazyGMapsConfig`;
- init functions;
- no other Google Maps `<script>` tag.

## Bot filtering

Dynamic maps and their static previews are not loaded when the visitor:

1. sends no user agent, or is controlled by WebDriver (`navigator.webdriver`), as with Selenium, Playwright and Puppeteer;
2. has a user agent containing a term used by crawlers and tools: `bot`, `agent`, `crawl`, `spider`, `slurp`, `external`, `whatsapp`, `preview`, `headless`, `phantom`, `selenium`, `puppeteer`, `playwright`, `curl`, `wget`, `python`, `java`, `go-http`, `okhttp`, `axios`, `node-fetch`, `libwww`, `http`, `lighthouse`, `pagespeed`, `inspect`, `monitor`, `uptime`, `scan`, and several named AI and Google fetchers; or
3. reports a Chrome version below 100.

Embed maps are always loaded, because the Maps Embed API has no usage charge.

The check identifies clients that declare themselves; it cannot identify automation that imitates a current browser. Visitors identified in error can load the map with the "Show map" button. Replace the check with the `isBot` setting.

The check has been tested against 36 browsers and in-app browsers (no false positives) and 59 crawlers, preview services and tools (all identified).

## Security

- **Restrict the API key** to your sites' HTTP referrers, and to the Maps JavaScript API, Maps Static API and Maps Embed API. The key is visible in page source, as with any browser use of Google Maps.
- **Set daily quotas** for the Dynamic Maps and Static Maps SKUs in the Google Cloud console.
- **Signed Static Maps URLs:** Google recommends signing Maps Static API requests. Sign on the server, keep the signing secret there, and pass the signed URL in `data-gmap-static-src`.
- **Content Security Policy:** with a nonce-based policy, lazy-gmaps.js and Google's loader reuse the page's nonce. Allow `https://maps.googleapis.com` in `img-src` for previews and `https://www.google.com` in `frame-src` for embeds. See Google's [CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy) for allowlist policies.
- **Key errors:** lazy-gmaps.js handles `window.gm_authFailure`. A handler assigned with `window.gm_authFailure = …` is also called.

## Troubleshooting

Set `debug: true` to log each decision:

```
[lazy-gmaps] #map1 -> skipped { reason: "bot" }
```

Configuration errors are always logged, for example:

- `dynamic map needs data-gmap-lat and data-gmap-lng.`
- `unknown data-gmap-mode="fancy". Use embed or dynamic.`
- `data-gmap-options is not a valid JSON object (use double quotes)`
- `no style set "muted" in lazyGMapsConfig.styles; using "default"`
- `data-gmap-init="addListings" is not a global function. The map is shown without it.`
- `another script on this page already loads Google Maps. Dynamic maps are not loaded …`
- `isBot threw; using the built-in check`
- `a map container has zero height; give it a CSS height.`
- `Static Maps cannot use SVG marker icons; use a PNG.`

## Browser support

The browsers supported by the Maps JavaScript API: current Chrome, Edge and Firefox; the two latest Safari versions; current and previous iOS. Browsers without IntersectionObserver load maps immediately.

## Licence

lazy-gmaps.js is released under the MIT License. Copyright © 2026 Damian Justin. See [LICENSE](LICENSE).

It includes the Google Maps JavaScript API bootstrap loader, Copyright Google LLC, licensed under the Apache License, Version 2.0. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Use of Google Maps Platform is subject to the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms).
