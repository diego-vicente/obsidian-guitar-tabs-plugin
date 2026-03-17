/** Number of strings on a standard guitar. */
export const STRING_COUNT = 6;

/** Standard tuning labels, high to low (string 1 = high E). */
export const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];

/** Valid note durations and their VexTab notation. */
export const DURATIONS = [
	{ id: 'w',  label: 'Whole',    vextab: ':w'  },
	{ id: 'h',  label: 'Half',     vextab: ':h'  },
	{ id: 'q',  label: 'Quarter',  vextab: ':q'  },
	{ id: '8',  label: '8th',      vextab: ':8'  },
	{ id: '16', label: '16th',     vextab: ':16' },
	{ id: '32', label: '32nd',     vextab: ':32' },
] as const;

export type DurationId = typeof DURATIONS[number]['id'];

/** Default duration for newly placed notes. */
export const DEFAULT_DURATION: DurationId = 'q';

/** Maximum fret number accepted. */
export const MAX_FRET = 24;

/**
 * A single fret value on a string.  `null` means the string is not played
 * in this column.
 */
export type FretValue = number | null;

/**
 * One vertical column in the tab grid.  Each entry corresponds to a string
 * (index 0 = string 1 / high E).  A column can represent a single note,
 * a chord (multiple non-null entries), or a rest (all null).
 */
export interface TabColumn {
	/** Fret values for each string (length = STRING_COUNT). */
	frets: FretValue[];
	/** Duration of this column. */
	duration: DurationId;
	/** Whether this note is dotted (adds 50% to its duration). */
	dotted: boolean;
}

/** Sentinel column type for barlines. */
export interface BarlineColumn {
	type: 'barline';
}

/** A grid entry is either a note column or a barline. */
export type GridEntry = TabColumn | BarlineColumn;

/** Type guard for barline entries. */
export function isBarline(entry: GridEntry): entry is BarlineColumn {
	return 'type' in entry && entry.type === 'barline';
}

/** Create an empty note column with the given duration. */
export function emptyColumn(duration: DurationId, dotted = false): TabColumn {
	return {
		frets: new Array(STRING_COUNT).fill(null) as FretValue[],
		duration,
		dotted,
	};
}

/** Common time signatures. */
export const TIME_SIGNATURES = [
	'4/4', '3/4', '2/4', '6/8', '2/2', '3/8', '5/4', '7/8', '12/8',
] as const;

export const DEFAULT_TIME_SIGNATURE = '4/4';

/** Default playback tempo in beats per minute. */
export const DEFAULT_BPM = 120;

/**
 * Options carried by each stave (parsed from `tabstave` directives).
 */
export interface StaveOptions {
	notation: boolean;
	tablature: boolean;
	time?: string;
}

export const DEFAULT_STAVE_OPTIONS: StaveOptions = {
	notation: true,
	tablature: true,
	time: DEFAULT_TIME_SIGNATURE,
};

/**
 * A single stave: its options and the grid entries (notes, chords, rests,
 * barlines) it contains.
 */
export interface Stave {
	options: StaveOptions;
	entries: GridEntry[];
}

/** Create a new empty stave with default options and some blank columns. */
export function emptyStave(duration: DurationId, columnCount = 4): Stave {
	const entries: GridEntry[] = [];
	for (let i = 0; i < columnCount; i++) {
		entries.push(emptyColumn(duration));
	}
	return { options: { ...DEFAULT_STAVE_OPTIONS }, entries };
}
