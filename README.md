# WeatherMap

A navigation PWA with live radar overlay and weather-adjusted ETAs. Built with vanilla JavaScript and Leaflet — no build step, no framework, no API keys required.

![WeatherMap](icons/icon-192.png)

---

## Features

**Navigation**
- Route planning with turn-by-turn directions (OSRM)
- Place search with proximity-biased autocomplete (Photon / Komoot)
- Tap the map to set origin or destination
- Live GPS tracking with follow mode
- Navigation mode with real-time ETA recalculation

**Weather-Adjusted ETAs**
- Routes divided into sample points; Open-Meteo weather fetched at each
- Two-pass algorithm: calculates adjusted arrival time, then refines with weather encountered along the adjusted route
- Speed factors per condition: storms 55–70%, snow 55–80%, rain 65–95%, fog 75–85%, clear 100%
- Color-coded route segments (green → orange → red → purple)
- Weather timeline strip showing conditions along the full route
- Departure time picker — plan around weather windows

**Radar**
- Animated radar overlay via RainViewer (past observations + nowcast)
- Frame playback with timeline slider and time labels
- Auto-refreshes every 10 minutes

**PWA**
- Installs to home screen on iOS and Android
- Offline-capable: app shell, tiles, and cached routes available without network
- Network-first for live data (radar, routing, weather), cache-first for app shell

---

## Stack

| Concern | Solution |
|---------|----------|
| Map | [Leaflet v1.9.4](https://leafletjs.com) + OpenStreetMap tiles |
| Routing | [OSRM](http://project-osrm.org) (demo server) |
| Geocoding | [Photon by Komoot](https://photon.komoot.io) |
| Weather | [Open-Meteo](https://open-meteo.com) (free, no key) |
| Radar | [RainViewer](https://www.rainviewer.com/api.html) |
| Offline | Service worker (Cache API, `weathermap-v4`) |

No npm. No build step. All dependencies via CDN.

---

## Running

```bash
# Any static file server works
python3 -m http.server 8080
# then open http://localhost:8080
```

Or just open `index.html` directly in a browser. The service worker requires a server origin for full PWA functionality.

---

## How the ETA Algorithm Works

1. Sample ~20 evenly-spaced points along the route (min 5km apart)
2. Deduplicate nearby points to minimize API calls
3. Fetch hourly weather forecast at each sample point (Open-Meteo)
4. Map WMO weather codes to speed factors (0.55–1.0)
5. **Pass 1:** Compute adjusted segment durations; accumulate arrival times per waypoint
6. **Pass 2:** Recompute with adjusted arrival times from pass 1 — accounts for the fact that weather at a waypoint depends on when you actually get there
7. Output: adjusted total ETA, per-segment colors, weather timeline

---

## Project Structure

```
index.html          App shell
manifest.json       PWA manifest
sw.js               Service worker (offline + caching)
css/main.css        All styles (dark theme, CSS variables)
js/
├── app.js          Orchestrator — state, initialization, user flows
├── map.js          Leaflet setup, markers, route polylines
├── geo.js          HTML5 Geolocation wrapper
├── search.js       Photon geocoding + autocomplete
├── routing.js      OSRM route computation + step extraction
├── weather.js      Open-Meteo fetch + WMO code mapping
├── radar.js        RainViewer tile layer + playback
├── route-weather.js  Weather sampling + two-pass ETA adjustment
├── eta.js          ETA formatting and display
├── ui.js           Bottom sheet, timeline, toasts, drag gestures
└── utils.js        Polyline decoding, haversine, formatting
```

---

## License

MIT
