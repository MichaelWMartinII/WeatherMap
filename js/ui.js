/**
 * ui.js — Bottom sheet, search results, weather timeline, toast notifications
 */
const UI = (() => {
  // Bottom sheet snap positions (% of viewport hidden below)
  const SNAP_COLLAPSED = 0;  // Only handle + search visible
  const SNAP_HALF = 1;
  const SNAP_FULL = 2;

  let sheet, sheetContent, handle;
  let currentSnap = SNAP_COLLAPSED;
  let sheetHeight;
  let dragStartY, dragStartTranslate;
  let isDragging = false;

  // Element refs
  let inputFrom, inputTo, clearFromBtn, clearToBtn;
  let searchResults, routePanel;
  let activeInput = null; // Which input triggered search
  let onSelectResult = null;
  let onClearRoute = null;
  let onDepartureChange = null;

  function init({ onResult, onClear, onDeparture }) {
    onSelectResult = onResult;
    onClearRoute = onClear;
    onDepartureChange = onDeparture;

    sheet = document.getElementById('bottom-sheet');
    sheetContent = document.getElementById('sheet-content');
    handle = document.getElementById('sheet-handle');
    inputFrom = document.getElementById('input-from');
    inputTo = document.getElementById('input-to');
    clearFromBtn = document.querySelector('[data-target="input-from"]');
    clearToBtn = document.querySelector('[data-target="input-to"]');
    searchResults = document.getElementById('search-results');
    routePanel = document.getElementById('route-panel');

    setupDrag();
    setupSearch();
    setupClearButtons();
    setupDepartureTime();
    setupClearRoute();

    // Initial collapsed position — no animation to prevent flash
    updateSheetPosition(false);
  }

  // --- Bottom sheet drag ---

  function getSnapTranslates() {
    const vh = window.innerHeight;
    const handleH = 30;
    const searchH = document.getElementById('search-section').offsetHeight + 16;
    const sheetMaxH = vh * 0.85;
    return [
      sheetMaxH - handleH - searchH,   // collapsed: show search
      sheetMaxH * 0.4,                  // half
      0,                                // full
    ];
  }

  function updateSheetPosition(animate = true) {
    const translates = getSnapTranslates();
    const ty = translates[currentSnap] || translates[0];
    sheet.style.transition = animate ? 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
    sheet.style.transform = `translateY(${ty}px)`;
  }

  function setupDrag() {
    handle.addEventListener('touchstart', onDragStart, { passive: true });
    handle.addEventListener('mousedown', onDragStart);

    function onDragStart(e) {
      isDragging = true;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      dragStartY = clientY;
      const matrix = new DOMMatrix(getComputedStyle(sheet).transform);
      dragStartTranslate = matrix.m42;
      sheet.style.transition = 'none';

      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('touchend', onDragEnd);
      document.addEventListener('mouseup', onDragEnd);
    }

    function onDragMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = clientY - dragStartY;
      const newTy = Math.max(0, dragStartTranslate + dy);
      sheet.style.transform = `translateY(${newTy}px)`;
    }

    function onDragEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);
      document.removeEventListener('mouseup', onDragEnd);

      const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      const dy = clientY - dragStartY;
      const translates = getSnapTranslates();

      // Determine closest snap
      const currentTy = dragStartTranslate + dy;
      let closest = 0;
      let minDist = Infinity;
      translates.forEach((t, i) => {
        const d = Math.abs(currentTy - t);
        if (d < minDist) { minDist = d; closest = i; }
      });

      // Velocity: fast swipe up → full, fast swipe down → collapsed
      if (Math.abs(dy) > 60) {
        if (dy < 0) closest = Math.min(currentSnap + 1, SNAP_FULL);
        else closest = Math.max(currentSnap - 1, SNAP_COLLAPSED);
      }

      currentSnap = closest;
      updateSheetPosition(true);
    }
  }

  function snapTo(level) {
    currentSnap = level;
    updateSheetPosition(true);
  }

  // --- Search ---

  function setupSearch() {
    const debouncedSearch = Utils.debounce(async (query) => {
      if (query.length < 2) {
        hideResults();
        return;
      }
      try {
        console.log('[WM] searching:', query);
        // Pass map center for proximity bias
        const map = MapModule.getMap();
        const center = map ? map.getCenter() : null;
        const location = center ? { lat: center.lat, lng: center.lng } : null;
        const results = await SearchModule.geocode(query, location);
        console.log('[WM] search results:', results.length);
        showResults(results);
      } catch (err) {
        console.error('[WM] search error:', err);
        hideResults();
      }
    }, 400);

    inputTo.addEventListener('input', (e) => {
      activeInput = 'to';
      const val = e.target.value;
      clearToBtn.classList.toggle('hidden', !val);
      debouncedSearch(val);
    });

    inputFrom.addEventListener('input', (e) => {
      activeInput = 'from';
      const val = e.target.value;
      clearFromBtn.classList.toggle('hidden', !val);
      debouncedSearch(val);
    });

    inputTo.addEventListener('focus', () => {
      activeInput = 'to';
      snapTo(SNAP_FULL);
    });

    inputFrom.addEventListener('focus', () => {
      activeInput = 'from';
      snapTo(SNAP_FULL);
    });
  }

  function showResults(results) {
    if (!results || results.length === 0) {
      hideResults();
      return;
    }

    searchResults.innerHTML = '';
    searchResults.classList.remove('hidden');

    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `
        <div class="search-result-name">${escapeHtml(r.name)}</div>
        <div class="search-result-address">${escapeHtml(r.displayName)}</div>
      `;
      div.addEventListener('click', () => {
        console.log('[WM] result clicked:', r.name, 'for field:', activeInput);
        hideResults();
        if (activeInput === 'to') {
          inputTo.value = r.name;
          clearToBtn.classList.remove('hidden');
        } else {
          inputFrom.value = r.name;
          clearFromBtn.classList.remove('hidden');
        }
        inputTo.blur();
        inputFrom.blur();
        snapTo(SNAP_HALF);
        if (onSelectResult) onSelectResult(activeInput, r);
      });
      searchResults.appendChild(div);
    }
  }

  function hideResults() {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
  }

  // --- Clear buttons ---

  function setupClearButtons() {
    clearFromBtn.addEventListener('click', () => {
      inputFrom.value = '';
      clearFromBtn.classList.add('hidden');
      inputFrom.focus();
    });

    clearToBtn.addEventListener('click', () => {
      inputTo.value = '';
      clearToBtn.classList.add('hidden');
      inputTo.focus();
    });
  }

  // --- Departure time ---

  function setupDepartureTime() {
    const departureInput = document.getElementById('departure-time');
    const btnNow = document.getElementById('btn-depart-now');

    setDepartureNow();

    const debouncedDeparture = Utils.debounce((val) => {
      if (onDepartureChange) onDepartureChange(new Date(val));
    }, 800);

    departureInput.addEventListener('change', () => {
      debouncedDeparture(departureInput.value);
    });

    btnNow.addEventListener('click', () => {
      setDepartureNow();
      if (onDepartureChange) onDepartureChange(new Date());
    });
  }

  function setDepartureNow() {
    const departureInput = document.getElementById('departure-time');
    const now = new Date();
    // Format for datetime-local input
    const pad = (n) => String(n).padStart(2, '0');
    departureInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function getDepartureTime() {
    const val = document.getElementById('departure-time').value;
    return val ? new Date(val) : new Date();
  }

  // --- Clear route ---

  function setupClearRoute() {
    document.getElementById('btn-clear-route').addEventListener('click', () => {
      if (onClearRoute) onClearRoute();
    });
  }

  // --- Route panel ---

  function showRoutePanel() {
    routePanel.classList.remove('hidden');
    snapTo(SNAP_HALF);
  }

  function hideRoutePanel() {
    routePanel.classList.add('hidden');
    document.getElementById('route-eta').textContent = '';
    document.getElementById('route-distance').textContent = '';
    document.getElementById('weather-delta').textContent = '';
    document.getElementById('weather-delta').className = '';
    document.getElementById('weather-timeline').innerHTML = '';
    document.getElementById('directions-list').innerHTML = '';
    snapTo(SNAP_COLLAPSED);
  }

  function updateRouteInfo({ eta, distance, delta, deltaClass }) {
    document.getElementById('route-eta').textContent = eta;
    document.getElementById('route-distance').textContent = distance;
    const deltaEl = document.getElementById('weather-delta');
    if (delta) {
      deltaEl.textContent = delta;
      deltaEl.className = deltaClass || 'clear';
    } else {
      deltaEl.className = '';
    }
  }

  function renderWeatherTimeline(timelinePoints) {
    const container = document.getElementById('weather-timeline');
    container.innerHTML = '';

    for (const pt of timelinePoints) {
      const div = document.createElement('div');
      div.className = `timeline-point ${pt.cssClass || 'clear'}`;
      div.innerHTML = `
        <span class="tl-icon">${pt.icon}</span>
        <span class="tl-time">${pt.time}</span>
        <span class="tl-label">${pt.label}</span>
      `;
      container.appendChild(div);
    }
  }

  function renderDirections(steps) {
    const container = document.getElementById('directions-list');
    container.innerHTML = '';

    for (const step of steps) {
      const div = document.createElement('div');
      div.className = 'direction-step';
      div.innerHTML = `
        <span class="step-icon">${step.icon}</span>
        <div>
          <div class="step-text">${escapeHtml(step.instruction)}</div>
          ${step.weather ? `<div class="step-weather">${step.weather}</div>` : ''}
        </div>
        <span class="step-dist">${step.distance}</span>
      `;
      container.appendChild(div);
    }
  }

  // --- Loading (inline in route panel) ---

  function showLoading() {
    let el = document.getElementById('route-loading-text');
    if (!el) {
      el = document.createElement('div');
      el.id = 'route-loading-text';
      routePanel.parentNode.insertBefore(el, routePanel.nextSibling);
    }
    el.textContent = 'Computing route...';
    el.classList.remove('hidden');
  }

  function hideLoading() {
    const el = document.getElementById('route-loading-text');
    if (el) el.classList.add('hidden');
  }

  // --- Toast ---

  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'alert');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // --- Helpers ---

  function setFromText(text) {
    inputFrom.value = text;
    clearFromBtn.classList.toggle('hidden', !text);
  }

  function setToText(text) {
    inputTo.value = text;
    clearToBtn.classList.toggle('hidden', !text);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    snapTo,
    showRoutePanel,
    hideRoutePanel,
    updateRouteInfo,
    renderWeatherTimeline,
    renderDirections,
    showLoading,
    hideLoading,
    toast,
    setFromText,
    setToText,
    getDepartureTime,
    setDepartureNow,
    SNAP_COLLAPSED,
    SNAP_HALF,
    SNAP_FULL,
  };
})();
