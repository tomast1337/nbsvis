import './style.css';

import { Player } from '@opennbs/nbsvis';

import { OscillatorAudioBackend } from './audio/OscillatorAudioBackend';
import { ThreeViewerBackend } from './three/ThreeViewerBackend';

const app = document.getElementById('app');
const statusEl = document.getElementById('status');
const loadBtn = document.getElementById('loadSong');
const toggleBtn = document.getElementById('togglePlay');
const stopBtn = document.getElementById('stop');
const loopBtn = document.getElementById('toggleLoop');
const seekInput = document.getElementById('seek') as HTMLInputElement | null;
const fileInput = document.getElementById('songFile') as HTMLInputElement | null;
const urlInput = document.getElementById('songUrl') as HTMLInputElement | null;

if (!app || !statusEl || !loadBtn || !toggleBtn || !stopBtn || !loopBtn || !seekInput) {
  throw new Error('Missing app UI elements.');
}
const statusNode: HTMLElement = statusEl;
const toggleNode: HTMLElement = toggleBtn;
const loopNode: HTMLElement = loopBtn;
const seekNode: HTMLInputElement = seekInput;
const viewer = new ThreeViewerBackend();
const audio = new OscillatorAudioBackend();
viewer.mount(app);
viewer.setViewMode('piano-roll');
const player = new Player({ viewerBackend: viewer, audioBackend: audio });
let songLoaded = false;
let lastObjectUrl: string | null = null;

const DEFAULT_SONG = 'megacollab.zip';

function setStatus(text: string): void {
  statusNode.textContent = text;
}

function updatePlayButton(): void {
  toggleNode.textContent = player.isEnded ? '↺' : player.isPlaying ? '⏸️' : '▶️';
}

async function loadSong(url: string): Promise<void> {
  try {
    songLoaded = false;
    setStatus('Loading song...');
    await player.loadSong(url);
    songLoaded = true;
    setStatus('Song loaded. Press Play.');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[three-osc-demo] song load failed', error);
    setStatus(`Load failed: ${msg}`);
  }
  updatePlayButton();
}

function setObjectUrl(url: string | null): void {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = url;
}

async function loadFromInputs(): Promise<void> {
  const noteblockUrl = urlInput?.value.trim();
  const file = fileInput?.files?.[0];

  if (noteblockUrl && noteblockUrl.startsWith('https://noteblock.world/song/')) {
    const songId = noteblockUrl.split('/').pop();
    const serverUrl = import.meta.env.DEV ? 'http://localhost:4000' : 'https://api.noteblock.world';
    try {
      setStatus('Fetching song from Note Block World...');
      const response = await fetch(`${serverUrl}/v1/song/${songId}/open`, {
        headers: { src: 'downloadButton' },
      });
      const downloadUrl = await response.text();
      setObjectUrl(null);
      await loadSong(downloadUrl);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Load failed: ${msg}`);
    }
  } else if (file) {
    setObjectUrl(URL.createObjectURL(file));
    await loadSong(lastObjectUrl!);
  } else {
    setStatus('Select a .nbs/.zip file or enter a noteblock.world URL first.');
  }
}

loadBtn.addEventListener('click', () => {
  void loadFromInputs();
});

toggleNode.addEventListener('click', () => {
  if (!songLoaded) {
    setStatus('Load a song first.');
    return;
  }
  const isPlaying = player.togglePlayback();
  setStatus(isPlaying ? 'Playing...' : 'Paused');
  updatePlayButton();
});

stopBtn.addEventListener('click', () => {
  if (!songLoaded) return;
  player.stop();
  setStatus('Stopped');
  updatePlayButton();
});

loopNode.addEventListener('click', () => {
  const nextLoop = !player.loop;
  player.loop = nextLoop;
  loopNode.textContent = nextLoop ? '🔁' : '➡';
});

let seeking = false;
seekNode.addEventListener('pointerdown', () => {
  seeking = true;
});
window.addEventListener('pointerup', () => {
  seeking = false;
});
seekNode.addEventListener('input', () => {
  if (!songLoaded) return;
  player.seek(parseFloat(seekNode.value));
});

player.on('ended', () => {
  setStatus('Ended');
  updatePlayButton();
});
player.on('play', updatePlayButton);
player.on('pause', updatePlayButton);
player.on('stop', updatePlayButton);
player.on('seek', ({ tick, totalLength }) => {
  if (!songLoaded) return;
  seekNode.max = totalLength.toString();
  // don't fight the user while they drag the slider
  if (!seeking) seekNode.value = tick.toString();
  setStatus(`Tick ${tick.toFixed(2)} / ${totalLength}`);
});

window.addEventListener('resize', () => {
  viewer.resize(app.clientWidth, app.clientHeight);
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyZ') return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  event.preventDefault();
  const enabled = viewer.toggleFpsMode();
  const camera = viewer.getCameraState();
  if (camera) {
    console.log('[camera]', {
      fpsMode: enabled,
      position: {
        x: Number(camera.position.x.toFixed(3)),
        y: Number(camera.position.y.toFixed(3)),
        z: Number(camera.position.z.toFixed(3)),
      },
      yaw: Number(camera.yaw.toFixed(4)),
      pitch: Number(camera.pitch.toFixed(4)),
    });
  }
  setStatus(enabled ? 'FPS mode enabled: WASD + mouse (Esc or Z to exit)' : 'FPS mode disabled.');
});

window.addEventListener('beforeunload', () => {
  setObjectUrl(null);
  player.dispose();
  viewer.destroy();
});

const base = document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI}/`;
void loadSong(new URL(DEFAULT_SONG, base).href);
