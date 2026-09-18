/**
 * search.js — Photon geocoding (komoot) with Nominatim US fallback,
 *             plus saved places (Home/Work) and recent destinations.
 */
const SearchModule = (() => {
  const PHOTON_URL   = 'https://photon.komoot.io/api/';
  const REVERSE_URL  = 'https://photon.komoot.io/reverse';
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const RECENTS_KEY  = 'wm-recents';
  const SAVED_KEY    = 'wm-saved-places';
  const MAX_RECENTS  = 8;
  let abortController = null;

  // ── Photon ───────────────────────────────────────────────────
  async function photonGeocode(query, location, signal) {
    const params = new URLSearchParams({ q: query.trim(), limit: '6', lang: 'en' });
    if (location?.lat != null) {
      params.set('lat', location.lat.toFixed(6));
      params.set('lon', location.lng.toFixed(6));
    }
    const res = await fetch(`${PHOTON_URL}?${params}`, {
      signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.features) return [];
    return data.features.map((f) => {
      const props  = f.properties || {};
      const coords = f.geometry.coordinates;
      const name   = props.name || props.street || props.city || 'Unknown';
      const parts  = [];
      if (props.street) parts.push(props.street);
      if (props.housenumber) parts[parts.length - 1] = (parts[parts.length - 1] || '') + ' ' + props.housenumber;
      if (props.city)    parts.push(props.city);
      if (props.state)   parts.push(props.state);
      if (props.country) parts.push(props.country);
      return { name, displayName: parts.join(', ') || name, lat: coords[1], lng: coords[0] };
    });
  }

  // ── Nominatim fallback (US only) ─────────────────────────────
  async function nominatimGeocode(query) {
    const params = new URLSearchParams({
      q: query.trim(), format: 'jsonv2', limit: '5',
      addressdetails: '1', countrycodes: 'us',
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'en', 'User-Agent': 'WeatherMap/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((item) => ({
      name: item.name || item.display_name.split(',')[0].trim(),
      displayName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  }

  /**
   * Search for places. Tries Photon first; falls back to Nominatim if empty.
   * Accepts optional { lat, lng } for proximity bias.
   * Returns: [{ name, displayName, lat, lng }]
   */
  async function geocode(query, location) {
    if (!query || query.trim().length < 2) return [];
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const results = await photonGeocode(query, location, abortController.signal);
      if (results.length > 0) return results;
      return await nominatimGeocode(query);
    } catch (err) {
      if (err.name === 'AbortError') return [];
      throw err;
    }
  }

  // ── Recents ──────────────────────────────────────────────────
  function saveRecent(result) {
    const recents = getRecents().filter(
      (r) => !(r.lat === result.lat && r.lng === result.lng)
    );
    recents.unshift({ name: result.name, displayName: result.displayName, lat: result.lat, lng: result.lng });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  }

  function getRecents() {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
    catch { return []; }
  }

  function clearRecents() {
    localStorage.removeItem(RECENTS_KEY);
  }

  // ── Saved places ─────────────────────────────────────────────
  function getSavedPlace(key) {
    try {
      const all = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      return all[key] || null;
    } catch { return null; }
  }

  function setSavedPlace(key, result) {
    try {
      const all = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      all[key] = { name: result.name, displayName: result.displayName, lat: result.lat, lng: result.lng };
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch {}
  }

  function deleteSavedPlace(key) {
    try {
      const all = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      delete all[key];
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch {}
  }

  /**
   * Reverse geocode: lat/lng to place name
   */
  async function reverseGeocode(lat, lng) {
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      lang: 'en',
    });

    try {
      const res = await fetch(`${REVERSE_URL}?${params}`, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;
      const data = await res.json();

      if (!data.features || data.features.length === 0) return null;

      const props = data.features[0].properties || {};
      const parts = [];
      if (props.name) parts.push(props.name);
      if (props.street) parts.push(props.street);
      if (props.city) parts.push(props.city);
      if (props.state) parts.push(props.state);
      return parts.join(', ') || null;
    } catch {
      return null;
    }
  }

  return { geocode, reverseGeocode, saveRecent, getRecents, clearRecents, getSavedPlace, setSavedPlace, deleteSavedPlace };
})();
