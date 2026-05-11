/**
 * weather.js — Open-Meteo forecast fetching and WMO code mapping
 */
const WeatherModule = (() => {

  const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

  /**
   * WMO Weather Code → condition info
   * See: https://open-meteo.com/en/docs#weathervariables
   */
  const WMO_MAP = {
    0:  { label: 'Clear',           icon: '☀️', speedFactor: 1.0,  cssClass: 'clear' },
    1:  { label: 'Mostly clear',    icon: '🌤️', speedFactor: 1.0,  cssClass: 'clear' },
    2:  { label: 'Partly cloudy',   icon: '⛅', speedFactor: 1.0,  cssClass: 'clear' },
    3:  { label: 'Overcast',        icon: '☁️', speedFactor: 1.0,  cssClass: 'clear' },
    45: { label: 'Fog',             icon: '🌫️', speedFactor: 0.85, cssClass: 'fog' },
    48: { label: 'Freezing fog',    icon: '🌫️', speedFactor: 0.75, cssClass: 'fog' },
    51: { label: 'Light drizzle',   icon: '🌦️', speedFactor: 0.95, cssClass: 'rain' },
    53: { label: 'Drizzle',         icon: '🌦️', speedFactor: 0.93, cssClass: 'rain' },
    55: { label: 'Dense drizzle',   icon: '🌧️', speedFactor: 0.90, cssClass: 'rain' },
    56: { label: 'Freezing drizzle',icon: '🌧️', speedFactor: 0.70, cssClass: 'heavy' },
    57: { label: 'Heavy frz drizzle',icon:'🌧️', speedFactor: 0.65, cssClass: 'heavy' },
    61: { label: 'Light rain',      icon: '🌧️', speedFactor: 0.93, cssClass: 'rain' },
    63: { label: 'Rain',            icon: '🌧️', speedFactor: 0.85, cssClass: 'rain' },
    65: { label: 'Heavy rain',      icon: '🌧️', speedFactor: 0.75, cssClass: 'heavy' },
    66: { label: 'Freezing rain',   icon: '🧊', speedFactor: 0.65, cssClass: 'heavy' },
    67: { label: 'Heavy frz rain',  icon: '🧊', speedFactor: 0.55, cssClass: 'heavy' },
    71: { label: 'Light snow',      icon: '🌨️', speedFactor: 0.80, cssClass: 'snow' },
    73: { label: 'Snow',            icon: '🌨️', speedFactor: 0.70, cssClass: 'snow' },
    75: { label: 'Heavy snow',      icon: '❄️', speedFactor: 0.55, cssClass: 'snow' },
    77: { label: 'Snow grains',     icon: '🌨️', speedFactor: 0.75, cssClass: 'snow' },
    80: { label: 'Light showers',   icon: '🌦️', speedFactor: 0.90, cssClass: 'rain' },
    81: { label: 'Showers',         icon: '🌧️', speedFactor: 0.80, cssClass: 'rain' },
    82: { label: 'Heavy showers',   icon: '🌧️', speedFactor: 0.70, cssClass: 'heavy' },
    85: { label: 'Snow showers',    icon: '🌨️', speedFactor: 0.70, cssClass: 'snow' },
    86: { label: 'Heavy snow shwrs',icon: '❄️', speedFactor: 0.55, cssClass: 'snow' },
    95: { label: 'Thunderstorm',    icon: '⛈️', speedFactor: 0.70, cssClass: 'storm' },
    96: { label: 'T-storm w/ hail', icon: '⛈️', speedFactor: 0.60, cssClass: 'storm' },
    99: { label: 'T-storm w/ hail', icon: '⛈️', speedFactor: 0.55, cssClass: 'storm' },
  };

  const DEFAULT_CONDITION = { label: 'Unknown', icon: '❓', speedFactor: 1.0, cssClass: 'clear' };

  /**
   * Look up condition from WMO code
   */
  function weatherCodeToCondition(code) {
    return WMO_MAP[code] || DEFAULT_CONDITION;
  }

  /**
   * Fetch hourly weather for multiple points.
   * points: [{ lat, lng }]
   * Returns: [{ lat, lng, hourly: { time: [isoString], weatherCode: [int], temperature: [float] } }]
   *
   * Open-Meteo supports a single lat/lon per request, so we batch-call
   * for a reasonable number of points (typically ~20).
   */
  async function fetchWeatherForPoints(points) {
    if (!points || points.length === 0) return [];

    // Deduplicate nearby points (within ~5km) to reduce API calls
    const uniquePoints = deduplicatePoints(points, 5000);

    // Open-Meteo doesn't support multi-location in one call,
    // so we fetch in parallel (they have generous rate limits)
    const promises = uniquePoints.map((pt) => fetchSinglePoint(pt.lat, pt.lng));

    const results = await Promise.all(promises);

    // Map back results to original points (find nearest unique point)
    return points.map((pt) => {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < uniquePoints.length; i++) {
        const d = Utils.haversineDistance(pt.lat, pt.lng, uniquePoints[i].lat, uniquePoints[i].lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      return { lat: pt.lat, lng: pt.lng, hourly: results[bestIdx] };
    });
  }

  async function fetchSinglePoint(lat, lng) {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      hourly: 'weather_code,temperature_2m',
      forecast_days: '3',
      timezone: 'auto',
    });

    const res = await fetch(`${BASE_URL}?${params}`);
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);

    const data = await res.json();
    return {
      time: data.hourly.time,              // ISO strings
      weatherCode: data.hourly.weather_code,
      temperature: data.hourly.temperature_2m,
    };
  }

  /**
   * Get weather condition at a specific point and time
   */
  function getConditionAtTime(hourlyData, targetTime) {
    if (!hourlyData || !hourlyData.time) return DEFAULT_CONDITION;

    const target = targetTime instanceof Date ? targetTime.getTime() : targetTime;

    // Find closest hourly slot
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < hourlyData.time.length; i++) {
      const t = new Date(hourlyData.time[i]).getTime();
      const diff = Math.abs(t - target);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }

    const code = hourlyData.weatherCode[bestIdx];
    const condition = weatherCodeToCondition(code);
    return {
      ...condition,
      temperature: hourlyData.temperature[bestIdx],
      weatherCode: code,
    };
  }

  function deduplicatePoints(points, minDist) {
    const unique = [points[0]];
    for (let i = 1; i < points.length; i++) {
      let tooClose = false;
      for (const u of unique) {
        if (Utils.haversineDistance(points[i].lat, points[i].lng, u.lat, u.lng) < minDist) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) unique.push(points[i]);
    }
    return unique;
  }

  return {
    fetchWeatherForPoints,
    weatherCodeToCondition,
    getConditionAtTime,
    WMO_MAP,
  };
})();
