/**
 * map.js — Leaflet initialization, markers, polylines
 */
const MapModule = (() => {
  let map;
  let originMarker;
  let destMarker;
  let routePolylines = [];
  let previewMarker;
  let isFollowing = false;

  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

  function init(containerId) {
    map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
    }).setView([39.8283, -98.5795], 5); // Center of US

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      maxZoom: 19,
    }).addTo(map);

    // Zoom control on the right
    L.control.zoom({ position: 'topright' }).addTo(map);

    return map;
  }

  function getMap() {
    return map;
  }

  function setOriginMarker(lat, lng, label) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#4a9eff',
      fillColor: '#4a9eff',
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
    if (label) originMarker.bindTooltip(label);
    return originMarker;
  }

  function setDestMarker(lat, lng, label) {
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([lat, lng]).addTo(map);
    if (label) destMarker.bindTooltip(label);
    return destMarker;
  }

  function clearMarkers() {
    if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; }
  }

  function setPreviewMarker(lat, lng) {
    if (previewMarker) map.removeLayer(previewMarker);
    previewMarker = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#ff9800',
      fillColor: '#ff9800',
      fillOpacity: 0.8,
      weight: 2,
    }).addTo(map);
  }

  function clearPreviewMarker() {
    if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; }
  }

  /**
   * Draw route with optional color-coded segments.
   * segments: [{ coords: [[lat,lng],...], color: '#hex' }]
   * If no segments, draws a single blue polyline from coords array.
   */
  function drawRoute(segments) {
    clearRoute();
    if (!segments || segments.length === 0) return;

    for (const seg of segments) {
      const line = L.polyline(seg.coords, {
        color: seg.color || '#4a9eff',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      routePolylines.push(line);
    }
  }

  function clearRoute() {
    for (const line of routePolylines) {
      map.removeLayer(line);
    }
    routePolylines = [];
  }

  function fitToRoute(coords, padding) {
    if (!coords || coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: padding || [50, 50], maxZoom: 16 });
  }

  function flyTo(lat, lng, zoom) {
    map.flyTo([lat, lng], zoom || 14, { duration: 1 });
  }

  function startFollowing(lat, lng) {
    isFollowing = true;
    map.setView([lat, lng], 17, { animate: true });
    // If user manually drags, stop following
    map.once('dragstart', () => { isFollowing = false; });
  }

  function stopFollowing() {
    isFollowing = false;
  }

  function updateFollowPosition(lat, lng) {
    if (!isFollowing) return;
    map.panTo([lat, lng], { animate: true, duration: 0.5 });
  }

  function isInFollowMode() {
    return isFollowing;
  }

  function getBounds() {
    if (!map) return null;
    const b = map.getBounds();
    return {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    };
  }

  return {
    init,
    getMap,
    getBounds,
    setOriginMarker,
    setDestMarker,
    clearMarkers,
    setPreviewMarker,
    clearPreviewMarker,
    drawRoute,
    clearRoute,
    fitToRoute,
    flyTo,
    startFollowing,
    stopFollowing,
    updateFollowPosition,
    isInFollowMode,
  };
})();
