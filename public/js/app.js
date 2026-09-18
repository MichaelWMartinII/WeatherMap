/**
 * app.js — Orchestrator: state, bootstrap, route flow
 */
const App = (() => {

  // App state
  const state = {
    origin: null,       // { lat, lng, name }
    destination: null,   // { lat, lng, name }
    route: null,         // from RoutingModule
    routeWeather: null,  // from RouteWeather
    departureTime: new Date(),
    navigating: false,
    hasGps: false,
  };

  const NAV_RECALC_INTERVAL_MS = 60000; // recalculate ETA every 60s while navigating
  let navRecalcTime = 0;

  async function init() {
    try {
      console.log('[WM] init start');
      // 1. Init map
      const map = MapModule.init('map');
      console.log('[WM] map ready');

      // 2. Init radar and show by default
      RadarModule.init(map);
      RadarModule.show();

      // 3. Init UI
      UI.init({
        onResult: handleSearchResult,
        onClear: handleClearRoute,
        onDeparture: handleDepartureChange,
      });
      UI.setRefreshDisplay(refreshDisplay);
      console.log('[WM] UI ready');

      // 4. Wire up top bar buttons
      document.getElementById('btn-radar').addEventListener('click', () => RadarModule.toggle());
      document.getElementById('btn-locate').addEventListener('click', handleLocate);
      document.getElementById('btn-start-nav').addEventListener('click', toggleNavigation);
      document.getElementById('btn-share').addEventListener('click', handleShareToggle);
      document.getElementById('btn-stop-tracking').addEventListener('click', handleStopTracking);

      // 6. Tap-on-map to set origin/destination
      setupMapTap(map);

      // 7. Get current location
      try {
        const pos = await GeoModule.getCurrentPosition();
        state.hasGps = true;
        GeoModule.showDot(map);
        GeoModule.watchPosition(handleGpsUpdate);
        state.origin = { lat: pos.lat, lng: pos.lng, name: 'Current location' };
        UI.setFromText('Current location');
        MapModule.flyTo(pos.lat, pos.lng, 12);
        console.log('[WM] GPS ok, origin set');
      } catch {
        state.hasGps = false;
        document.getElementById('input-from').placeholder = 'Tap map or type address';
        UI.toast('Tap the map to set your start and destination', 'info', 5000);
        console.log('[WM] No GPS');
      }

      // 8. Check for incoming share link (?track=TOKEN)
      const incomingToken = ShareModule.getIncomingToken();
      if (incomingToken) {
        history.replaceState({}, '', location.pathname); // clean URL
        startTracking(incomingToken);
      }

      // 8. Register service worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
      console.log('[WM] init complete');
    } catch (err) {
      console.error('[WM] INIT FAILED:', err);
    }
  }

  async function handleLocate() {
    try {
      const pos = await GeoModule.getCurrentPosition();
      state.hasGps = true;
      const map = MapModule.getMap();
      GeoModule.showDot(map);
      state.origin = { lat: pos.lat, lng: pos.lng, name: 'Current location' };
      UI.setFromText('Current location');
      MapModule.flyTo(pos.lat, pos.lng, 14);

      // If destination already set, auto-route
      if (state.destination && !state.route) {
        await computeRoute();
      }
    } catch {
      UI.toast('Could not get your location', 'error');
    }
  }

  async function handleSearchResult(field, result) {
    console.log('[WM] handleSearchResult', field, result.name, result.lat, result.lng);
    if (field === 'to') {
      state.destination = { lat: result.lat, lng: result.lng, name: result.name };
      MapModule.setDestMarker(result.lat, result.lng, result.name);

      // If no origin set, try GPS (only if it worked before), otherwise prompt
      if (!state.origin) {
        if (state.hasGps) {
          try {
            const pos = await GeoModule.getCurrentPosition();
            state.origin = { lat: pos.lat, lng: pos.lng, name: 'Current location' };
            UI.setFromText('Current location');
          } catch {
            state.hasGps = false;
          }
        }
        if (!state.origin) {
          UI.toast('Tap the map or type a starting point in "From" to get a route', 'info', 5000);
          MapModule.flyTo(result.lat, result.lng, 13);
          // Keep sheet at half so the user can see the map and destination marker
          UI.snapTo(UI.SNAP_HALF);
          return;
        }
      }

      await computeRoute();
    } else if (field === 'from') {
      state.origin = { lat: result.lat, lng: result.lng, name: result.name };
      MapModule.setOriginMarker(result.lat, result.lng, result.name);

      if (state.destination) {
        await computeRoute();
      } else {
        MapModule.flyTo(result.lat, result.lng, 13);
        UI.toast('Now enter a destination', 'info', 2000);
      }
    }
  }

  async function computeRoute() {
    console.log('[WM] computeRoute called, origin:', state.origin?.name, 'dest:', state.destination?.name);
    if (!state.origin || !state.destination) {
      console.log('[WM] computeRoute aborted: missing', !state.origin ? 'origin' : 'destination');
      return;
    }

    UI.showLoading();
    state.departureTime = UI.getDepartureTime();

    try {
      // 1. Get route from OSRM
      state.route = await RoutingModule.getRoute(state.origin, state.destination);

      // 2. Show on map immediately with base color
      MapModule.drawRoute([{ coords: state.route.rawCoords, color: '#4a9eff' }]);
      MapModule.setOriginMarker(state.origin.lat, state.origin.lng, state.origin.name);
      MapModule.setDestMarker(state.destination.lat, state.destination.lng, state.destination.name);
      MapModule.fitToRoute(state.route.rawCoords, [60, 60]);

      // 3. Show basic route info while weather loads
      UI.showRoutePanel();
      UI.updateRouteInfo({
        eta: Utils.formatDuration(state.route.duration),
        distance: Utils.formatDistance(state.route.distance),
        delta: 'Checking weather...',
        deltaClass: 'clear',
      });

      // 4. Compute weather-adjusted ETA
      state.routeWeather = await RouteWeather.computeRouteWeather(
        state.route.rawCoords,
        state.route.duration,
        state.route.distance,
        state.departureTime
      );

      // 5. Draw color-coded route
      MapModule.drawRoute(state.routeWeather.segments);

      // 6. Format and display
      if (state.routeWeather.weatherUnavailable) {
        UI.updateRouteInfo({
          eta: Utils.formatDuration(state.routeWeather.adjustedDuration),
          distance: Utils.formatDistance(state.route.distance),
          delta: `Weather unavailable · traffic est. applied`,
          deltaClass: 'clear',
        });
      } else {
        const display = ETAModule.formatRouteDisplay(state.routeWeather, state.route, state.departureTime);

        UI.updateRouteInfo({
          eta: display.eta,
          distance: display.distance,
          delta: display.delta,
          deltaClass: display.deltaClass,
        });

        UI.renderWeatherTimeline(display.timelinePoints);
        UI.renderDirections(display.directionSteps);
      }

    } catch (err) {
      console.error('Route error:', err);
      UI.toast(err.message || 'Could not compute route', 'error');
    } finally {
      UI.hideLoading();
    }
  }

  async function handleDepartureChange(newTime) {
    if (!state.route) return;
    state.departureTime = newTime;

    UI.showLoading();
    try {
      // Re-run weather (not routing) with new departure time
      state.routeWeather = await RouteWeather.computeRouteWeather(
        state.route.rawCoords,
        state.route.duration,
        state.route.distance,
        state.departureTime
      );

      MapModule.drawRoute(state.routeWeather.segments);

      if (state.routeWeather.weatherUnavailable) {
        UI.updateRouteInfo({
          eta: Utils.formatDuration(state.routeWeather.adjustedDuration),
          distance: Utils.formatDistance(state.route.distance),
          delta: 'Weather unavailable · traffic est. applied',
          deltaClass: 'clear',
        });
      } else {
        const display = ETAModule.formatRouteDisplay(state.routeWeather, state.route, state.departureTime);

        UI.updateRouteInfo({
          eta: display.eta,
          distance: display.distance,
          delta: display.delta,
          deltaClass: display.deltaClass,
        });

        UI.renderWeatherTimeline(display.timelinePoints);
        UI.renderDirections(display.directionSteps);
      }
    } catch (err) {
      UI.toast('Could not update weather', 'error');
      UI.updateRouteInfo({
        eta: Utils.formatDuration(state.route.duration),
        distance: Utils.formatDistance(state.route.distance),
        delta: 'Weather unavailable',
        deltaClass: 'clear',
      });
    } finally {
      UI.hideLoading();
    }
  }

  // --- Side menu ---

  function setupMenu() {
    const menuEl = document.getElementById('side-menu');
    const overlay = document.getElementById('menu-overlay');

    document.getElementById('btn-menu').addEventListener('click', () => {
      menuEl.classList.remove('closed');
      overlay.classList.remove('hidden');
    });

    function closeMenu() {
      menuEl.classList.add('closed');
      overlay.classList.add('hidden');
    }

    document.getElementById('btn-menu-close').addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);

    // --- Set location manually ---
    document.getElementById('btn-set-location').addEventListener('click', async () => {
      const input = document.getElementById('menu-location-input');
      const query = input.value.trim();
      if (!query) return;

      try {
        const results = await SearchModule.geocode(query);
        if (results.length === 0) {
          UI.toast('Location not found', 'error');
          return;
        }
        const loc = results[0];
        state.origin = { lat: loc.lat, lng: loc.lng, name: loc.name };
        UI.setFromText(loc.name);
        input.value = '';
        closeMenu();
        if (state.destination) {
          await computeRoute();
        } else {
          MapModule.flyTo(loc.lat, loc.lng, 12);
          UI.toast(`Location set to ${loc.name}`, 'info');
        }
      } catch {
        UI.toast('Could not find location', 'error');
      }
    });

    // Also allow Enter key in the location input
    document.getElementById('menu-location-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-set-location').click();
      }
    });

    // --- Units toggle ---
    const btnMi = document.getElementById('btn-unit-mi');
    const btnKm = document.getElementById('btn-unit-km');

    // Load saved preference
    const savedUnit = localStorage.getItem('wm-units') || 'mi';
    if (savedUnit === 'km') {
      btnKm.classList.add('active');
      btnMi.classList.remove('active');
      Utils.setUnits('km');
    }

    btnMi.addEventListener('click', () => {
      btnMi.classList.add('active');
      btnKm.classList.remove('active');
      localStorage.setItem('wm-units', 'mi');
      Utils.setUnits('mi');
      refreshDisplay();
    });

    btnKm.addEventListener('click', () => {
      btnKm.classList.add('active');
      btnMi.classList.remove('active');
      localStorage.setItem('wm-units', 'km');
      Utils.setUnits('km');
      refreshDisplay();
    });

    // --- Clear cache ---
    document.getElementById('btn-clear-cache').addEventListener('click', async () => {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      location.reload(true);
    });
  }

  function refreshDisplay() {
    if (!state.routeWeather || !state.route) return;
    if (state.routeWeather.weatherUnavailable) {
      UI.updateRouteInfo({
        eta: Utils.formatDuration(state.route.duration),
        distance: Utils.formatDistance(state.route.distance),
        delta: 'Weather unavailable',
        deltaClass: 'clear',
      });
    } else {
      const display = ETAModule.formatRouteDisplay(state.routeWeather, state.route, state.departureTime);
      UI.updateRouteInfo({
        eta: display.eta,
        distance: display.distance,
        delta: display.delta,
        deltaClass: display.deltaClass,
      });
      UI.renderWeatherTimeline(display.timelinePoints);
      UI.renderDirections(display.directionSteps);
    }
  }

  // --- Tap-on-map ---

  function setupMapTap(map) {
    map.on('click', async (e) => {
      // Don't handle taps during navigation
      if (state.navigating) return;

      const { lat, lng } = e.latlng;
      const coordName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      // Determine what this tap sets
      const isSettingOrigin = !state.origin;

      if (isSettingOrigin) {
        state.origin = { lat, lng, name: coordName };
        UI.setFromText(coordName);
        MapModule.setOriginMarker(lat, lng, coordName);
        // If destination already set (from search), auto-route
        if (state.destination) {
          await computeRoute();
        } else {
          UI.toast('Origin set — now tap your destination', 'info', 2000);
        }
      } else {
        state.destination = { lat, lng, name: coordName };
        UI.setToText(coordName);
        MapModule.setDestMarker(lat, lng, coordName);
        await computeRoute();
      }

      // Reverse geocode in background to update the name
      SearchModule.reverseGeocode(lat, lng).then((resolved) => {
        if (!resolved) return;
        if (isSettingOrigin && state.origin && state.origin.lat === lat) {
          state.origin.name = resolved;
          UI.setFromText(resolved);
        } else if (!isSettingOrigin && state.destination && state.destination.lat === lat) {
          state.destination.name = resolved;
          UI.setToText(resolved);
        }
      });
    });
  }

  function handleGpsUpdate(pos) {
    if (!state.navigating) return;
    MapModule.updateFollowPosition(pos.lat, pos.lng);
    const now = Date.now();
    if (now - navRecalcTime > NAV_RECALC_INTERVAL_MS) {
      navRecalcTime = now;
      recalculateRemainingETA(pos);
    }
  }

  async function recalculateRemainingETA(pos) {
    if (!state.route) return;

    const coords = state.route.rawCoords;

    // Find the nearest point on the route to current position
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Utils.haversineDistance(pos.lat, pos.lng, coords[i][0], coords[i][1]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    const remainingCoords = coords.slice(nearestIdx);
    if (remainingCoords.length < 2) {
      UI.updateRouteInfo({ eta: 'Arriving', distance: '', delta: '', deltaClass: 'clear' });
      return;
    }

    // Calculate remaining distance from nearest point to destination
    let remainingDistance = 0;
    for (let i = nearestIdx + 1; i < coords.length; i++) {
      remainingDistance += Utils.haversineDistance(
        coords[i - 1][0], coords[i - 1][1],
        coords[i][0], coords[i][1]
      );
    }

    if (remainingDistance < 200) {
      UI.updateRouteInfo({ eta: 'Arriving', distance: '', delta: '', deltaClass: 'clear' });
      return;
    }

    const remainingFraction = state.route.distance > 0 ? remainingDistance / state.route.distance : 0;
    const remainingBaseDuration = state.route.duration * remainingFraction;

    try {
      const updatedWeather = await RouteWeather.computeRouteWeather(
        remainingCoords,
        remainingBaseDuration,
        remainingDistance,
        new Date()
      );

      if (updatedWeather.weatherUnavailable) return;

      const display = ETAModule.formatRouteDisplay(
        updatedWeather,
        { ...state.route, distance: remainingDistance, duration: remainingBaseDuration },
        new Date()
      );

      UI.updateRouteInfo({
        eta: display.eta,
        distance: display.distance,
        delta: display.delta,
        deltaClass: display.deltaClass,
      });
      UI.renderWeatherTimeline(display.timelinePoints);
    } catch (err) {
      console.warn('[WM] Nav ETA refresh failed:', err);
    }
  }

  function toggleNavigation() {
    if (state.navigating) {
      // Stop navigation
      state.navigating = false;
      navRecalcTime = 0;
      MapModule.stopFollowing();
      UI.stopNavMode();
      // Restore full route display
      if (state.route) {
        MapModule.fitToRoute(state.route.rawCoords, [60, 60]);
        if (state.routeWeather && !state.routeWeather.weatherUnavailable) {
          const display = ETAModule.formatRouteDisplay(state.routeWeather, state.route, state.departureTime);
          UI.updateRouteInfo({ eta: display.eta, distance: display.distance, delta: display.delta, deltaClass: display.deltaClass });
          UI.renderWeatherTimeline(display.timelinePoints);
        }
      }
      UI.snapTo(UI.SNAP_HALF);
    } else {
      // Start navigation
      if (!state.route) return;
      state.navigating = true;
      const firstStep = state.route.steps && state.route.steps[0];
      UI.startNavMode(firstStep);
      const pos = GeoModule.getPosition();
      if (pos) MapModule.startFollowing(pos.lat, pos.lng);
      else MapModule.startFollowing(state.origin.lat, state.origin.lng);
    }
  }

  function handleClearRoute() {
    if (state.navigating) {
      state.navigating = false;
      MapModule.stopFollowing();
      UI.stopNavMode();
    }

    state.destination = null;
    state.route = null;
    state.routeWeather = null;

    MapModule.clearRoute();
    MapModule.clearMarkers();
    UI.hideRoutePanel();
    UI.setToText('');

    // Re-show user location
    if (state.origin && state.origin.name === 'Current location') {
      const map = MapModule.getMap();
      GeoModule.showDot(map);
      MapModule.flyTo(state.origin.lat, state.origin.lng, 12);
    }
  }

  // ── Share (outbound) ─────────────────────────────────────────
  async function handleShareToggle() {
    if (ShareModule.isSharing()) {
      await ShareModule.stopSharing();
      document.getElementById('btn-share').classList.remove('sharing');
      UI.toast('Stopped sharing location', 'info', 2000);
      return;
    }

    if (!state.hasGps) {
      UI.toast('Enable location to share', 'error');
      return;
    }

    const shareUrl = await ShareModule.startSharing(() => GeoModule.getPosition());
    document.getElementById('btn-share').classList.add('sharing');

    const result = await ShareModule.sendShareSheet(shareUrl);
    if (result === 'copied') UI.toast('Link copied — send it to share your live location', 'info', 4000);
    else if (result === 'cancelled') {
      await ShareModule.stopSharing();
      document.getElementById('btn-share').classList.remove('sharing');
    }
  }

  // ── Track (inbound) ──────────────────────────────────────────
  let trackedMarker = null;

  function startTracking(token) {
    document.getElementById('tracking-banner').classList.remove('hidden');
    ShareModule.startTracking(token, handleTrackUpdate);
  }

  function handleTrackUpdate(pos, status) {
    const map = MapModule.getMap();
    if (!map) return;

    if (!pos || status === 'expired') {
      UI.toast('Live location session ended', 'info', 3000);
      handleStopTracking();
      return;
    }

    const ago = Math.round((Date.now() / 1000) - pos.updated_at);
    document.getElementById('tracking-label').textContent =
      ago < 10 ? 'Live location' : `Updated ${ago}s ago`;

    if (!trackedMarker) {
      const icon = L.divIcon({ className: 'tracked-dot', iconSize: [18, 18], iconAnchor: [9, 9] });
      trackedMarker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 900 }).addTo(map);
    } else {
      trackedMarker.setLatLng([pos.lat, pos.lng]);
    }

    if (!state.hasGps) MapModule.flyTo(pos.lat, pos.lng, 15);
  }

  function handleStopTracking() {
    ShareModule.stopTracking();
    document.getElementById('tracking-banner').classList.add('hidden');
    if (trackedMarker) {
      MapModule.getMap()?.removeLayer(trackedMarker);
      trackedMarker = null;
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { state };
})();
