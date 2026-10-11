import type { Song } from '@encode42/nbs.js';

import type { NoteBuffer } from './note-buffer';
import type { ViewerRenderPayload } from './viewer-backend';

export function buildViewerRenderPayload(song: Song, noteBuffer: NoteBuffer): ViewerRenderPayload {
  const layers = song.layers.map((layer, id) => ({
    id,
    name: `Layer ${id}`,
    volume: layer.volume,
  }));

  return {
    layers,
    noteData: noteBuffer.getBuffer(),
    songLength: song.length,
    initialTempo: song.tempo * 15,
  };
}
