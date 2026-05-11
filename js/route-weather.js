/**
 * route-weather.js — Core algorithm: weather along route + adjusted ETA
 *
 * 1. Sample the route at ~20 evenly-spaced points
 * 2. Compute baseline arrival times at each point
 * 3. Fetch weather for all points
 * 4. Look up conditions at each point at the time the driver would be there
 * 5. Two-pass adjustment: recalculate with speed factors, then recalc with shifted times
 * 6. Output: { timeline[], adjustedDuration, adjustedETA, segments[] }
 */
const RouteWeather = (() => {

  const TARGET_SAMPLES = 20;
  const MIN_SAMPLE_DISTANCE = 5000; // 5 km

  /**
   * Compute weather-adjusted route info.
   *
   * @param {Array} routeCoords - [[lat,lng], ...] from OSRM
   * @param {number} baseDuration - base duration in seconds
   * @param {number} baseDistance - base distance in meters
   * @param {Date} departureTime - when the driver departs
   * @returns {Object} { timeline, adjustedDuration, baselineDuration, segments }
   */
  async function computeRouteWeather(routeCoords, baseDuration, baseDistance, departureTime) {
    // 1. Sample the route
    const interval = Math.max(MIN_SAMPLE_DISTANCE, baseDistance / TARGET_SAMPLES);
    const samplePoints = Utils.samplePointsAlongRoute(routeCoords, interval);

    if (samplePoints.length < 2) {
      return {
        timeline: [],
        adjustedDuration: baseDuration,
        baselineDuration: baseDuration,
        segments: [{ coords: routeCoords, color: '#4caf50' }],
        worstCondition: null,
      };
    }

    // 2. Fetch weather for sample points
    let weatherData;
    try {
      weatherData = await WeatherModule.fetchWeatherForPoints(samplePoints);
    } catch (err) {
      console.warn('Weather fetch failed:', err);
      return {
        timeline: [],
        adjustedDuration: baseDuration,
        baselineDuration: baseDuration,
        segments: [{ coords: routeCoords, color: '#4caf50' }],
        worstCondition: null,
        weatherUnavailable: true,
      };
    }

    // 3. Pass 1 — baseline arrival times + initial adjustment
    const baseSpeed = baseDistance / baseDuration; // m/s
    const departMs = departureTime.getTime();

    let pass1Timeline = computePass(samplePoints, weatherData, baseSpeed, departMs, baseDistance);

    // 4. Pass 2 — use adjusted arrival times from pass 1
    const pass2Timeline = computePass(samplePoints, weatherData, baseSpeed, departMs, baseDistance, pass1Timeline);

    // 5. Build final result
    const adjustedDuration = pass2Timeline.reduce((sum, pt) => sum + pt.adjustedSegDuration, 0);

    // Build color-coded route segments
    const segments = buildColorSegments(routeCoords, samplePoints, pass2Timeline, baseDistance);

    // Find worst condition
    let worstCondition = null;
    let worstFactor = 1.0;
    for (const pt of pass2Timeline) {
      if (pt.condition.speedFactor < worstFactor) {
        worstFactor = pt.condition.speedFactor;
        worstCondition = pt.condition;
      }
    }

    return {
      timeline: pass2Timeline,
      adjustedDuration,
      baselineDuration: baseDuration,
      segments,
      worstCondition,
    };
  }

  /**
   * Single pass: compute arrival times and speed adjustments
   */
  function computePass(samplePoints, weatherData, baseSpeed, departMs, totalDistance, prevPass) {
    const timeline = [];
    let cumulativeTime = 0;

    for (let i = 0; i < samplePoints.length; i++) {
      const pt = samplePoints[i];
      const wd = weatherData[i];

      // Arrival time at this point
      let arrivalMs;
      if (prevPass && i > 0) {
        // Use adjusted time from previous pass
        const prevAdjusted = prevPass.slice(0, i).reduce((s, p) => s + p.adjustedSegDuration, 0);
        arrivalMs = departMs + prevAdjusted * 1000;
      } else {
        // Baseline: proportional by distance
        const fractionOfRoute = totalDistance > 0 ? pt.cumulativeDistance / totalDistance : 0;
        const baselineArrivalSec = fractionOfRoute * (totalDistance / baseSpeed);
        arrivalMs = departMs + baselineArrivalSec * 1000;
      }

      const arrivalTime = new Date(arrivalMs);
      const condition = WeatherModule.getConditionAtTime(wd.hourly, arrivalTime);

      // Segment duration (from previous point to this one)
      let segDistance = 0;
      let baseSegDuration = 0;
      if (i > 0) {
        segDistance = pt.cumulativeDistance - samplePoints[i - 1].cumulativeDistance;
        baseSegDuration = baseSpeed > 0 ? segDistance / baseSpeed : 0;
      }

      const adjustedSegDuration = baseSegDuration / condition.speedFactor;
      cumulativeTime += adjustedSegDuration;

      timeline.push({
        lat: pt.lat,
        lng: pt.lng,
        cumulativeDistance: pt.cumulativeDistance,
        arrivalTime,
        condition,
        segDistance,
        baseSegDuration,
        adjustedSegDuration,
        cumulativeAdjustedTime: cumulativeTime,
      });
    }

    return timeline;
  }

  /**
   * Build color-coded polyline segments from timeline conditions.
   */
  function buildColorSegments(routeCoords, samplePoints, timeline, totalDistance) {
    if (timeline.length === 0) {
      return [{ coords: routeCoords, color: '#4caf50' }];
    }

    const COLOR_MAP = {
      clear: '#4caf50',
      fog: '#9e9e9e',
      rain: '#ff9800',
      heavy: '#ef5350',
      snow: '#b388ff',
      storm: '#ef5350',
    };

    const segments = [];
    let currentColor = COLOR_MAP[timeline[0].condition.cssClass] || '#4caf50';
    let currentCoords = [];

    // Precompute cumulative distances for all route coordinates
    const cumDists = new Array(routeCoords.length);
    cumDists[0] = 0;
    for (let i = 1; i < routeCoords.length; i++) {
      cumDists[i] = cumDists[i - 1] + Utils.haversineDistance(
        routeCoords[i - 1][0], routeCoords[i - 1][1],
        routeCoords[i][0], routeCoords[i][1]
      );
    }

    // Map each route coordinate to the nearest sample point's condition
    for (let i = 0; i < routeCoords.length; i++) {
      const coord = routeCoords[i];
      const coordDist = cumDists[i];

      // Find which timeline segment this falls in
      let tlIdx = 0;
      for (let t = 1; t < timeline.length; t++) {
        if (coordDist >= timeline[t].cumulativeDistance) tlIdx = t;
        else break;
      }

      const color = COLOR_MAP[timeline[tlIdx].condition.cssClass] || '#4caf50';

      if (color !== currentColor && currentCoords.length > 0) {
        // Push completed segment, start new one
        // Overlap by one point for continuity
        segments.push({ coords: [...currentCoords], color: currentColor });
        currentCoords = [currentCoords[currentCoords.length - 1]];
        currentColor = color;
      }

      currentCoords.push(coord);
    }

    if (currentCoords.length > 0) {
      segments.push({ coords: currentCoords, color: currentColor });
    }

    // Merge any single-point segments into adjacent ones
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].coords.length < 2) {
        if (i > 0) {
          // Append the point to the previous segment
          segments[i - 1].coords.push(...segments[i].coords);
          segments.splice(i, 1);
        } else if (segments.length > 1) {
          // Prepend to the next segment
          segments[1].coords.unshift(...segments[0].coords);
          segments.splice(0, 1);
        }
      }
    }

    return segments;
  }

  return { computeRouteWeather };
})();
