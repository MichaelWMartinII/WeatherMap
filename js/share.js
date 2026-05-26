/**
 * share.js — Live location sharing via relay.michaelwmartinjr.com
 *
 * Sharer: startSharing() → posts GPS every 5s → returns share URL
 * Receiver: startTracking(token) → polls every 5s → calls onUpdate(pos)
 */
const ShareModule = (() => {
  const RELAY = 'https://weathermap.michaelwmartinjr.com';
  const POST_INTERVAL_MS = 5000;
  const POLL_INTERVAL_MS = 5000;

  let shareToken    = null;
  let shareTimer    = null;
  let trackTimer    = null;
  let _getPos       = null;
  let _onTrackUpdate = null;

  // ── Token ────────────────────────────────────────────────────
  function genToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Sharing (outbound) ───────────────────────────────────────
  async function startSharing(getPositionFn) {
    _getPos = getPositionFn;
    shareToken = genToken();

    await postLocation();
    shareTimer = setInterval(postLocation, POST_INTERVAL_MS);

    return buildShareUrl(shareToken);
  }

  async function postLocation() {
    if (!_getPos || !shareToken) return;
    const pos = _getPos();
    if (!pos) return;
    try {
      await fetch(`${RELAY}/location/${shareToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng, acc: pos.accuracy || 0 }),
      });
    } catch { /* network error — keep trying */ }
  }

  async function stopSharing() {
    if (shareTimer) { clearInterval(shareTimer); shareTimer = null; }
    if (shareToken) {
      fetch(`${RELAY}/location/${shareToken}`, { method: 'DELETE' }).catch(() => {});
      shareToken = null;
    }
  }

  function isSharing() { return !!shareToken; }

  // ── Tracking (inbound) ───────────────────────────────────────
  function startTracking(token, onUpdate) {
    _onTrackUpdate = onUpdate;
    pollLocation(token);
    trackTimer = setInterval(() => pollLocation(token), POLL_INTERVAL_MS);
  }

  async function pollLocation(token) {
    try {
      const res = await fetch(`${RELAY}/location/${token}`);
      if (res.status === 404) {
        stopTracking();
        if (_onTrackUpdate) _onTrackUpdate(null, 'expired');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (_onTrackUpdate) _onTrackUpdate(data);
    } catch { /* network error */ }
  }

  function stopTracking() {
    if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
    _onTrackUpdate = null;
  }

  function isTracking() { return !!trackTimer; }

  // ── URL helpers ──────────────────────────────────────────────
  function buildShareUrl(token) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('track', token);
    return url.toString();
  }

  function getIncomingToken() {
    return new URLSearchParams(location.search).get('track') || null;
  }

  // ── Share sheet / clipboard ──────────────────────────────────
  async function sendShareSheet(url) {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'WeatherMap — Live Location', url });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      prompt('Copy this link:', url);
      return 'prompt';
    }
  }

  return {
    startSharing, stopSharing, isSharing,
    startTracking, stopTracking, isTracking,
    getIncomingToken, sendShareSheet,
  };
})();
