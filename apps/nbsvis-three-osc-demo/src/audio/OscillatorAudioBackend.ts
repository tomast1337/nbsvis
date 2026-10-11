import { type AudioPlaybackPayload, type NbsvisAudioBackend, NoteBuffer } from '@opennbs/nbsvis';

type TempoSegment = { startTick: number; bpm: number };
type Voice = { gain: GainNode; source: AudioScheduledSourceNode };

/** Frequency of NBS key 45 (F#4), the pitch a ratio of 1 maps to. */
const BASE_FREQUENCY = 369.99;
/** How far ahead of the visual playhead notes are scheduled on the audio clock. */
const LOOKAHEAD_SECONDS = 0.1;
const MAX_VOICES = 96;
/** Ticks older than this behind the playhead are dropped (e.g. after a background-tab stall). */
const STALE_SECONDS = 0.05;
/** Fade time used when cutting off sounding voices. */
const CUT_FADE_SECONDS = 0.02;
const ATTACK_SECONDS = 0.004;

type Timbre = {
  kind: 'tone' | 'kick' | 'noise';
  /** Amplitudes of partials 1..n (additive sine series). */
  harmonics?: number[];
  /** Octave offset relative to the written pitch (matches note block ranges). */
  octave?: number;
  /** Seconds for the note to fade out. */
  decay: number;
  /** Band-pass centre for noise voices. */
  noiseFreq?: number;
  /** Peak level relative to other instruments. */
  level?: number;
};

// Indexed by built-in NBS instrument id; unknown/custom instruments use FALLBACK_TIMBRE.
const TIMBRES: Timbre[] = [
  { kind: 'tone', harmonics: [1, 0.35, 0.15, 0.06], decay: 0.9 }, // Harp
  { kind: 'tone', harmonics: [1, 0.55, 0.25, 0.1], octave: -2, decay: 0.6, level: 1.1 }, // Double Bass
  { kind: 'kick', decay: 0.28, level: 1.4 }, // Bass Drum
  { kind: 'noise', noiseFreq: 1800, decay: 0.16, level: 0.9 }, // Snare Drum
  { kind: 'noise', noiseFreq: 5000, decay: 0.035, level: 0.7 }, // Click
  { kind: 'tone', harmonics: [1, 0.6, 0.35, 0.2, 0.1], octave: -1, decay: 0.7 }, // Guitar
  { kind: 'tone', harmonics: [1, 0.12, 0.05], octave: 1, decay: 0.5 }, // Flute
  { kind: 'tone', harmonics: [1, 0, 0.5, 0, 0.25], octave: 2, decay: 1.4, level: 0.7 }, // Bell
  { kind: 'tone', harmonics: [1, 0, 0.3, 0, 0.45], octave: 2, decay: 1.6, level: 0.6 }, // Chime
  { kind: 'tone', harmonics: [1, 0, 0, 0.5], octave: 2, decay: 0.35, level: 0.9 }, // Xylophone
  { kind: 'tone', harmonics: [1, 0, 0.4, 0.2], decay: 0.8, level: 0.8 }, // Iron Xylophone
  { kind: 'tone', harmonics: [1, 0.2, 0.7, 0.2, 0.4], octave: 1, decay: 0.45 }, // Cow Bell
  { kind: 'tone', harmonics: [1, 0.8, 0.5, 0.35, 0.2], octave: -1, decay: 0.55 }, // Didgeridoo
  { kind: 'tone', harmonics: [1, 0, 0.33, 0, 0.2, 0, 0.14], decay: 0.3, level: 0.6 }, // Bit
  { kind: 'tone', harmonics: [1, 0.7, 0.5, 0.3, 0.2], decay: 0.45 }, // Banjo
  { kind: 'tone', harmonics: [1, 0.25, 0.1], decay: 0.7 }, // Pling
  { kind: 'tone', harmonics: [1, 0.7, 0.5, 0.4, 0.25, 0.15], decay: 0.6, level: 0.8 }, // Trumpet
  { kind: 'tone', harmonics: [1, 0.6, 0.4, 0.3, 0.2], decay: 0.6, level: 0.8 }, // Exposed Trumpet
  { kind: 'tone', harmonics: [1, 0.5, 0.3, 0.2, 0.1], decay: 0.6, level: 0.8 }, // Weathered Trumpet
  { kind: 'tone', harmonics: [1, 0.35, 0.2, 0.1], decay: 0.6, level: 0.8 }, // Oxidized Trumpet
];
const FALLBACK_TIMBRE: Timbre = { kind: 'tone', harmonics: [1, 0.3, 0.1], decay: 0.6 };

export class OscillatorAudioBackend implements NbsvisAudioBackend {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noteBuffer: NoteBuffer | null = null;
  private tempoSegments: TempoSegment[] = [{ startTick: 0, bpm: 120 }];
  private lengthTicks = 0;
  private loopStartTick = 0;
  private _loop = false;

  private rafId: number | null = null;
  private playing = false;
  private ended = false;

  private tickAtPlayStart = 0;
  private perfAtPlayStart = 0;
  private currentTickValue = 0;
  private lastRenderedTick = -1;

  private activeVoices = new Set<Voice>();
  private waves = new Map<number, PeriodicWave>();
  private noiseBuffer: AudioBuffer | null = null;
  private maxVoices = 0;
  private endedListeners = new Set<() => void>();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;

      // Dense songs stack hundreds of voices; keep the sum from clipping.
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;

      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  public async loadSong(payload: AudioPlaybackPayload): Promise<void> {
    this.ensureContext();
    this.noteBuffer = new NoteBuffer(payload.noteData);
    this.tempoSegments = [...payload.timeline.tempoSegments].sort(
      (a, b) => a.startTick - b.startTick,
    );
    if (!this.tempoSegments.length || this.tempoSegments[0].startTick !== 0) {
      this.tempoSegments.unshift({ startTick: 0, bpm: payload.timeline.initialTempo });
    }
    this.lengthTicks = payload.timeline.lengthTicks;
    this.loopStartTick = payload.loopStartTick;
    this.stop();
    this.seekToTick(0);
  }

  public play(): void {
    if (!this.noteBuffer) return;
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      void ctx.resume();
    }
    if (this.ended) {
      this.seekToTick(0);
      this.ended = false;
    }
    this.playing = true;
    this.tickAtPlayStart = this.currentTickValue;
    this.perfAtPlayStart = performance.now();
    this.startLoop();
  }

  public pause(): void {
    this.playing = false;
    this.silenceVoices();
  }

  public stop(): void {
    this.playing = false;
    this.seekToTick(0);
    this.ended = false;
  }

  public seekToTick(tick: number): void {
    this.silenceVoices();
    this.reposition(tick);
  }

  /** Moves the playhead without cutting off voices (used for loop wrap-around). */
  private reposition(tick: number): void {
    this.currentTickValue = Math.max(0, Math.min(this.lengthTicks, tick));
    this.lastRenderedTick = Math.floor(this.currentTickValue) - 1;
    this.tickAtPlayStart = this.currentTickValue;
    this.perfAtPlayStart = performance.now();
  }

  public get loop(): boolean {
    return this._loop;
  }

  public set loop(value: boolean) {
    this._loop = value;
  }

  public get currentTick(): number {
    return this.currentTickValue;
  }

  public get soundCount(): number {
    return this.activeVoices.size;
  }

  public get maxSoundCount(): number {
    return this.maxVoices;
  }

  public get isPlaying(): boolean {
    return this.playing;
  }

  public get isEnded(): boolean {
    return this.ended;
  }

  public onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const frame = () => {
      this.rafId = requestAnimationFrame(frame);
      if (!this.playing || !this.noteBuffer) return;

      const elapsedSeconds = (performance.now() - this.perfAtPlayStart) / 1000;
      this.currentTickValue = this.tickAtPlayStart + this.secondsToTicks(elapsedSeconds);

      if (this.currentTickValue >= this.lengthTicks) {
        if (this._loop) {
          this.reposition(this.loopStartTick);
          return;
        }
        this.currentTickValue = this.lengthTicks;
        this.playing = false;
        if (!this.ended) {
          this.ended = true;
          for (const listener of this.endedListeners) listener();
        }
      }

      // Schedule slightly ahead on the audio clock so note starts are sample-accurate
      // instead of being quantised to animation frames.
      const secPerTick =
        60 / (this.tempoSegments[this.findSegmentIndex(this.currentTickValue)].bpm * 4);
      const targetTick = Math.min(
        Math.floor(this.currentTickValue + LOOKAHEAD_SECONDS / secPerTick),
        this.lengthTicks - 1,
      );
      // After a long stall (e.g. a background tab) skip ticks that are already stale
      // instead of firing them all at once.
      const oldestTick = Math.floor(this.currentTickValue - STALE_SECONDS / secPerTick);
      const firstTick = Math.max(this.lastRenderedTick + 1, oldestTick, 0);
      for (let t = firstTick; t <= targetTick; t++) {
        this.triggerTick(t);
      }
      this.lastRenderedTick = Math.max(this.lastRenderedTick, targetTick);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Fades out and stops every voice that is playing or scheduled. */
  private silenceVoices(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const voice of this.activeVoices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, CUT_FADE_SECONDS / 3);
      try {
        voice.source.stop(now + CUT_FADE_SECONDS);
      } catch {
        // already stopped
      }
    }
  }

  private triggerTick(tick: number): void {
    if (!this.noteBuffer || !this.ctx) return;
    const ctx = this.ctx;
    const when =
      ctx.currentTime +
      Math.max(0, this.secondsForTickDelta(this.currentTickValue, tick - this.currentTickValue));

    this.noteBuffer.forEachNoteAtTick(
      tick,
      (instrument: number, pitch: number, volume: number, panning: number) => {
        if (this.activeVoices.size >= MAX_VOICES) return;
        this.playVoice(ctx, when, instrument, pitch, volume, panning);
      },
    );
  }

  private playVoice(
    ctx: AudioContext,
    when: number,
    instrument: number,
    pitch: number,
    volume: number,
    panning: number,
  ): void {
    const timbre = TIMBRES[instrument] ?? FALLBACK_TIMBRE;
    const peak = Math.max(0.0001, volume * 0.22 * (timbre.level ?? 1));
    const end = when + ATTACK_SECONDS + timbre.decay;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    const panNode = ctx.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, panning));

    let source: OscillatorNode | AudioBufferSourceNode;
    if (timbre.kind === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.getNoiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = (timbre.noiseFreq ?? 2000) * Math.min(2, Math.max(0.5, pitch));
      filter.Q.value = 0.8;
      src.connect(filter);
      filter.connect(gain);
      source = src;
    } else {
      const osc = ctx.createOscillator();
      if (timbre.kind === 'kick') {
        osc.type = 'sine';
        const start = 140 * Math.min(2, Math.max(0.5, pitch));
        osc.frequency.setValueAtTime(start, when);
        osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
      } else {
        osc.setPeriodicWave(this.getWave(ctx, instrument, timbre));
        osc.frequency.value = BASE_FREQUENCY * 2 ** (timbre.octave ?? 0) * pitch;
      }
      osc.connect(gain);
      source = osc;
    }

    gain.connect(panNode);
    panNode.connect(this.master!);

    const voice: Voice = { gain, source };
    this.activeVoices.add(voice);
    this.maxVoices = Math.max(this.maxVoices, this.activeVoices.size);
    source.onended = () => {
      this.activeVoices.delete(voice);
      source.disconnect();
      gain.disconnect();
      panNode.disconnect();
    };

    source.start(when);
    source.stop(end + 0.02);
  }

  private getWave(ctx: AudioContext, instrument: number, timbre: Timbre): PeriodicWave {
    let wave = this.waves.get(instrument);
    if (!wave) {
      const harmonics = timbre.harmonics ?? [1];
      const real = new Float32Array(harmonics.length + 1);
      const imag = new Float32Array(harmonics.length + 1);
      harmonics.forEach((amp, i) => {
        imag[i + 1] = amp;
      });
      wave = ctx.createPeriodicWave(real, imag);
      this.waves.set(instrument, wave);
    }
    return wave;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.5);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  private secondsToTicks(seconds: number): number {
    if (seconds <= 0) return 0;
    let remaining = seconds;
    let ticks = 0;

    for (let i = 0; i < this.tempoSegments.length; i++) {
      const seg = this.tempoSegments[i];
      const next = this.tempoSegments[i + 1];
      const segTickLength = next ? next.startTick - seg.startTick : Infinity;
      const secPerTick = 60 / (seg.bpm * 4);
      const segSeconds = segTickLength * secPerTick;
      if (remaining <= segSeconds) {
        return ticks + remaining / secPerTick;
      }
      ticks += segTickLength;
      remaining -= segSeconds;
    }
    return ticks;
  }

  private secondsForTickDelta(fromTick: number, tickDelta: number): number {
    let remaining = tickDelta;
    let tick = fromTick;
    let seconds = 0;
    while (remaining > 0) {
      const segIndex = this.findSegmentIndex(tick);
      const seg = this.tempoSegments[segIndex];
      const next = this.tempoSegments[segIndex + 1];
      const untilNext = next ? next.startTick - tick : remaining;
      const consume = Math.min(remaining, Math.max(untilNext, 1));
      const secPerTick = 60 / (seg.bpm * 4);
      seconds += consume * secPerTick;
      tick += consume;
      remaining -= consume;
    }
    return seconds;
  }

  private findSegmentIndex(tick: number): number {
    let idx = 0;
    for (let i = 0; i < this.tempoSegments.length; i++) {
      if (this.tempoSegments[i].startTick <= tick) idx = i;
      else break;
    }
    return idx;
  }
}
