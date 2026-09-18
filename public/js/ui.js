/**
 * ui.js — Google/Apple Maps-style bottom sheet + nav bar.
 *
 * Sheet states: peek (compact ETA), half (+ weather/departure), full (+ directions)
 * Nav mode:     top blue bar with next-turn instruction
 */
const UI = (() => {

  // ── compat ──────────────────────────────────────────────────
  const SNAP_COLLAPSED = 0;
  const SNAP_HALF      = 1;
  const SNAP_FULL      = 2;

  // ── state ────────────────────────────────────────────────────
  let sheet, sheetHandle, sheetContent;
  let inputTo, inputFrom, searchDropdown, searchResults;
  let fromLabel, fromEditRow;
  let routeEta, routeDistance, weatherDelta;
  let weatherTimeline, directionsList, departureInput, btnDepartNow;
  let btnStartNav, btnClearRoute;
  let navBar, navTurnIcon, navTurnDistance, navTurnInstruction;

  let snapLevel = -1; // -1=hidden, 0=peek, 1=half, 2=full
  let dragging  = false;
  let dragStartY = 0, dragStartTy = 0;

  let onSelectResult   = null;
  let onClearRoute     = null;
  let onDepartureChange = null;
  let _refreshDisplay   = null;

  // ── init ─────────────────────────────────────────────────────
  function init({ onResult, onClear, onDeparture }) {
    onSelectResult    = onResult;
    onClearRoute      = onClear;
    onDepartureChange = onDeparture;

    sheet          = document.getElementById('sheet');
    sheetHandle    = document.getElementById('sheet-handle');
    sheetContent   = document.getElementById('sheet-content');
    inputTo        = document.getElementById('input-to');
    inputFrom      = document.getElementById('input-from');
    searchDropdown = document.getElementById('search-dropdown');
    searchResults  = document.getElementById('search-results');
    fromLabel      = document.getElementById('from-label');
    fromEditRow    = document.getElementById('from-edit-row');
    routeEta       = document.getElementById('route-eta');
    routeDistance  = document.getElementById('route-distance');
    weatherDelta   = document.getElementById('weather-delta');
    weatherTimeline= document.getElementById('weather-timeline');
    directionsList = document.getElementById('directions-list');
    departureInput = document.getElementById('departure-time');
    btnDepartNow   = document.getElementById('btn-depart-now');
    btnStartNav    = document.getElementById('btn-start-nav');
    btnClearRoute  = document.getElementById('btn-clear-route');
    navBar             = document.getElementById('nav-bar');
    navTurnIcon        = document.getElementById('nav-turn-icon');
    navTurnDistance    = document.getElementById('nav-turn-distance');
    navTurnInstruction = document.getElementById('nav-turn-instruction');

    setupSearch();
    setupSearchClear();
    setupFromChange();
    setupDrag();
    setupDepartureTime();
    setupClearRoute();
    setupSettings();
    setupNavButton();
    setupEndNav();
  }

  // ── sheet drag ───────────────────────────────────────────────
  function getSnapTy(level) {
    const vh = window.innerHeight;
    if (level === 0) return vh - 140 - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-bot') || '0');
    if (level === 1) return vh * 0.45;
    if (level === 2) return 0;
    return vh; // hidden
  }

  function applyTy(ty, animate) {
    sheet.style.transition = animate
      ? 'transform 0.38s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      : 'none';
    sheet.style.transform = `translateY(${ty}px)`;
  }

  function snapTo(level) {
    if (snapLevel === -1 && level >= 0) {
      // Was hidden — snap without animation first frame, then animate in
      sheet.classList.remove('hidden');
      sheet.style.transition = 'none';
      sheet.style.transform  = `translateY(${window.innerHeight}px)`;
      requestAnimationFrame(() => {
        snapLevel = level;
        applyTy(getSnapTy(level), true);
      });
    } else {
      snapLevel = level;
      if (level < 0) {
        applyTy(window.innerHeight, true);
        setTimeout(() => sheet.classList.add('hidden'), 380);
      } else {
        applyTy(getSnapTy(level), true);
      }
    }
  }

  function setupDrag() {
    function onStart(e) {
      dragging = true;
      dragStartY  = e.touches ? e.touches[0].clientY : e.clientY;
      const matrix = new DOMMatrix(getComputedStyle(sheet).transform);
      dragStartTy = matrix.m42;
      sheet.style.transition = 'none';
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchend', onEnd);
      document.addEventListener('mouseup', onEnd);
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const y  = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = y - dragStartY;
      const ty = Math.max(0, dragStartTy + dy);
      sheet.style.transform = `translateY(${ty}px)`;
    }

    function onEnd(e) {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('mouseup', onEnd);

      const y  = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      const dy = y - dragStartY;
      const matrix = new DOMMatrix(getComputedStyle(sheet).transform);
      const ty = matrix.m42;

      // Fast swipe
      let target = snapLevel;
      if (Math.abs(dy) > 50) {
        if (dy < 0) target = Math.min(snapLevel + 1, 2);
        else        target = Math.max(snapLevel - 1, 0);
      } else {
        // Find nearest snap
        let minDist = Infinity;
        [0, 1, 2].forEach((lvl) => {
          const d = Math.abs(ty - getSnapTy(lvl));
          if (d < minDist) { minDist = d; target = lvl; }
        });
      }

      snapLevel = target;
      applyTy(getSnapTy(target), true);
    }

    sheetHandle.addEventListener('touchstart', onStart, { passive: true });
    sheetHandle.addEventListener('mousedown', onStart);

    // Tapping peek area expands to half
    document.getElementById('sheet-peek').addEventListener('click', (e) => {
      if (e.target.closest('#sheet-peek-actions')) return; // don't intercept buttons
      if (snapLevel === 0) snapTo(1);
    });
  }

  // ── search ───────────────────────────────────────────────────
  function setupSearch() {
    const debouncedSearch = Utils.debounce(async (query, field) => {
      if (query.length < 2) {
        if (field === 'to' && !query) showSuggestions();
        else clearResults();
        return;
      }
      try {
        const map    = MapModule.getMap();
        const center = map ? map.getCenter() : null;
        const loc    = center ? { lat: center.lat, lng: center.lng } : null;
        const results = await SearchModule.geocode(query, loc);
        showResults(results, field);
      } catch { clearResults(); }
    }, 400);

    inputTo.addEventListener('focus', () => {
      searchDropdown.classList.remove('hidden');
      if (!inputTo.value.trim()) showSuggestions();
    });

    inputTo.addEventListener('input', (e) => {
      document.getElementById('btn-search-clear').classList.toggle('hidden', !e.target.value);
      debouncedSearch(e.target.value, 'to');
    });

    inputFrom.addEventListener('input', (e) => {
      debouncedSearch(e.target.value, 'from');
    });

    // Close dropdown when map is tapped
    document.getElementById('map').addEventListener('click', closeSearch);
  }

  function showSuggestions() {
    clearResults();
    const SAVED_ICONS = { home: '🏠', work: '💼' };
    const SAVED_LABELS = { home: 'Home', work: 'Work' };
    const saved   = ['home', 'work'].map((k) => ({ key: k, place: SearchModule.getSavedPlace(k) })).filter((s) => s.place);
    const recents = SearchModule.getRecents();
    if (!saved.length && !recents.length) return;

    if (saved.length) {
      searchResults.appendChild(makeSectionHeader('Saved Places'));
      saved.forEach(({ key, place }) => {
        const item = document.createElement('div');
        item.className = 'search-result-item suggestion-item';
        item.innerHTML = `
          <span class="suggestion-icon">${SAVED_ICONS[key]}</span>
          <div class="suggestion-text">
            <div class="search-result-name">${SAVED_LABELS[key]}</div>
            <div class="search-result-address">${esc(place.displayName)}</div>
          </div>`;
        item.addEventListener('click', () => selectSuggestion(place));
        searchResults.appendChild(item);
      });
    }

    if (recents.length) {
      searchResults.appendChild(makeSectionHeader('Recent'));
      recents.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'search-result-item suggestion-item';
        item.innerHTML = `
          <span class="suggestion-icon">🕐</span>
          <div class="suggestion-text">
            <div class="search-result-name">${esc(r.name)}</div>
            <div class="search-result-address">${esc(r.displayName)}</div>
          </div>`;
        item.addEventListener('click', () => selectSuggestion(r));
        searchResults.appendChild(item);
      });
    }
  }

  function makeSectionHeader(label) {
    const hdr = document.createElement('div');
    hdr.className = 'suggestion-header';
    hdr.textContent = label;
    return hdr;
  }

  function selectSuggestion(place) {
    inputTo.value = place.name;
    document.getElementById('btn-search-clear').classList.remove('hidden');
    inputTo.blur();
    closeSearch();
    SearchModule.saveRecent(place);
    if (onSelectResult) onSelectResult('to', place);
  }

  function setupSearchClear() {
    document.getElementById('btn-search-clear').addEventListener('click', () => {
      inputTo.value = '';
      document.getElementById('btn-search-clear').classList.add('hidden');
      clearResults();
      inputTo.focus();
    });
  }

  function setupFromChange() {
    document.getElementById('btn-change-from').addEventListener('click', () => {
      fromEditRow.classList.toggle('hidden');
      if (!fromEditRow.classList.contains('hidden')) inputFrom.focus();
    });
  }

  function closeSearch() {
    searchDropdown.classList.add('hidden');
    clearResults();
  }

  function showResults(results, field) {
    clearResults();
    if (!results || !results.length) return;

    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `
        <div class="search-result-name">${esc(r.name)}</div>
        <div class="search-result-address">${esc(r.displayName)}</div>
      `;
      div.addEventListener('click', () => {
        if (field === 'to') {
          inputTo.value = r.name;
          document.getElementById('btn-search-clear').classList.remove('hidden');
          SearchModule.saveRecent(r);
        } else {
          inputFrom.value = r.name;
          fromEditRow.classList.add('hidden');
        }
        inputTo.blur(); inputFrom.blur();
        closeSearch();
        if (onSelectResult) onSelectResult(field, r);
      });
      searchResults.appendChild(div);
    }
  }

  function clearResults() { searchResults.innerHTML = ''; }

  // ── departure ────────────────────────────────────────────────
  function setupDepartureTime() {
    setDepartureNow();

    btnDepartNow.addEventListener('click', () => {
      setDepartureNow();
      if (onDepartureChange) onDepartureChange(new Date());
    });

    const debounced = Utils.debounce((val) => {
      if (onDepartureChange) onDepartureChange(new Date(val));
    }, 800);

    departureInput.addEventListener('change', () => debounced(departureInput.value));
  }

  function setDepartureNow() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    departureInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function getDepartureTime() {
    return departureInput.value ? new Date(departureInput.value) : new Date();
  }

  // ── clear route ──────────────────────────────────────────────
  function setupClearRoute() {
    btnClearRoute.addEventListener('click', () => {
      inputTo.value = '';
      document.getElementById('btn-search-clear').classList.add('hidden');
      if (onClearRoute) onClearRoute();
    });
  }

  // ── navigate button ──────────────────────────────────────────
  function setupNavButton() {
    btnStartNav.addEventListener('click', () => {
      // Handled by app.js via toggleNavigation — button is wired there
    });
  }

  function setupEndNav() {
    document.getElementById('btn-end-nav').addEventListener('click', () => {
      // Trigger the same stop nav action as the Go button when active
      if (btnStartNav) btnStartNav.click();
    });
  }

  // ── navigation mode UI ───────────────────────────────────────
  function startNavMode(firstStep) {
    navBar.classList.remove('hidden');
    document.getElementById('search-bar').style.display = 'none';
    btnStartNav.textContent = 'Stop';
    btnStartNav.classList.add('navigating');
    if (firstStep) updateNavTurn(firstStep);
    snapTo(0); // collapse sheet to peek during nav
  }

  function stopNavMode() {
    navBar.classList.add('hidden');
    document.getElementById('search-bar').style.display = '';
    btnStartNav.textContent = 'Go';
    btnStartNav.classList.remove('navigating');
  }

  function updateNavTurn(step) {
    if (!step) return;
    navTurnIcon.textContent        = step.icon || '⬆️';
    navTurnDistance.textContent    = step.distance || '';
    navTurnInstruction.textContent = step.instruction || '';
  }

  // ── settings ─────────────────────────────────────────────────
  function setupSettings() {
    const overlay  = document.getElementById('settings-overlay');
    const panel    = document.getElementById('settings-panel');
    const btnOpen  = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-settings-close');

    const open  = () => { overlay.classList.remove('hidden'); panel.classList.remove('hidden'); };
    const close = () => { overlay.classList.add('hidden');    panel.classList.add('hidden'); };

    btnOpen.addEventListener('click', open);
    btnClose.addEventListener('click', close);
    overlay.addEventListener('click', close);

    // Units
    const btnMi = document.getElementById('btn-unit-mi');
    const btnKm = document.getElementById('btn-unit-km');
    const saved = localStorage.getItem('wm-units') || 'mi';
    if (saved === 'km') { btnKm.classList.add('active'); btnMi.classList.remove('active'); Utils.setUnits('km'); }

    btnMi.addEventListener('click', () => {
      btnMi.classList.add('active'); btnKm.classList.remove('active');
      localStorage.setItem('wm-units', 'mi'); Utils.setUnits('mi');
      if (_refreshDisplay) _refreshDisplay();
    });
    btnKm.addEventListener('click', () => {
      btnKm.classList.add('active'); btnMi.classList.remove('active');
      localStorage.setItem('wm-units', 'km'); Utils.setUnits('km');
      if (_refreshDisplay) _refreshDisplay();
    });

    // Manual origin
    document.getElementById('btn-set-location').addEventListener('click', async () => {
      const input = document.getElementById('menu-location-input');
      const query = input.value.trim();
      if (!query) return;
      try {
        const results = await SearchModule.geocode(query);
        if (!results.length) { toast('Location not found', 'error'); return; }
        if (onSelectResult) onSelectResult('from', results[0]);
        input.value = '';
        close();
        toast(`Origin: ${results[0].name}`, 'info', 2000);
      } catch { toast('Could not find location', 'error'); }
    });

    document.getElementById('menu-location-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-set-location').click();
    });

    // Home / Work saved places
    ['home', 'work'].forEach((key) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      const inputEl      = document.getElementById(`${key}-input`);
      const btnSet       = document.getElementById(`btn-set-${key}`);
      const btnClear     = document.getElementById(`btn-clear-${key}`);
      const nameEl       = document.getElementById(`${key}-name`);
      const placeholderEl = document.getElementById(`${key}-placeholder`);

      function refreshSavedUI() {
        const saved = SearchModule.getSavedPlace(key);
        if (saved) {
          nameEl.textContent = saved.name;
          nameEl.classList.remove('hidden');
          if (placeholderEl) placeholderEl.classList.add('hidden');
          btnClear.classList.remove('hidden');
        } else {
          nameEl.classList.add('hidden');
          if (placeholderEl) placeholderEl.classList.remove('hidden');
          btnClear.classList.add('hidden');
        }
      }
      refreshSavedUI();

      async function doSet() {
        const query = inputEl.value.trim();
        if (!query) return;
        try {
          const results = await SearchModule.geocode(query);
          if (!results.length) { toast(`${label} not found`, 'error'); return; }
          SearchModule.setSavedPlace(key, results[0]);
          inputEl.value = '';
          refreshSavedUI();
          toast(`${label} saved: ${results[0].name}`, 'info', 2000);
        } catch { toast(`Could not find ${label}`, 'error'); }
      }

      btnSet.addEventListener('click', doSet);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSet(); });
      btnClear.addEventListener('click', () => {
        SearchModule.deleteSavedPlace(key);
        refreshSavedUI();
      });
    });

    // Clear recents
    document.getElementById('btn-clear-recents').addEventListener('click', () => {
      SearchModule.clearRecents();
      toast('Recent destinations cleared', 'info', 2000);
    });

    document.getElementById('btn-clear-cache').addEventListener('click', async () => {
      if ('caches' in window) { const k = await caches.keys(); await Promise.all(k.map(c => caches.delete(c))); }
      if (navigator.serviceWorker) { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(s => s.unregister())); }
      location.reload(true);
    });
  }

  // ── route panel ──────────────────────────────────────────────
  function showRoutePanel() {
    closeSearch();
    snapTo(1); // open to half automatically
  }

  function hideRoutePanel() {
    snapTo(-1);
    routeEta.textContent      = '';
    routeDistance.textContent = '';
    weatherDelta.className    = '';
    weatherDelta.textContent  = '';
    weatherTimeline.innerHTML = '';
    directionsList.innerHTML  = '';
  }

  function updateRouteInfo({ eta, distance, delta, deltaClass }) {
    routeEta.textContent      = eta      || '';
    routeDistance.textContent = distance || '';
    if (delta) {
      weatherDelta.textContent = delta;
      weatherDelta.className   = deltaClass || 'clear';
    } else {
      weatherDelta.className   = '';
      weatherDelta.textContent = '';
    }
  }

  function renderWeatherTimeline(points) {
    weatherTimeline.innerHTML = '';
    for (const pt of points) {
      const div = document.createElement('div');
      div.className = `timeline-point ${pt.cssClass || 'clear'}`;
      div.innerHTML = `<span class="tl-icon">${pt.icon}</span><span class="tl-time">${pt.time}</span><span class="tl-label">${pt.label}</span>`;
      weatherTimeline.appendChild(div);
    }
  }

  function renderDirections(steps) {
    directionsList.innerHTML = '';
    for (const step of steps) {
      const div = document.createElement('div');
      div.className = 'direction-step';
      div.innerHTML = `
        <span class="step-icon">${step.icon}</span>
        <div class="step-text">${esc(step.instruction)}${step.weather ? `<div class="step-weather">${step.weather}</div>` : ''}</div>
        <span class="step-dist">${step.distance}</span>
      `;
      directionsList.appendChild(div);
    }
  }

  // ── loading ──────────────────────────────────────────────────
  function showLoading() {
    let el = document.getElementById('route-loading-text');
    if (!el) {
      el = document.createElement('div');
      el.id = 'route-loading-text';
      const peek = document.getElementById('sheet-peek');
      peek.parentNode.insertBefore(el, peek.nextSibling);
    }
    el.textContent = 'Computing route…';
    el.classList.remove('hidden');
  }

  function hideLoading() {
    const el = document.getElementById('route-loading-text');
    if (el) el.classList.add('hidden');
  }

  // ── toast ────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
  }

  // ── text helpers ─────────────────────────────────────────────
  function setFromText(text) { if (fromLabel) fromLabel.textContent = text || 'Current location'; }
  function setToText(text)   { if (inputTo)   { inputTo.value = text || ''; document.getElementById('btn-search-clear').classList.toggle('hidden', !text); } }
  function setRefreshDisplay(fn) { _refreshDisplay = fn; }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  return {
    init,
    showRoutePanel, hideRoutePanel,
    updateRouteInfo,
    renderWeatherTimeline, renderDirections,
    showLoading, hideLoading,
    toast,
    setFromText, setToText,
    getDepartureTime, setDepartureNow,
    snapTo,
    setRefreshDisplay,
    startNavMode, stopNavMode, updateNavTurn,
    SNAP_COLLAPSED, SNAP_HALF, SNAP_FULL,
  };
})();
