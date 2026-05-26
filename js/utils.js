/**
 * utils.js — Polyline decode, haversine, formatting helpers
 */
const Utils = (() => {
  let units = 'mi'; // 'mi' or 'km'

  /**
   * Decode Google Encoded Polyline into array of [lat, lng]
   */
  function decodePolyline(encoded) {
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      shift = 0; result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);

      coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
  }

  /**
   * Haversine distance between two points in meters
   */
  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Sample evenly-spaced points along a route.
   * coords: [[lat, lng], ...]
   * intervalMeters: distance between samples
   * Returns: [{ lat, lng, cumulativeDistance }]
   */
  function samplePointsAlongRoute(coords, intervalMeters) {
    if (coords.length === 0) return [];

    const points = [{ lat: coords[0][0], lng: coords[0][1], cumulativeDistance: 0 }];
    let cumDist = 0;
    let nextSampleAt = intervalMeters;

    for (let i = 1; i < coords.length; i++) {
      const segDist = haversineDistance(
        coords[i - 1][0], coords[i - 1][1],
        coords[i][0], coords[i][1]
      );
      const prevCumDist = cumDist;
      cumDist += segDist;

      while (cumDist >= nextSampleAt) {
        const fraction = (nextSampleAt - prevCumDist) / segDist;
        const lat = coords[i - 1][0] + fraction * (coords[i][0] - coords[i - 1][0]);
        const lng = coords[i - 1][1] + fraction * (coords[i][1] - coords[i - 1][1]);
        points.push({ lat, lng, cumulativeDistance: nextSampleAt });
        nextSampleAt += intervalMeters;
      }
    }

    // Always include the last point
    const last = coords[coords.length - 1];
    if (points[points.length - 1].cumulativeDistance < cumDist - 100) {
      points.push({ lat: last[0], lng: last[1], cumulativeDistance: cumDist });
    }

    return points;
  }

  /**
   * Debounce a function
   */
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /**
   * Format duration in seconds to human-readable string
   */
  function formatDuration(seconds) {
    if (seconds < 60) return '< 1 min';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function setUnits(u) {
    units = u;
  }

  /**
   * Format distance in meters to human-readable string
   */
  function formatDistance(meters) {
    if (units === 'km') {
      const km = meters / 1000;
      if (km < 0.1) return `${Math.round(meters)} m`;
      if (km < 10) return `${km.toFixed(1)} km`;
      return `${Math.round(km)} km`;
    }
    const miles = meters / 1609.344;
    if (miles < 0.1) {
      const ft = Math.round(meters * 3.28084);
      return `${ft} ft`;
    }
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }

  /**
   * Format a Date to a short time string
   */
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * Estimate a traffic speed multiplier based on time-of-day and day-of-week.
   * Returns a value >= 1.0 (1.0 = no delay, 1.35 = 35% longer travel time).
   * This is a heuristic for when real traffic data isn't available.
   */
  function getTrafficMultiplier(departureTime) {
    if (!(departureTime instanceof Date)) return 1.0;
    const hour = departureTime.getHours();
    const day  = departureTime.getDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;

    if (isWeekend) {
      if (hour >= 10 && hour < 19) return 1.12; // Weekend midday
      return 1.0;
    }

    // Weekday
    if (hour >= 7  && hour < 9)  return 1.30; // AM rush
    if (hour >= 9  && hour < 11) return 1.12; // Post-rush
    if (hour >= 11 && hour < 14) return 1.07; // Midday
    if (hour >= 14 && hour < 16) return 1.12; // Pre-PM rush
    if (hour >= 16 && hour < 19) return 1.38; // PM rush
    if (hour >= 19 && hour < 21) return 1.10; // Evening
    return 1.0;                               // Late night / early morning
  }

  /**
   * Clamp a number between min and max
   */
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  return {
    decodePolyline,
    haversineDistance,
    samplePointsAlongRoute,
    debounce,
    formatDuration,
    formatDistance,
    formatTime,
    clamp,
    setUnits,
    getTrafficMultiplier,
  };
})();
