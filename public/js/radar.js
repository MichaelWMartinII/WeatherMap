/**
 * radar.js — RainViewer animated radar overlay
 */
const RadarModule = (() => {
  const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
  const TILE_SIZE = 256;

  let map = null;
  let currentLayer = null;
  let currentFrame = 0;
  let isPlaying = false;
  let playInterval = null;
  let refreshInterval = null;
  let frames = []; // { path, time }
  let tileHost = 'https://tilecache.rainviewer.com';
  let isVisible = false;

  // UI elements
  let slider, timeLabel, playPauseBtn;

  function init(leafletMap) {
    map = leafletMap;
    slider = document.getElementById('radar-slider');
    timeLabel = document.getElementById('radar-time');
    playPauseBtn = document.getElementById('radar-play-pause');

    slider.addEventListener('input', () => {
      setFrame(parseInt(slider.value, 10));
    });

    playPauseBtn.addEventListener('click', togglePlayPause);

    // Auto-refresh every 10 minutes
    refreshInterval = setInterval(loadFrames, 10 * 60 * 1000);
  }

  async function loadFrames() {
    // Pause playback before rebuilding layers
    pause();

    UI.toast('Loading radar...', 'info', 2000);

    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`RainViewer ${res.status}`);
      const data = await res.json();

      // Use host from API response
      tileHost = data.host || tileHost;

      frames = [];

      // Past radar frames
      if (data.radar && data.radar.past) {
        for (const f of data.radar.past) {
          frames.push({ path: f.path, time: f.time });
        }
      }

      // Nowcast (forecast) frames
      if (data.radar && data.radar.nowcast) {
        for (const f of data.radar.nowcast) {
          frames.push({ path: f.path, time: f.time });
        }
      }

      // Update slider
      slider.max = Math.max(0, frames.length - 1);

      // Remove any existing layer
      removeCurrentLayer();

      // Show the latest frame if radar is visible
      if (isVisible && frames.length > 0) {
        currentFrame = frames.length - 1;
        slider.value = currentFrame;
        showFrame(currentFrame);
      }
    } catch (err) {
      console.warn('Failed to load radar frames:', err);
      UI.toast('Radar data unavailable', 'error');
    }
  }

  function removeCurrentLayer() {
    if (currentLayer && map.hasLayer(currentLayer)) {
      map.removeLayer(currentLayer);
    }
    currentLayer = null;
  }

  function showFrame(index) {
    if (index < 0 || index >= frames.length) return;

    // Remove previous layer, add only the current one
    removeCurrentLayer();

    const url = `${tileHost}${frames[index].path}/${TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`;
    currentLayer = L.tileLayer(url, {
      tileSize: TILE_SIZE,
      opacity: 0.7,
      zIndex: 500,
      maxNativeZoom: 7,
      maxZoom: 18,
    });
    currentLayer.addTo(map);

    // Update time label
    const d = new Date(frames[index].time * 1000);
    timeLabel.textContent = Utils.formatTime(d);
  }

  function setFrame(index) {
    currentFrame = Utils.clamp(index, 0, frames.length - 1);
    slider.value = currentFrame;
    showFrame(currentFrame);
  }

  function togglePlayPause() {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (frames.length === 0) return;
    isPlaying = true;
    playPauseBtn.innerHTML = '&#9646;&#9646;'; // pause icon
    playInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % frames.length;
      slider.value = currentFrame;
      showFrame(currentFrame);
    }, 500);
  }

  function pause() {
    isPlaying = false;
    playPauseBtn.innerHTML = '&#9654;'; // play icon
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }

  async function show() {
    isVisible = true;
    document.getElementById('radar-controls').classList.remove('hidden');
    document.getElementById('btn-radar').classList.add('active');

    if (frames.length === 0) {
      await loadFrames();
    } else {
      currentFrame = frames.length - 1;
      slider.value = currentFrame;
      showFrame(currentFrame);
    }
  }

  function hide() {
    isVisible = false;
    pause();
    removeCurrentLayer();
    document.getElementById('radar-controls').classList.add('hidden');
    document.getElementById('btn-radar').classList.remove('active');
  }

  function toggle() {
    if (isVisible) hide();
    else show();
  }

  function destroy() {
    pause();
    removeCurrentLayer();
    if (refreshInterval) clearInterval(refreshInterval);
  }

  return {
    init,
    show,
    hide,
    toggle,
    destroy,
  };
})();
