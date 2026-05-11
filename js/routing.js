/**
 * routing.js — Route provider abstraction + OSRM implementation
 */
const RoutingModule = (() => {

  /**
   * OSRM demo server provider
   * getRoute(origin, dest) → { geometry, distance, duration, steps, rawCoords }
   */
  class OSRMProvider {
    constructor() {
      this.baseUrl = 'https://router.project-osrm.org/route/v1/driving';
    }

    async getRoute(origin, dest) {
      // OSRM uses lng,lat order
      const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
      const params = new URLSearchParams({
        overview: 'full',
        geometries: 'polyline',
        steps: 'true',
      });

      const res = await fetch(`${this.baseUrl}/${coords}?${params}`);
      if (!res.ok) throw new Error(`OSRM error: ${res.status}`);

      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(data.message || 'No route found');
      }

      const route = data.routes[0];
      const rawCoords = Utils.decodePolyline(route.geometry);

      // Extract turn-by-turn steps
      const steps = [];
      for (const leg of route.legs) {
        for (const step of leg.steps) {
          if (step.maneuver.type === 'arrive' && steps.length > 0) {
            steps.push({
              instruction: 'Arrive at destination',
              distance: 0,
              duration: 0,
              maneuver: step.maneuver.type,
              modifier: step.maneuver.modifier || '',
              name: step.name || '',
              location: step.maneuver.location, // [lng, lat]
            });
            continue;
          }
          steps.push({
            instruction: buildInstruction(step),
            distance: step.distance,
            duration: step.duration,
            maneuver: step.maneuver.type,
            modifier: step.maneuver.modifier || '',
            name: step.name || '',
            location: step.maneuver.location,
          });
        }
      }

      return {
        rawCoords,            // [[lat, lng], ...]
        distance: route.distance,  // meters
        duration: route.duration,  // seconds
        steps,
      };
    }
  }

  /**
   * Build human-readable instruction from OSRM step
   */
  function buildInstruction(step) {
    const type = step.maneuver.type;
    const mod = step.maneuver.modifier || '';
    const name = step.name || 'the road';

    switch (type) {
      case 'depart':
        return `Head ${mod || 'forward'} on ${name}`;
      case 'turn':
        return `Turn ${mod} onto ${name}`;
      case 'new name':
        return `Continue onto ${name}`;
      case 'merge':
        return `Merge ${mod} onto ${name}`;
      case 'on ramp':
      case 'off ramp':
        return `Take the ramp ${mod ? mod + ' ' : ''}onto ${name}`;
      case 'fork':
        return `Keep ${mod} at fork onto ${name}`;
      case 'end of road':
        return `Turn ${mod} onto ${name}`;
      case 'roundabout':
      case 'rotary':
        return `At the roundabout, take exit onto ${name}`;
      case 'continue':
        return `Continue ${mod ? mod + ' ' : ''}on ${name}`;
      case 'arrive':
        return 'Arrive at destination';
      default:
        return `Continue on ${name}`;
    }
  }

  /**
   * Get maneuver icon
   */
  function getManeuverIcon(maneuver, modifier) {
    switch (maneuver) {
      case 'depart': return '🚗';
      case 'arrive': return '🏁';
      case 'turn':
        if (modifier.includes('left')) return '⬅️';
        if (modifier.includes('right')) return '➡️';
        return '⬆️';
      case 'merge': return '↗️';
      case 'fork':
        if (modifier.includes('left')) return '↰';
        if (modifier.includes('right')) return '↱';
        return '⬆️';
      case 'roundabout':
      case 'rotary':
        return '🔄';
      case 'on ramp':
      case 'off ramp':
        return '↗️';
      default: return '⬆️';
    }
  }

  // Default provider
  const provider = new OSRMProvider();

  return {
    getRoute: (origin, dest) => provider.getRoute(origin, dest),
    getManeuverIcon,
  };
})();
