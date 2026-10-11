/** Built-in view implementations supported by the Pixi reference viewer. */
export type NbsvisViewMode = 'piano-roll';

export interface ViewerLayerInfo {
  id: number;
  name: string;
  volume: number;
}

export interface ViewerRenderPayload {
  layers: ViewerLayerInfo[];
  /** Compact scheduled note buffer shared with the audio path. */
  noteData: SharedArrayBuffer;
  songLength: number;
  initialTempo: number;
}

export interface NbsvisViewerBackend {
  mount(container: HTMLElement): void;
  destroy(): void;
  loadSong(payload: ViewerRenderPayload): void;

  setViewMode(mode: NbsvisViewMode): void;

  setTick(tick: number): void;
  setPlaying(isPlaying: boolean): void;
  setSoundCount(count: number, max: number): void;

  onRenderTick(callback: (deltaTime: number) => void): () => void;
  resize(width: number, height: number): void;
}
