/**
 * geo.js — HTML5 Geolocation wrapper with blue dot
 */
const GeoModule = (() => {
  let watchId = null;
  let currentPos = null;
  let locationDot = null;
  let accuracyCircle = null;
  let onUpdateCallback = null;

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          resolve(currentPos);
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }

  function watchPosition(callback) {
    onUpdateCallback = callback;
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        updateDot();
        if (onUpdateCallback) onUpdateCallback(currentPos);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  }

  function stopWatching() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function getPosition() {
    return currentPos;
  }

  function showDot(map) {
    if (!currentPos) return;
    const latlng = [currentPos.lat, currentPos.lng];

    if (!locationDot) {
      const dotIcon = L.divIcon({
        className: 'user-location-dot',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      locationDot = L.marker(latlng, { icon: dotIcon, zIndexOffset: 1000 }).addTo(map);
      accuracyCircle = L.circle(latlng, {
        radius: currentPos.accuracy,
        className: 'user-location-accuracy',
        interactive: false,
      }).addTo(map);
    }
  }

  function updateDot() {
    if (!currentPos) return;
    const latlng = [currentPos.lat, currentPos.lng];
    if (locationDot) locationDot.setLatLng(latlng);
    if (accuracyCircle) {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(currentPos.accuracy);
    }
  }

  function removeDot(map) {
    if (locationDot) { map.removeLayer(locationDot); locationDot = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  }

  return {
    getCurrentPosition,
    watchPosition,
    stopWatching,
    getPosition,
    showDot,
    removeDot,
  };
})();
