/**
 * search.js — Photon geocoding (komoot) with proximity bias
 */
const SearchModule = (() => {
  const SEARCH_URL = 'https://photon.komoot.io/api/';
  const REVERSE_URL = 'https://photon.komoot.io/reverse';
  let abortController = null;

  /**
   * Search for places matching a query string.
   * Accepts optional { lat, lng } for proximity bias.
   * Returns: [{ name, displayName, lat, lng }]
   */
  async function geocode(query, location) {
    if (!query || query.trim().length < 2) return [];

    // Cancel previous in-flight request
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const params = new URLSearchParams({
      q: query.trim(),
      limit: '6',
      lang: 'en',
    });

    // Proximity bias — Photon natively supports lat/lon params
    if (location && location.lat != null && location.lng != null) {
      params.set('lat', location.lat.toFixed(6));
      params.set('lon', location.lng.toFixed(6));
    }

    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        signal: abortController.signal,
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) throw new Error(`Photon ${res.status}`);
      const data = await res.json();

      if (!data.features) return [];

      return data.features.map((f) => {
        const props = f.properties || {};
        const coords = f.geometry.coordinates; // [lon, lat]

        // Build a readable name
        const name = props.name || props.street || props.city || 'Unknown';

        // Build display address from available fields
        const parts = [];
        if (props.street) parts.push(props.street);
        if (props.housenumber) parts[parts.length - 1] = (parts[parts.length - 1] || '') + ' ' + props.housenumber;
        if (props.city) parts.push(props.city);
        if (props.state) parts.push(props.state);
        if (props.country) parts.push(props.country);
        const displayName = parts.join(', ') || name;

        return {
          name,
          displayName,
          lat: coords[1],
          lng: coords[0],
        };
      });
    } catch (err) {
      if (err.name === 'AbortError') return [];
      throw err;
    }
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

  return { geocode, reverseGeocode };
})();
