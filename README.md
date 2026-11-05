# lazy-gmaps.js

Lazy-loaded Google Maps for any website. Maps are built with the Maps JavaScript API as they approach the viewport, never for bots, and are configured with HTML attributes. One file, no dependencies, no build step.

```html
<div data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613"></div>
```

**Version 0.1.0.** © 2026 Damian Justin. MIT licence. See [Licence](#licence).

## Features

- Maps are built as they approach the viewport, never during a prerender or in a hidden tab. Google's script is downloaded once, when the first map needs it.
- Markers, popups, map options, named styles with dark-mode pairs, and init functions for custom code.
- Crawlers, link-preview services, automation tools and HTTP clients get a link to Google Maps, never a map.
- Visitors never see an error message. If a map cannot be shown, the container shows a link to Google Maps and the reason is logged to the console.

Google bills each map built as one Dynamic Maps load. lazy-gmaps.js builds at most one map per container, only when it is about to be seen, and never for bots.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Attributes](#attributes)
- [Configuration](#configuration)
- [Init functions](#init-functions)
- [Styles and dark mode](#styles-and-dark-mode)
- [States and events](#states-and-events)
- [JavaScript API](#javascript-api)
- [Fallback content](#fallback-content)
- [CSS](#css)
- [One Google Maps script per page](#one-google-maps-script-per-page)
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
<script src="https://cdn.jsdelivr.net/npm/lazy-gmaps@0.1.0/lazy-gmaps.min.js" defer></script>
```

The same file is on unpkg at `https://unpkg.com/lazy-gmaps@0.1.0/lazy-gmaps.min.js`. To host it yourself, install it from npm (`npm install lazy-gmaps`) and point `src` at your copy of `lazy-gmaps.min.js`. `lazy-gmaps.js` is the readable source.

The key needs the Maps JavaScript API enabled.

lazy-gmaps.js starts when the page has been parsed, so maps anywhere in the page are found. The configuration and any [init functions](#init-functions) must be on the page by then.

Remove every other `<script src="https://maps.googleapis.com/maps/api/js…">` tag from the page (see [One Google Maps script per page](#one-google-maps-script-per-page)).

Each map container needs a height:

```css
.map { height: 400px; }
```

## Usage

### Map

```html
<div class="map" data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613" data-gmap-zoom="15"></div>
```

The map is centred on the coordinates and shows a marker there. Defaults come from [configuration](#configuration); attributes override them per map.

### Marker and popup

```html
<div class="map" data-gmap
     data-gmap-lat="-31.9523" data-gmap-lng="115.8613"
     data-gmap-title="Head office"
     data-gmap-popup="Open Monday to Friday, 9am–5pm"
     data-gmap-popup-open></div>
```

`data-gmap-title` is the marker's tooltip. `data-gmap-popup` text is shown in a Google info window when the marker is clicked, and `data-gmap-popup-open` opens it when the map is shown. Popup text is always inserted as text, not HTML. For popups with their own layout, create them in an [init function](#init-functions).

A custom marker icon is set for every map with the `marker` setting, or per map with `data-gmap-marker`. For a 2× image, give the display size:

```html
<div class="map" data-gmap data-gmap-lat="-31.9523" data-gmap-lng="115.8613"
     data-gmap-marker="/img/pin@2x.png" data-gmap-marker-size="24x33"></div>
```

`data-gmap-marker="none"` hides the marker.

### Map options

Any `google.maps.Map` option can be set for all maps with `mapOptions`, and per map with JSON in `data-gmap-options`:

```html
<div class="map" data-gmap data-gmap-lat="-31.95" data-gmap-lng="115.86"
     data-gmap-options='{"disableDefaultUI": true, "zoomControl": true}'></div>
```

The centre and zoom always come from the attributes and the `zoom` setting.

### Maps added after page load

Containers added later (AJAX, tabs, modals) are set up with `LazyGMaps.scan(container)`, or loaded straight away with `LazyGMaps.load(container)`. Remove a map with `LazyGMaps.destroy(container)`:

```js
function openModal(lat, lng) {
    modalBody.innerHTML = `<div class="map" data-gmap data-gmap-lat="${lat}" data-gmap-lng="${lng}"></div>`;
    LazyGMaps.load(modalBody.firstElementChild);
}
function closeModal() {
    LazyGMaps.destroy(modalBody.firstElementChild);
    modalBody.innerHTML = "";
}
```

Each new map is a separate billable map load.

---

## Attributes

| Attribute | Description |
| --- | --- |
| `data-gmap` | Marks the element as a map. |
| `data-gmap-lat`, `data-gmap-lng` | Coordinates of the centre and marker. Required. |
| `data-gmap-zoom` | Zoom level. Default: the `zoom` setting (15). |
| `data-gmap-title` | Marker tooltip. |
| `data-gmap-marker` | Marker icon URL, `show` or `none`. Default: a marker using the `marker` setting; no marker on maps with an init function unless they set this or `data-gmap-popup`. |
| `data-gmap-marker-size` | Marker display size, e.g. `24x33`, for a 2× image. |
| `data-gmap-popup` | Popup text for the marker. |
| `data-gmap-popup-open` | Opens the popup when the map is shown. |
| `data-gmap-style` | Name of a style set in `styles`. |
| `data-gmap-map-id` | Google Cloud Map ID. |
| `data-gmap-options` | JSON object of `google.maps.Map` options. |
| `data-gmap-libraries` | Additional Google libraries for this map, e.g. `places,geometry`. |
| `data-gmap-init` | Name of a global function called as `fn(map, ctx)`, e.g. `addListings` or `Site.maps.init`. |

Attributes are read when the container is set up.

## Configuration

`window.lazyGMapsConfig` accepts the following settings. Set it before lazy-gmaps.js.

| Setting | Default | Description |
| --- | --- | --- |
| `key` | `""` | Google Maps Platform API key. |
| `v` | `"weekly"` | Maps JavaScript API version. |
| `libraries` | `[]` | Additional Google libraries for every map, e.g. `["places"]`. `maps` and `marker` are always loaded. |
| `zoom` | `15` | Default zoom. |
| `mapId` | `""` | Default Map ID. |
| `styles` | `null` | Style array, or named sets `{ "default", "default/dark", "name", "name/dark" }`. |
| `darkMode` | `true` | Follow the browser's dark mode (see [Styles and dark mode](#styles-and-dark-mode)). |
| `mapOptions` | `{}` | `google.maps.Map` options for every map. |
| `marker` | `""` | Default marker icon URL. Empty uses Google's marker. |
| `markerSize` | `""` | Default marker display size, e.g. `"24x33"`. |
| `rootMargin` | `"200px 0px"` | Distance from the viewport at which maps start loading. |
| `timeout` | `20000` | Milliseconds to wait for the Maps JavaScript API before a map is treated as failed. |
| `loaderParams` | `{}` | Other Maps JavaScript API parameters: `language`, `region`, `mapIds`, `channel`, `authReferrerPolicy`. |
| `isBot` | `null` | `function (userAgent)` returning `true` for bots; replaces the built-in check. |
| `css` | `true` | Inject the default stylesheet (see [CSS](#css)). |
| `linkText` | `"Open in Google Maps"` | Text of the fallback link. |

### Combining configuration from several sources

Settings can come from more than one place, for example a plugin and a theme. Each source pushes its own object; later entries replace earlier ones setting by setting.

```js
(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ key: "YOUR_API_KEY" });
(window.lazyGMapsConfig = window.lazyGMapsConfig || []).push({ mapOptions: { scrollwheel: false } });
```

All configuration must be in place before lazy-gmaps.js starts: in inline scripts, or in scripts earlier in the page without `async`.

## Init functions

An init function adds your own code to a map: several markers, custom popups, layers, listeners.

```html
<div class="map" data-gmap
     data-gmap-lat="-31.95" data-gmap-lng="115.86" data-gmap-zoom="10"
     data-gmap-init="addListings"></div>

<script>
    const listings = [
        { title: "North", position: { lat: -31.89, lng: 115.84 } },
        { title: "South", position: { lat: -32.05, lng: 115.88 } }
    ];

    function addListings(map, ctx) {
        const bounds = new ctx.google.maps.LatLngBounds();
        listings.forEach((listing) => {
            new ctx.google.maps.Marker({ map, position: listing.position, title: listing.title });
            bounds.extend(listing.position);
        });
        map.fitBounds(bounds);
    }
</script>
```

`data-gmap-init` names a global function, or a dotted path such as `Site.maps.init`. Define it in the page, or in a script loaded before lazy-gmaps.js starts (inline, or with `defer`). It is called once per map, after the map is created with its centre, zoom, styles, options and default marker:

| Argument | Contents |
| --- | --- |
| `map` | The `google.maps.Map`. |
| `ctx.el` | The container element. |
| `ctx.options` | The map's settings from its attributes and configuration: `lat`, `lng`, `zoom`, `init`, `title`, `marker`, `markerSize`, `popup`, `popupOpen`, `style`, `mapId`, `libraries`, `mapOptions`. |
| `ctx.marker` | The default marker, or `null`. A `google.maps.marker.AdvancedMarkerElement` on maps with a Map ID, otherwise a `google.maps.Marker`. |
| `ctx.infoWindow` | The popup's `google.maps.InfoWindow`, or `null`. |
| `ctx.google` | The `google` namespace. |

The function may be `async` or return a promise; the map's `ready` state waits for it. Several maps can share one function, or each can name its own.

A map with an init function has no default marker; its coordinates set the initial view. Add `data-gmap-marker="show"` (or popup text) to keep the default marker.

## Styles and dark mode

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

A map uses the `default` set, or the set named by `data-gmap-style="muted"`. When the visitor's browser is in dark mode (`prefers-color-scheme: dark`), the matching `/dark` set is used if there is one. The browser setting is read when the map is built.

Maps without styles or a Map ID use Google's own dark mode in dark browsers (`colorScheme: "FOLLOW_SYSTEM"`). Set `colorScheme` in `mapOptions` or `data-gmap-options` to choose otherwise, or `darkMode: false` to turn off automatic dark mode.

`styles` given in `data-gmap-options` replace the configured sets for that map. Maps with a Map ID are styled in the Google Cloud console instead.

## States and events

Each container has a `data-gmap-state` attribute and dispatches a matching `gmap:<state>` event. All events bubble, so one listener on `document` covers every map.

| State | Meaning | `event.detail` |
| --- | --- | --- |
| `waiting` | Waiting to approach the viewport. | |
| `loading` | Loading the Maps JavaScript API and building the map. | |
| `ready` | Shown, with its init function finished. | `{ map, marker, infoWindow }` |
| `skipped` | Not built because the visitor was identified as a bot. The container shows its fallback. | `{ reason: "bot" }` |
| `error` | The map could not be shown. The container shows its fallback. | `{ reason, error }` |

| Reason | Cause | Fix |
| --- | --- | --- |
| `invalid` | Missing or invalid `data-gmap-lat` or `data-gmap-lng`. | Correct the attributes. |
| `blocked` | Another script on the page loads Google Maps. | Remove it (see [One Google Maps script per page](#one-google-maps-script-per-page)). |
| `auth` | Google rejected the API key. | Check the key's referrer restrictions, enabled APIs and billing. |
| `load` | The Maps JavaScript API failed to load or did not respond within `timeout`. | Check the network panel and the key. |

`gmap:destroy` is dispatched when `LazyGMaps.destroy()` removes a map. `event.detail` is `{ map, marker, infoWindow }`, or `null` if no map was built. After `destroy`, the container has no state.

```js
document.addEventListener("gmap:ready", (e) => {
    analytics.track("map_shown", { id: e.target.id });
});
```

Map interaction events (click, drag, zoom) are available on the map object via `ready()`, `get()` or an init function.

## JavaScript API

| Method | Description |
| --- | --- |
| `LazyGMaps.scan(root?)` | Sets up map containers inside `root` (or `root` itself) that are not yet set up. Default: `document`. |
| `LazyGMaps.load(el)` | Loads a map now, without waiting for it to approach the viewport. Returns the same promise as `ready()`. A visitor identified as a bot still gets no map. |
| `LazyGMaps.ready(el)` | Promise resolving with `{ map, marker, infoWindow }` once the map is shown, or with `null` if it is skipped, fails or is destroyed. |
| `LazyGMaps.get(el)` | `{ map, marker, infoWindow }`, or `null` before the map is built. |
| `LazyGMaps.destroy(el)` | Removes a map, its marker and popup, and its state. The container can then be set up again with `scan()` or `load()`. |
| `LazyGMaps.isBot()` | `true` if the current visitor is treated as a bot. |
| `LazyGMaps.version` | `"0.1.0"`. |

The API does not throw. `scan()`, `load()` and `destroy()` called before the page has finished parsing wait for it.

```js
LazyGMaps.ready(document.getElementById("office-map")).then((shown) => {
    if (shown) shown.map.addListener("click", (e) => console.log(e.latLng.toJSON()));
});
```

## Fallback content

An empty container receives a link to the location on Google Maps:

```html
<div class="lgm-fallback"><a href="https://www.google.com/maps/search/?api=1&query=-31.9523,115.8613" target="_blank" rel="noopener">Open in Google Maps</a></div>
```

The link shows while the map loads, for bots, and when a map cannot be shown. It is removed once the map is shown. Change its text with `linkText`.

A container that already has content keeps it instead, and the map is drawn over it. Render the fallback on the server to support visitors without JavaScript:

```php
<div class="map" data-gmap
     data-gmap-lat="<?php echo esc_attr( $lat ); ?>" data-gmap-lng="<?php echo esc_attr( $lng ); ?>">
    <a href="https://www.google.com/maps/search/?api=1&amp;query=<?php echo rawurlencode( $lat . ',' . $lng ); ?>">
        Open in Google Maps
    </a>
</div>
```

Do not render map images on the server: they would load for bots and be billed.

## CSS

lazy-gmaps.js adds a small stylesheet to the start of `<head>`. Its rules use `:where()`, so they have zero specificity and any site rule overrides them:

```css
:where([data-gmap]) { position: relative; overflow: hidden; }
:where(.lgm-canvas) { position: absolute; inset: 0; }
:where(.lgm-pending) { opacity: 0; }
:where(.lgm-fallback) { display: grid; place-items: center; height: 100%; }
```

| Class | Element |
| --- | --- |
| `.lgm-canvas` | The element the map is drawn in. It fills the container. |
| `.lgm-pending` | On `.lgm-canvas` until the map has first drawn. |
| `.lgm-fallback` | The wrapper around the fallback link. |

`data-gmap-state` can also be used in selectors, e.g. `.map[data-gmap-state="skipped"]`.

Set `css: false` to leave styling entirely to the site. The container then needs `position: relative` and `.lgm-canvas` needs a size.

## One Google Maps script per page

lazy-gmaps.js loads the Maps JavaScript API itself, with Google's bootstrap loader, when the first map needs it. Two copies of the API on one page break each other, so if another script loads Google Maps (an old theme tag, another plugin), maps are not built. Containers show their fallback, the state is `error` with reason `blocked`, and the console names the other script.

Remove the other `maps.googleapis.com/maps/api/js` tag. Other code that uses `google.maps` belongs in an [init function](#init-functions), or after `LazyGMaps.ready()` resolves.

## Bot filtering

Maps are not built when the visitor:

1. sends no user agent, or is controlled by WebDriver (`navigator.webdriver`), as with Selenium, Playwright and Puppeteer;
2. has a user agent containing a term used by crawlers and tools: `bot`, `agent`, `crawl`, `spider`, `slurp`, `external`, `whatsapp`, `preview`, `headless`, `phantom`, `selenium`, `puppeteer`, `playwright`, `curl`, `wget`, `python`, `java`, `axios`, `node-fetch`, `libwww`, `http`, `lighthouse`, `pagespeed`, `inspect`, `monitor`, `uptime`, `scan`, and several named AI and Google fetchers; or
3. reports a Chrome version below 100.

These visitors get the container's fallback, and the state is `skipped`. `LazyGMaps.load()` follows the same check.

The check identifies clients that declare themselves; it cannot identify automation that imitates a current browser. Replace it with the `isBot` setting.

## Security

- **API key:** restrict it to your sites' HTTP referrers and to the Maps JavaScript API. The key is visible in page source, as with any browser use of Google Maps.
- **Quotas:** set a daily quota for the Dynamic Maps SKU in the Google Cloud console.
- **Content Security Policy:** with a nonce-based policy, lazy-gmaps.js and Google's loader reuse the page's nonce. See Google's [CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy) for allowlist policies.
- **Key errors:** lazy-gmaps.js handles `window.gm_authFailure`. A handler assigned with `window.gm_authFailure = …` is also called.

## Troubleshooting

Problems are logged to the console with the prefix `lazy-gmaps:`, for example:

- `set lazyGMapsConfig.key.`
- `unknown setting "zoomLevel" ignored.`
- `data-gmap-lat and data-gmap-lng are required.`
- `data-gmap-options is not a JSON object.`
- `no style set "muted".`
- `data-gmap-init "addListings" not found.`
- `another script loads Google Maps; remove it.`
- `Google rejected the API key.` (check the key's referrer restrictions, enabled APIs and billing)
- `a map has no height.`
- `the map could not load.`

A missing or failing init function does not stop the map: it is shown with its centre, zoom and styles (and its default marker, if it has one), and the error is logged.

## Browser support

The browsers supported by the Maps JavaScript API: current Chrome, Edge and Firefox; the two latest Safari versions; current and previous iOS.

## Licence

lazy-gmaps.js is released under the MIT License. Copyright © 2026 Damian Justin. See [LICENSE](LICENSE).

It includes the Google Maps JavaScript API bootstrap loader, Copyright Google LLC, licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

Use of Google Maps Platform is subject to the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms).
