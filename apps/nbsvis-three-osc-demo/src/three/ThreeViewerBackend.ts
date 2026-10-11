import type { NbsvisViewMode, NbsvisViewerBackend, ViewerRenderPayload } from '@opennbs/nbsvis';
import { NoteBuffer } from '@opennbs/nbsvis';

import type { CameraState } from './PianoScene';
import { PianoScene } from './PianoScene';

/** Largest forward step (in ticks) that is treated as playback rather than a seek. */
const MAX_CATCHUP_TICKS = 16;
/** How many ticks ahead of the playhead notes are visible in the sky. */
const FALL_LOOKAHEAD_TICKS = 24;
/** World units a note travels per tick as it falls. */
const FALL_UNITS_PER_TICK = 1.1;
/** Key index → MIDI offset (key 0 is A0 = MIDI 21). */
const KEY_TO_MIDI_OFFSET = 21;

export class ThreeViewerBackend implements NbsvisViewerBackend {
  private readonly keyHoldTicks = 0.9;
  private container: HTMLElement | null = null;
  private scene: PianoScene | null = null;
  private mode: NbsvisViewMode = 'piano-roll';
  private noteBuffer: NoteBuffer | null = null;
  private activeUntilTick = new Map<number, number>();
  private activeVelocity = new Map<number, number>();
  private currentActive = new Set<number>();
  private currentTick = 0;
  private playing = false;
  /** Last tick whose notes were lit, so each tick triggers once as the playhead crosses it. */
  private lastTriggeredTick = -1;
  private rafCallbacks = new Set<(deltaTime: number) => void>();
  private rafId: number | null = null;
  private lastFrameMs = 0;

  public mount(container: HTMLElement): void {
    this.container = container;
    this.scene = new PianoScene(container);
    this.ensureRafLoop();
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rafCallbacks.clear();
    this.currentActive.clear();
    this.noteBuffer = null;
    this.activeUntilTick.clear();
    this.activeVelocity.clear();
    this.scene?.destroy();
    this.scene = null;
    this.container = null;
  }

  public loadSong(payload: ViewerRenderPayload): void {
    this.activeUntilTick.clear();
    this.activeVelocity.clear();
    // Read straight from the shared buffer; no per-note copies.
    this.noteBuffer = new NoteBuffer(payload.noteData);
    this.lastTriggeredTick = -1;
    this.releaseAllKeys();
    this.setTick(0);
  }

  public setViewMode(mode: NbsvisViewMode): void {
    this.mode = mode;
  }

  public setTick(tick: number): void {
    this.currentTick = tick;
    const scene = this.scene;
    if (!scene) return;
    const floorTick = Math.floor(tick);
    if (this.noteBuffer) {
      // Walk every tick crossed since the last call so none are skipped at low FPS or
      // high tempo. Seeks (backwards or large jumps) only trigger the target tick.
      const crossed = floorTick - this.lastTriggeredTick;
      const firstTick =
        crossed > 0 && crossed <= MAX_CATCHUP_TICKS ? this.lastTriggeredTick + 1 : floorTick;
      if (floorTick !== this.lastTriggeredTick || firstTick !== floorTick) {
        for (let t = firstTick; t <= floorTick; t++) {
          this.lightTick(t, tick);
        }
      }
      this.lastTriggeredTick = floorTick;
    }

    this.updateFallingNotes(scene, tick);

    const nextActive = new Set<number>();
    const expired: number[] = [];
    for (const [key, untilTick] of this.activeUntilTick.entries()) {
      if (untilTick > tick) {
        nextActive.add(key);
      } else {
        expired.push(key);
      }
    }
    for (const key of expired) {
      this.activeUntilTick.delete(key);
    }

    for (const key of this.currentActive) {
      if (!nextActive.has(key)) {
        scene.setKeyActive(key + 21, false);
        this.activeVelocity.delete(key);
      }
    }
    for (const key of nextActive) {
      if (!this.currentActive.has(key)) {
        scene.setKeyActive(key + 21, true, this.activeVelocity.get(key) ?? 1);
      }
    }
    this.currentActive = nextActive;
  }

  public setPlaying(isPlaying: boolean): void {
    if (this.playing && !isPlaying) {
      // Playhead stopped advancing, so tick-based expiry would hold keys down forever.
      this.releaseAllKeys();
    }
    this.playing = isPlaying;
  }

  private updateFallingNotes(scene: PianoScene, tick: number): void {
    scene.beginFallingNotes();
    const buffer = this.noteBuffer;
    if (buffer) {
      const first = Math.max(0, Math.floor(tick));
      const last = Math.min(buffer.tickCount - 1, first + FALL_LOOKAHEAD_TICKS);
      for (let t = first; t <= last; t++) {
        const height = (t - tick) * FALL_UNITS_PER_TICK;
        if (height < 0) continue; // already landed; the key itself lights up
        buffer.forEachNoteAtTick(t, (_instrument, pitch, volume) => {
          const pitchCents = Math.log2(pitch) * 1200;
          const key = Math.max(0, Math.min(87, Math.floor(pitchCents / 100) + 45));
          scene.addFallingNote(key + KEY_TO_MIDI_OFFSET, height, volume);
        });
      }
    }
    scene.endFallingNotes();
  }

  private lightTick(tick: number, holdFrom: number): void {
    if (!this.noteBuffer || tick < 0 || tick >= this.noteBuffer.tickCount) return;
    this.noteBuffer.forEachNoteAtTick(tick, (_instrument, pitch, volume) => {
      const pitchCents = Math.log2(pitch) * 1200;
      const key = Math.max(0, Math.min(87, Math.floor(pitchCents / 100) + 45));
      const prev = this.activeUntilTick.get(key) ?? -Infinity;
      this.activeUntilTick.set(key, Math.max(prev, holdFrom + this.keyHoldTicks));
      this.activeVelocity.set(key, volume);
    });
  }

  private releaseAllKeys(): void {
    for (const key of this.currentActive) {
      this.scene?.setKeyActive(key + 21, false);
    }
    this.currentActive.clear();
    this.activeUntilTick.clear();
    this.activeVelocity.clear();
  }

  public setSoundCount(_count: number, _max: number): void {}

  public onRenderTick(callback: (deltaTime: number) => void): () => void {
    this.rafCallbacks.add(callback);
    this.ensureRafLoop();
    return () => {
      this.rafCallbacks.delete(callback);
    };
  }

  public resize(width: number, height: number): void {
    const scene = this.scene;
    const container = this.container;
    if (!scene || !container) return;
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    scene.resize();
  }

  public toggleFpsMode(): boolean {
    return this.scene?.toggleFpsMode() ?? false;
  }

  public getCameraState(): CameraState | null {
    return this.scene?.getCameraState() ?? null;
  }

  private ensureRafLoop(): void {
    if (this.rafId !== null) return;
    this.lastFrameMs = performance.now();
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      const now = performance.now();
      const delta = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      for (const cb of this.rafCallbacks) cb(delta);
    };
    this.rafId = requestAnimationFrame(loop);
  }
}
