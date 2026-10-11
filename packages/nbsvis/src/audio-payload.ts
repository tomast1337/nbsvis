import type { Song } from '@encode42/nbs.js';

import type { AudioPlaybackPayload } from './audio-backend';
import type PlayerInstrument from './instrument';
import { MissingAudioFileError } from './instrument';
import type { NoteBuffer } from './note-buffer';
import { getTempoChangeEvents } from './song';

async function instrumentSourceToArrayBuffer(ins: PlayerInstrument): Promise<ArrayBuffer | null> {
  const { audioSource } = ins;
  if (!audioSource) {
    if (ins.isBuiltIn) {
      throw new MissingAudioFileError(ins.id, ins.name);
    }
    return null;
  }
  if (typeof audioSource === 'string') {
    const response = await fetch(audioSource);
    if (!response.ok) {
      throw new MissingAudioFileError(ins.id, ins.name, audioSource);
    }
    return await response.arrayBuffer();
  }
  return audioSource.slice(0);
}

export async function buildAudioPlaybackPayload(
  song: Song,
  noteBuffer: NoteBuffer,
  instruments: readonly PlayerInstrument[],
): Promise<AudioPlaybackPayload> {
  const instrumentBuffers: Record<number, ArrayBuffer> = {};

  for (const ins of instruments) {
    if (!ins) continue;

    let buf: ArrayBuffer | null;
    try {
      buf = await instrumentSourceToArrayBuffer(ins);
    } catch (err) {
      if (err instanceof MissingAudioFileError) {
        console.error(err);
        continue;
      }
      throw err;
    }
    if (buf) {
      instrumentBuffers[ins.id] = buf;
    }
  }

  const tempoChangeEvents = getTempoChangeEvents(song);
  const tempoSegments = Object.entries(tempoChangeEvents).map(([startTick, bpm]) => ({
    startTick: Number(startTick),
    bpm,
  }));
  tempoSegments.sort((a, b) => a.startTick - b.startTick);

  return {
    noteData: noteBuffer.getBuffer(),
    instrumentBuffers,
    timeline: {
      initialTempo: song.tempo * 15,
      lengthTicks: song.length,
      tempoSegments,
    },
    loopStartTick: song.loop.startTick,
    ticksPerBeat: 4,
  };
}
