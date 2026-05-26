/**
 * eta.js — ETA formatting, display, and weather delta calculation
 */
const ETAModule = (() => {

  /**
   * Format the adjusted ETA display info.
   * Returns: { eta, distance, delta, deltaClass, timelinePoints, directionSteps }
   */
  function formatRouteDisplay(routeWeather, route, departureTime) {
    const {
      adjustedDuration, weatherAdjustedDuration, baselineDuration,
      trafficMultiplier, timeline, worstCondition,
    } = routeWeather;

    // Format main ETA (weather + traffic combined)
    const eta = Utils.formatDuration(adjustedDuration);
    const distance = Utils.formatDistance(route.distance);

    // Separate traffic and weather contributions
    const trafficDelaySec  = weatherAdjustedDuration
      ? weatherAdjustedDuration * (trafficMultiplier - 1)
      : (adjustedDuration - baselineDuration);
    const weatherDelaySec  = weatherAdjustedDuration
      ? weatherAdjustedDuration - baselineDuration
      : 0;

    let delta = null;
    let deltaClass = 'clear';
    const parts = [];

    if (trafficDelaySec > 60) {
      parts.push(`+${Utils.formatDuration(trafficDelaySec)} traffic`);
    }

    if (weatherDelaySec > 30 && worstCondition) {
      parts.push(`+${Utils.formatDuration(weatherDelaySec)} ${worstCondition.label.toLowerCase()}`);
      if (worstCondition.cssClass === 'snow') deltaClass = 'snow';
      else if (worstCondition.speedFactor < 0.8) deltaClass = 'rain';
      else deltaClass = 'rain';
    }

    if (parts.length > 0) {
      delta = parts.join('  ·  ');
      if (deltaClass === 'clear' && trafficDelaySec > 60) deltaClass = 'rain';
    } else {
      const trafficLabel = trafficMultiplier > 1.05
        ? `Light traffic (+${Math.round((trafficMultiplier - 1) * 100)}%)`
        : 'No delays expected';
      delta = trafficLabel;
      deltaClass = 'clear';
    }

    // Build weather timeline points for UI strip — consolidate consecutive same-condition entries
    const timelinePoints = [];
    for (const pt of timeline) {
      const last = timelinePoints[timelinePoints.length - 1];
      if (last && last.cssClass === pt.condition.cssClass) {
        // Extend the previous entry's time range
        last.time = `${last.startTime}–${Utils.formatTime(pt.arrivalTime)}`;
      } else {
        const formatted = Utils.formatTime(pt.arrivalTime);
        timelinePoints.push({
          icon: pt.condition.icon,
          time: formatted,
          startTime: formatted,
          label: pt.condition.label,
          cssClass: pt.condition.cssClass,
        });
      }
    }

    // Build direction steps with weather annotations
    const directionSteps = buildDirectionSteps(route.steps, timeline, route.distance);

    return { eta, distance, delta, deltaClass, timelinePoints, directionSteps };
  }

  /**
   * Annotate turn-by-turn steps with weather info
   */
  function buildDirectionSteps(steps, timeline, totalDistance) {
    return steps.map((step) => {
      const icon = RoutingModule.getManeuverIcon(step.maneuver, step.modifier);
      const dist = Utils.formatDistance(step.distance);

      // Find weather at this step's location
      let weather = '';
      if (step.location && timeline.length > 0) {
        const stepLat = step.location[1]; // OSRM returns [lng, lat]
        const stepLng = step.location[0];

        let nearest = timeline[0];
        let minDist = Infinity;
        for (const pt of timeline) {
          const d = Utils.haversineDistance(stepLat, stepLng, pt.lat, pt.lng);
          if (d < minDist) { minDist = d; nearest = pt; }
        }

        if (nearest.condition.speedFactor < 0.95) {
          weather = `${nearest.condition.icon} ${nearest.condition.label}`;
        }
      }

      return {
        icon,
        instruction: step.instruction,
        distance: dist,
        weather,
      };
    });
  }

  return { formatRouteDisplay };
})();
