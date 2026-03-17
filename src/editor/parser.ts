import {
	type GridEntry, type TabColumn, type DurationId, type Stave, type StaveOptions,
	DEFAULT_DURATION, DEFAULT_STAVE_OPTIONS, STRING_COUNT,
	emptyColumn, emptyStave,
} from './types';

/** Pattern that matches a stave option like `key=value`. */
const STAVE_OPTION_RE = /^([a-z]+)=(\S+)$/;

/**
 * Parse a VexTab source string into an array of Stave objects.
 *
 * Each `tabstave` (or `stave`) directive starts a new stave.  Notes that
 * appear before any directive are placed in an implicit first stave.
 */
export function parseVexTabSource(source: string): Stave[] {
	const staves: Stave[] = [];
	let current: Stave | null = null;
	let currentDuration: DurationId = DEFAULT_DURATION;
	let currentDotted = false;

	const lines = source.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') continue;

		// New stave directive.
		if (trimmed.startsWith('tabstave') || trimmed.startsWith('stave')) {
			const opts = parseStaveDirective(trimmed);
			current = { options: opts, entries: [] };
			staves.push(current);
			currentDuration = DEFAULT_DURATION;
			currentDotted = false;
			continue;
		}

		// Skip directives the editor doesn't handle.
		if (
			trimmed.startsWith('options') ||
			trimmed.startsWith('text') ||
			trimmed.startsWith('voice')
		) {
			continue;
		}

		// A line of pure stave options on a continuation line
		// (e.g. "notation=true tablature=true time=4/4").
		if (looksLikeStaveOptions(trimmed)) {
			if (current) {
				applyStaveOptions(trimmed, current.options);
			}
			continue;
		}

		// Ensure we have a stave to put notes into.
		if (!current) {
			current = emptyStave(DEFAULT_DURATION, 0);
			staves.push(current);
		}

		// Strip the leading "notes" keyword if present.
		const noteStr = trimmed.startsWith('notes')
			? trimmed.slice(5).trim()
			: trimmed;

		const tokens = tokenize(noteStr);
		for (const token of tokens) {
			if (token.startsWith(':')) {
				const raw = token.slice(1);
				// Strip trailing 'd' for dotted durations.
				if (raw.endsWith('d')) {
					const baseId = raw.slice(0, -1) as DurationId;
					if (isValidDuration(baseId)) {
						currentDuration = baseId;
						currentDotted = true;
					}
				} else {
					const durId = raw as DurationId;
					if (isValidDuration(durId)) {
						currentDuration = durId;
						currentDotted = false;
					}
				}
				continue;
			}

			if (token === '|' || token === '=||' || token === '=|=' ||
				token === '=:|' || token === '=|:' || token === '=::') {
				current.entries.push({ type: 'barline' });
				continue;
			}

			if (token.startsWith('#')) {
				current.entries.push(emptyColumn(currentDuration, currentDotted));
				continue;
			}

			if (token.startsWith('(') && token.endsWith(')')) {
				const col = emptyColumn(currentDuration, currentDotted);
				const inner = token.slice(1, -1);
				for (const part of inner.split('.')) {
					parseSingleFretString(part, col);
				}
				current.entries.push(col);
				continue;
			}

			if (token.includes('/')) {
				for (const col of expandChainedNotes(token, currentDuration, currentDotted)) {
					current.entries.push(col);
				}
				continue;
			}
		}
	}

	// If no staves were created, return one empty stave.
	if (staves.length === 0) {
		staves.push(emptyStave(DEFAULT_DURATION));
	}

	return staves;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse the `tabstave ...` or `stave ...` directive line. */
function parseStaveDirective(line: string): StaveOptions {
	const opts: StaveOptions = { ...DEFAULT_STAVE_OPTIONS };
	// Remove the leading keyword.
	const rest = line.replace(/^(tabstave|stave)\s*/, '');
	applyStaveOptions(rest, opts);
	return opts;
}

/** Apply key=value pairs from a string to a StaveOptions object. */
function applyStaveOptions(str: string, opts: StaveOptions): void {
	for (const token of str.split(/\s+/)) {
		const match = STAVE_OPTION_RE.exec(token);
		if (!match) continue;
		const key = match[1]!;
		const value = match[2]!;
		if (key === 'notation') opts.notation = value === 'true';
		if (key === 'tablature') opts.tablature = value === 'true';
		if (key === 'time') opts.time = value;
	}
}

function looksLikeStaveOptions(line: string): boolean {
	const tokens = line.split(/\s+/);
	return tokens.length > 0 && tokens.every((t) => STAVE_OPTION_RE.test(t));
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inParens = false;

	for (const ch of input) {
		if (ch === '(') {
			inParens = true;
			current += ch;
		} else if (ch === ')') {
			inParens = false;
			current += ch;
			tokens.push(current.trim());
			current = '';
		} else if (ch === ' ' && !inParens) {
			if (current.trim()) tokens.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim()) tokens.push(current.trim());
	return tokens;
}

function expandChainedNotes(token: string, duration: DurationId, dotted: boolean): TabColumn[] {
	const slashIdx = token.indexOf('/');
	if (slashIdx < 0) return [];

	const fretPart = token.substring(0, slashIdx);
	const stringPart = token.substring(slashIdx + 1);
	const vextabString = parseInt(stringPart, 10);
	if (isNaN(vextabString) || vextabString < 1 || vextabString > STRING_COUNT) return [];

	const stringIdx = vextabString - 1;
	return fretPart.split('-').reduce<TabColumn[]>((cols, fretStr) => {
		const fret = parseInt(fretStr, 10);
		if (!isNaN(fret) && fret >= 0) {
			const col = emptyColumn(duration, dotted);
			col.frets[stringIdx] = fret;
			cols.push(col);
		}
		return cols;
	}, []);
}

function parseSingleFretString(token: string, col: TabColumn): void {
	const slashIdx = token.indexOf('/');
	if (slashIdx < 0) return;
	const fret = parseInt(token.substring(0, slashIdx), 10);
	const vextabString = parseInt(token.substring(slashIdx + 1), 10);
	if (isNaN(fret) || fret < 0) return;
	if (isNaN(vextabString) || vextabString < 1 || vextabString > STRING_COUNT) return;
	col.frets[vextabString - 1] = fret;
}

const VALID_DURATIONS = new Set(['w', 'h', 'q', '8', '16', '32']);
function isValidDuration(id: string): id is DurationId {
	return VALID_DURATIONS.has(id);
}
