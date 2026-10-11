import { Song } from '@encode42/nbs.js';

import instrumentAssetPaths from './instrument-assets/manifest';
import { ExtraSounds, resolveExtraSound } from './song';

export class MissingAudioFileError extends Error {
  constructor(
    readonly instrumentId: number,
    readonly instrumentName: string,
    readonly soundFile?: string,
  ) {
    const label = `${instrumentId} (${instrumentName})`;
    super(
      soundFile
        ? `Missing audio file "${soundFile}" for instrument ${label}`
        : `Missing audio file for instrument ${label}`,
    );
    this.name = 'MissingAudioFileError';
  }
}

export const defaultInstrumentData = [
  { name: 'Harp', audioSource: instrumentAssetPaths['sounds/harp.ogg'] },
  { name: 'Double Bass', audioSource: instrumentAssetPaths['sounds/dbass.ogg'] },
  { name: 'Bass Drum', audioSource: instrumentAssetPaths['sounds/bdrum.ogg'] },
  { name: 'Snare Drum', audioSource: instrumentAssetPaths['sounds/sdrum.ogg'] },
  { name: 'Click', audioSource: instrumentAssetPaths['sounds/click.ogg'] },
  { name: 'Guitar', audioSource: instrumentAssetPaths['sounds/guitar.ogg'] },
  { name: 'Flute', audioSource: instrumentAssetPaths['sounds/flute.ogg'] },
  { name: 'Bell', audioSource: instrumentAssetPaths['sounds/bell.ogg'] },
  { name: 'Chime', audioSource: instrumentAssetPaths['sounds/icechime.ogg'] },
  { name: 'Xylophone', audioSource: instrumentAssetPaths['sounds/xylobone.ogg'] },
  { name: 'Iron Xylophone', audioSource: instrumentAssetPaths['sounds/iron_xylophone.ogg'] },
  { name: 'Cow Bell', audioSource: instrumentAssetPaths['sounds/cow_bell.ogg'] },
  { name: 'Didgeridoo', audioSource: instrumentAssetPaths['sounds/didgeridoo.ogg'] },
  { name: 'Bit', audioSource: instrumentAssetPaths['sounds/bit.ogg'] },
  { name: 'Banjo', audioSource: instrumentAssetPaths['sounds/banjo.ogg'] },
  { name: 'Pling', audioSource: instrumentAssetPaths['sounds/pling.ogg'] },
  { name: 'Trumpet', audioSource: instrumentAssetPaths['sounds/trumpet.ogg'] },
  { name: 'Exposed Trumpet', audioSource: instrumentAssetPaths['sounds/trumpet_exposed.ogg'] },
  { name: 'Weathered Trumpet', audioSource: instrumentAssetPaths['sounds/trumpet_weathered.ogg'] },
  { name: 'Oxidized Trumpet', audioSource: instrumentAssetPaths['sounds/trumpet_oxidized.ogg'] },
];

export default class PlayerInstrument {
  id: number;
  name: string;
  baseKey: number;
  audioSource: string | ArrayBuffer;
  audioBuffer?: AudioBuffer;
  isBuiltIn: boolean;

  constructor(
    id: number,
    name: string,
    baseKey: number,
    audioSource: string | ArrayBuffer = '',
    isBuiltIn: boolean = false,
  ) {
    this.id = id;
    this.name = name;
    this.baseKey = baseKey;
    this.audioSource = audioSource;
    this.isBuiltIn = isBuiltIn;
  }
}

export const defaultInstruments: readonly PlayerInstrument[] = defaultInstrumentData.map(
  (data, id) => new PlayerInstrument(id, data.name, 45, data.audioSource, true),
);

export function loadCustomInstruments(song: Song, extraSounds: ExtraSounds) {
  const customInstruments: PlayerInstrument[] = [];

  song.instruments.loaded.forEach((ins, id) => {
    if (!ins || ins.builtIn) return;

    const soundFile = ins.meta.soundFile;
    const sound = resolveExtraSound(extraSounds, soundFile);
    if (soundFile && !sound) {
      console.warn(new MissingAudioFileError(id, ins.meta.name, soundFile));
    }

    customInstruments.push(new PlayerInstrument(id, ins.meta.name, ins.key, sound || '', false));
  });

  return customInstruments;
}
