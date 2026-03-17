import {
	type GridEntry, type TabColumn, type DurationId, type Stave,
	isBarline,
} from './types';

/**
 * Serialize an array of staves into a complete VexTab source string.
 */
export function serializeStaves(staves: Stave[]): string {
	return staves.map(serializeStave).join('\n\n');
}

/**
 * Serialize a single stave (header + notes).
 */
function serializeStave(stave: Stave): string {
	const opts = stave.options;
	const staveOpts = [
		`notation=${opts.notation}`,
		`tablature=${opts.tablature}`,
	];
	if (opts.time) {
		staveOpts.push(`time=${opts.time}`);
	}

	const header = `tabstave ${staveOpts.join(' ')}`;
	const noteStr = serializeNotes(stave.entries);

	if (noteStr.length === 0) {
		return header;
	}
	return `${header}\nnotes ${noteStr}`;
}

/**
 * Serialize grid entries into the `notes` portion of VexTab.
 *
 * Consecutive single notes on the same string with the same duration
 * are collapsed into chained notation (e.g. `0-0-2-0/1`).
 */
function serializeNotes(entries: GridEntry[]): string {
	const parts: string[] = [];
	let prevKey: DurationKey | null = null;
	let i = 0;

	while (i < entries.length) {
		const entry = entries[i]!;

		if (isBarline(entry)) {
			parts.push('|');
			i++;
			continue;
		}

		const col = entry as TabColumn;
		const nonNull = getNonNullFrets(col);
		const key = durationKey(col.duration, col.dotted);

		if (nonNull.length === 0) {
			const prefix = buildDurationPrefix(col.duration, col.dotted, prevKey);
			prevKey = key;
			parts.push(`${prefix}##`);
			i++;
			continue;
		}

		if (nonNull.length === 1) {
			const chainResult = collectChain(entries, i);
			const prefix = buildDurationPrefix(col.duration, col.dotted, prevKey);
			prevKey = key;

			if (chainResult.frets.length > 1) {
				parts.push(`${prefix}${chainResult.frets.join('-')}/${chainResult.vextabString}`);
				i += chainResult.frets.length;
			} else {
				parts.push(`${prefix}${nonNull[0]!.fret}/${nonNull[0]!.stringIdx + 1}`);
				i++;
			}
			continue;
		}

		// Chord.
		const prefix = buildDurationPrefix(col.duration, col.dotted, prevKey);
		prevKey = key;
		const chordParts = nonNull.map(({ fret, stringIdx }) => `${fret}/${stringIdx + 1}`);
		parts.push(`${prefix}(${chordParts.join('.')})`);
		i++;
	}

	return parts.join(' ');
}

function getNonNullFrets(col: TabColumn) {
	return col.frets
		.map((fret, stringIdx) => ({ fret, stringIdx }))
		.filter((s): s is { fret: number; stringIdx: number } => s.fret !== null);
}

function collectChain(
	entries: GridEntry[],
	startIdx: number,
): { frets: number[]; vextabString: number } {
	const first = entries[startIdx]! as TabColumn;
	const firstNonNull = getNonNullFrets(first);
	if (firstNonNull.length !== 1) return { frets: [], vextabString: 0 };

	const targetString = firstNonNull[0]!.stringIdx;
	const targetDuration = first.duration;
	const targetDotted = first.dotted;
	const frets: number[] = [firstNonNull[0]!.fret];

	for (let j = startIdx + 1; j < entries.length; j++) {
		const entry = entries[j]!;
		if (isBarline(entry)) break;
		const col = entry as TabColumn;
		if (col.duration !== targetDuration || col.dotted !== targetDotted) break;
		const nonNull = getNonNullFrets(col);
		if (nonNull.length !== 1) break;
		if (nonNull[0]!.stringIdx !== targetString) break;
		frets.push(nonNull[0]!.fret);
	}

	return { frets, vextabString: targetString + 1 };
}

/** A full duration key combines the base duration with the dotted flag. */
type DurationKey = string; // e.g. "q", "qd"

function durationKey(duration: DurationId, dotted: boolean): DurationKey {
	return dotted ? `${duration}d` : duration;
}

function buildDurationPrefix(
	duration: DurationId,
	dotted: boolean,
	previousKey: DurationKey | null,
): string {
	const key = durationKey(duration, dotted);
	if (key === previousKey) return '';
	return `:${key} `;
}
