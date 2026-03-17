import {
	type GridEntry, type TabColumn, type DurationId, type Stave,
	isBarline, STRING_COUNT, DEFAULT_BPM,
} from './editor/types';
import { parseVexTabSource } from './editor/parser';

// ── Constants ───────────────────────────────────────────────────────

/** Standard guitar tuning: MIDI note numbers for each open string.
 *  Index 0 = string 1 (high E), index 5 = string 6 (low E). */
const STANDARD_TUNING_MIDI = [64, 59, 55, 50, 45, 40];

/** Map from duration ID to its divisor of a whole note. */
const DURATION_DIVISORS: Record<DurationId, number> = {
	'w': 1, 'h': 2, 'q': 4, '8': 8, '16': 16, '32': 32,
};

const SECONDS_PER_MINUTE = 60;
const BEATS_PER_WHOLE = 4;
const DOT_MULTIPLIER = 1.5;

/** Reference pitch for MIDI-to-frequency conversion. */
const MIDI_A4 = 69;
const FREQ_A4 = 440;
const SEMITONES_PER_OCTAVE = 12;

/** Pluck envelope parameters (seconds). */
const ATTACK_TIME = 0.005;
const DECAY_TIME = 0.15;
const SUSTAIN_LEVEL = 0.25;
const RELEASE_TIME = 0.15;
const PEAK_GAIN = 0.6;
const MIN_GAIN = 0.001;

/** Detune amount for the second oscillator (cents). */
const CHORUS_DETUNE = 7;



// ── Types ───────────────────────────────────────────────────────────

/** A single playback event: one or more MIDI notes at a point in time. */
interface PlayEvent {
	/** Offset from the start of playback (seconds). */
	time: number;
	/** Duration of the notes (seconds). */
	duration: number;
	/** MIDI note numbers to play simultaneously. */
	midiNotes: number[];
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Build a timeline of PlayEvents from a VexTab source string.
 * Uses the tempo from the source if present, otherwise the provided bpm.
 */
export function buildTimeline(source: string, bpm?: number): PlayEvent[] {
	const result = parseVexTabSource(source);
	return stavesToTimeline(result.staves, bpm ?? result.tempo);
}

/**
 * Build a timeline from an array of Stave objects.
 * If staveIndices is provided, only those staves are included.
 */
export function buildTimelineFromStaves(
	staves: Stave[],
	bpm = DEFAULT_BPM,
	staveIndices?: number[],
): PlayEvent[] {
	const selected = staveIndices
		? staveIndices.map((i) => staves[i]!).filter(Boolean)
		: staves;
	return stavesToTimeline(selected, bpm);
}

/**
 * Play a VexTab source string through the Web Audio API.
 * Returns a stop function that cancels playback.
 */
export function playVexTab(source: string, bpm = DEFAULT_BPM): () => void {
	const timeline = buildTimeline(source, bpm);
	return schedulePlayback(timeline);
}

/**
 * Play specific staves through the Web Audio API.
 * Returns a stop function that cancels playback.
 */
export function playStaves(
	staves: Stave[],
	bpm = DEFAULT_BPM,
	staveIndices?: number[],
): () => void {
	const timeline = buildTimelineFromStaves(staves, bpm, staveIndices);
	return schedulePlayback(timeline);
}

// ── Timeline construction ───────────────────────────────────────────

function stavesToTimeline(staves: Stave[], bpm: number): PlayEvent[] {
	const events: PlayEvent[] = [];
	let currentTime = 0;

	for (const stave of staves) {
		for (const entry of stave.entries) {
			if (isBarline(entry)) continue;

			const col = entry as TabColumn;
			const durationSec = durationToSeconds(col.duration, col.dotted, bpm);
			const midiNotes = columnToMidi(col);

			if (midiNotes.length > 0) {
				events.push({
					time: currentTime,
					duration: durationSec,
					midiNotes,
				});
			}

			// Advance time even for rests (no midiNotes).
			currentTime += durationSec;
		}
	}

	return events;
}

function columnToMidi(col: TabColumn): number[] {
	const notes: number[] = [];
	for (let s = 0; s < STRING_COUNT; s++) {
		const fret = col.frets[s];
		if (fret !== null && fret !== undefined) {
			const openStringMidi = STANDARD_TUNING_MIDI[s];
			if (openStringMidi !== undefined) {
				notes.push(openStringMidi + fret);
			}
		}
	}
	return notes;
}

function durationToSeconds(duration: DurationId, dotted: boolean, bpm: number): number {
	const divisor = DURATION_DIVISORS[duration] ?? DURATION_DIVISORS['q'];
	const base = (BEATS_PER_WHOLE / divisor) * (SECONDS_PER_MINUTE / bpm);
	return dotted ? base * DOT_MULTIPLIER : base;
}

// ── Web Audio synthesis ─────────────────────────────────────────────

function midiToFrequency(midi: number): number {
	return FREQ_A4 * Math.pow(2, (midi - MIDI_A4) / SEMITONES_PER_OCTAVE);
}

function schedulePlayback(events: PlayEvent[]): () => void {
	const ctx = new AudioContext();
	const allNodes: AudioScheduledSourceNode[] = [];

	for (const event of events) {
		for (const midi of event.midiNotes) {
			const nodes = scheduleNote(ctx, midi, event.time, event.duration);
			allNodes.push(...nodes);
		}
	}

	// Return a stop function.
	return () => {
		for (const node of allNodes) {
			try { node.stop(); } catch { /* already stopped */ }
		}
		ctx.close();
	};
}

/**
 * Schedule a single plucked-string note.
 * Uses two detuned oscillators for a richer tone.
 */
function scheduleNote(
	ctx: AudioContext,
	midi: number,
	startOffset: number,
	duration: number,
): AudioScheduledSourceNode[] {
	const freq = midiToFrequency(midi);
	const start = ctx.currentTime + startOffset;
	const end = start + duration;

	const gain = ctx.createGain();
	gain.connect(ctx.destination);

	// Pluck envelope.
	gain.gain.setValueAtTime(0, start);
	gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_TIME);
	gain.gain.exponentialRampToValueAtTime(SUSTAIN_LEVEL, start + ATTACK_TIME + DECAY_TIME);

	// Hold sustain, then release.
	const releaseStart = Math.max(start + ATTACK_TIME + DECAY_TIME, end - RELEASE_TIME);
	gain.gain.setValueAtTime(SUSTAIN_LEVEL, releaseStart);
	gain.gain.exponentialRampToValueAtTime(MIN_GAIN, end);

	// Oscillator 1: warm fundamental.
	const osc1 = ctx.createOscillator();
	osc1.type = 'triangle';
	osc1.frequency.value = freq;
	osc1.connect(gain);
	osc1.start(start);
	osc1.stop(end);

	// Oscillator 2: harmonic brightness with slight detuning.
	const osc2 = ctx.createOscillator();
	osc2.type = 'sawtooth';
	osc2.frequency.value = freq;
	osc2.detune.value = CHORUS_DETUNE;

	// Lower volume for osc2 so it doesn't dominate.
	const osc2Gain = ctx.createGain();
	osc2Gain.gain.value = 0.3;
	osc2.connect(osc2Gain);
	osc2Gain.connect(gain);
	osc2.start(start);
	osc2.stop(end);

	return [osc1, osc2];
}
