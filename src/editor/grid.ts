import {
	type GridEntry, type TabColumn, type DurationId, type FretValue,
	STRING_COUNT, STRING_LABELS, MAX_FRET, DURATIONS,
	isBarline, emptyColumn,
} from './types';

/** CSS class prefix for all grid elements. */
const GRID_PREFIX = 'tab-grid';

/** Layout constants (px). */
const STRING_GAP = 24;
const COLUMN_WIDTH = 40;
const BARLINE_WIDTH = 16;
const LABEL_WIDTH = 28;
const TOP_PADDING = 8;
const BOTTOM_PADDING = 8;

/** Total grid height based on string count. */
const GRID_HEIGHT = TOP_PADDING + (STRING_COUNT - 1) * STRING_GAP + BOTTOM_PADDING;

/** Callback signatures for grid events. */
export interface GridCallbacks {
	onChange: () => void;
}

/**
 * Renders an interactive tablature grid into the given container element.
 * Returns an API object for reading/modifying the grid state.
 */
export function createGrid(
	container: HTMLElement,
	initialEntries: GridEntry[],
	activeDuration: () => DurationId,
	callbacks: GridCallbacks,
) {
	let entries: GridEntry[] = [...initialEntries];

	// Ensure at least one empty column to start.
	if (entries.length === 0) {
		entries.push(emptyColumn(activeDuration()));
	}

	const gridEl = container.createDiv({ cls: GRID_PREFIX });
	let activeInput: HTMLInputElement | null = null;
	let dragSourceIdx: number | null = null;

	/** Full re-render of the grid. */
	function render() {
		commitActiveInput();
		gridEl.empty();

		// String labels column.
		const labelsCol = gridEl.createDiv({ cls: `${GRID_PREFIX}-labels` });
		labelsCol.style.width = `${LABEL_WIDTH}px`;
		labelsCol.style.height = `${GRID_HEIGHT}px`;
		for (let s = 0; s < STRING_COUNT; s++) {
			const label = labelsCol.createDiv({ cls: `${GRID_PREFIX}-label` });
			label.style.top = `${TOP_PADDING + s * STRING_GAP}px`;
			label.textContent = STRING_LABELS[s] ?? '';
		}

		// Entry columns.
		for (let colIdx = 0; colIdx < entries.length; colIdx++) {
			const entry = entries[colIdx]!;
			if (isBarline(entry)) {
				renderBarline(gridEl, colIdx);
			} else {
				renderColumn(gridEl, colIdx, entry as TabColumn);
			}
		}

		// "Add column" button at the end.
		const addBtn = gridEl.createDiv({ cls: `${GRID_PREFIX}-add` });
		addBtn.style.height = `${GRID_HEIGHT}px`;
		addBtn.textContent = '+';
		addBtn.title = 'Add note column';
		addBtn.addEventListener('click', () => {
			entries.push(emptyColumn(activeDuration()));
			render();
			callbacks.onChange();
		});
	}

	/** Render a single note column. */
	function renderColumn(parent: HTMLElement, colIdx: number, col: TabColumn) {
		const colEl = parent.createDiv({ cls: `${GRID_PREFIX}-col` });
		colEl.style.width = `${COLUMN_WIDTH}px`;
		colEl.style.height = `${GRID_HEIGHT}px`;
		colEl.dataset.col = String(colIdx);
		makeDraggable(colEl, colIdx);

		// Duration indicator at the top — click to open a dropdown selector.
		const durEl = colEl.createDiv({ cls: `${GRID_PREFIX}-duration` });
		durEl.textContent = col.duration + (col.dotted ? '.' : '');
		durEl.title = 'Click to change duration';
		durEl.addEventListener('click', (e) => {
			e.stopPropagation();
			openDurationSelector(durEl, col, colIdx);
		});

		// String lines and fret slots.
		for (let s = 0; s < STRING_COUNT; s++) {
			// Horizontal line segment.
			const line = colEl.createDiv({ cls: `${GRID_PREFIX}-line` });
			line.style.top = `${TOP_PADDING + s * STRING_GAP}px`;

			// Clickable fret slot.
			const slot = colEl.createDiv({ cls: `${GRID_PREFIX}-slot` });
			slot.style.top = `${TOP_PADDING + s * STRING_GAP}px`;
			slot.dataset.string = String(s);

			if (col.frets[s] !== null) {
				slot.textContent = String(col.frets[s]);
				slot.classList.add(`${GRID_PREFIX}-slot-filled`);
			} else {
				slot.textContent = '–';
			}

			slot.addEventListener('click', (e) => {
				e.stopPropagation();
				openInput(colIdx, s, slot);
			});
		}

		// Column actions button (delete / subdivide).
		const actBtn = colEl.createDiv({ cls: `${GRID_PREFIX}-actions-btn` });
		actBtn.textContent = '···';
		actBtn.title = 'Column actions';
		actBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openColumnActions(actBtn, colIdx, col);
		});
	}

	/** Render a barline separator. */
	function renderBarline(parent: HTMLElement, colIdx: number) {
		const barEl = parent.createDiv({ cls: `${GRID_PREFIX}-barline` });
		barEl.style.width = `${BARLINE_WIDTH}px`;
		barEl.style.height = `${GRID_HEIGHT}px`;
		makeDraggable(barEl, colIdx);

		// Vertical line.
		const lineEl = barEl.createDiv({ cls: `${GRID_PREFIX}-barline-line` });
		lineEl.style.top = `${TOP_PADDING}px`;
		lineEl.style.height = `${(STRING_COUNT - 1) * STRING_GAP}px`;

		// Click barline to remove it.
		barEl.title = 'Click to remove barline';
		barEl.addEventListener('click', () => {
			entries.splice(colIdx, 1);
			render();
			callbacks.onChange();
		});
	}

	/**
	 * Map from a duration to its half-value subdivision.
	 * e.g. a quarter note subdivides into eighth notes.
	 */
	const SUBDIVISIONS: Record<string, DurationId | undefined> = {
		'w': 'h', 'h': 'q', 'q': '8', '8': '16', '16': '32',
	};

	/** Return the available subdivision options for a given duration. */
	function getSubdivisionOptions(duration: DurationId): { count: number; subDuration: DurationId; label: string }[] {
		const options: { count: number; subDuration: DurationId; label: string }[] = [];
		let current: DurationId | undefined = duration;
		let multiplier = 1;

		while (current && SUBDIVISIONS[current]) {
			multiplier *= 2;
			current = SUBDIVISIONS[current];
			if (current) {
				const durLabel = DURATIONS.find((d) => d.id === current)?.label ?? current;
				options.push({ count: multiplier, subDuration: current, label: `Split into ${multiplier}× ${durLabel}` });
			}
		}
		return options;
	}

	/** Open a dropdown with delete and subdivide options. */
	function openColumnActions(anchorEl: HTMLElement, colIdx: number, col: TabColumn) {
		// Close any existing dropdown.
		gridEl.querySelector(`.${GRID_PREFIX}-actions-dropdown`)?.remove();

		const dropdown = document.createElement('div');
		dropdown.className = `${GRID_PREFIX}-actions-dropdown`;

		const rect = anchorEl.getBoundingClientRect();
		const gridRect = gridEl.getBoundingClientRect();
		dropdown.style.left = `${rect.left - gridRect.left}px`;
		// Position above the anchor so it doesn't get clipped by the container.
		dropdown.style.bottom = `${gridRect.bottom - rect.top + 2}px`;

		// Delete option.
		const delOption = document.createElement('div');
		delOption.className = `${GRID_PREFIX}-action-option ${GRID_PREFIX}-action-delete`;
		delOption.textContent = 'Delete';
		delOption.addEventListener('click', (e) => {
			e.stopPropagation();
			dropdown.remove();
			entries.splice(colIdx, 1);
			if (entries.length === 0) {
				entries.push(emptyColumn(activeDuration()));
			}
			render();
			callbacks.onChange();
		});
		dropdown.appendChild(delOption);

		// Subdivision options.
		const subdivisions = getSubdivisionOptions(col.duration);
		for (const sub of subdivisions) {
			const option = document.createElement('div');
			option.className = `${GRID_PREFIX}-action-option`;
			option.textContent = sub.label;
			option.addEventListener('click', (e) => {
				e.stopPropagation();
				dropdown.remove();

				// Replace this column with `count` copies at the subdivided duration.
				// The first copy keeps the original fret values; the rest are empty.
				const newColumns: TabColumn[] = [];
				const first = emptyColumn(sub.subDuration);
				first.frets = [...col.frets];
				newColumns.push(first);
				for (let i = 1; i < sub.count; i++) {
					newColumns.push(emptyColumn(sub.subDuration));
				}
				entries.splice(colIdx, 1, ...newColumns);
				render();
				callbacks.onChange();
			});
			dropdown.appendChild(option);
		}

		gridEl.appendChild(dropdown);

		const closeHandler = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node)) {
				dropdown.remove();
				document.removeEventListener('click', closeHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
	}

	/** Attach drag-and-drop reordering handlers to a column/barline element. */
	function makeDraggable(el: HTMLElement, colIdx: number) {
		el.draggable = true;

		el.addEventListener('dragstart', (e) => {
			dragSourceIdx = colIdx;
			el.classList.add(`${GRID_PREFIX}-dragging`);
			e.dataTransfer?.setData('text/plain', String(colIdx));
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		el.addEventListener('dragend', () => {
			dragSourceIdx = null;
			el.classList.remove(`${GRID_PREFIX}-dragging`);
			gridEl.querySelectorAll(`.${GRID_PREFIX}-drop-before, .${GRID_PREFIX}-drop-after`)
				.forEach((d) => { d.classList.remove(`${GRID_PREFIX}-drop-before`, `${GRID_PREFIX}-drop-after`); });
		});

		el.addEventListener('dragover', (e) => {
			if (dragSourceIdx === null || dragSourceIdx === colIdx) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

			// Show indicator on left or right half.
			const rect = el.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			const isLeft = e.clientX < midX;
			el.classList.toggle(`${GRID_PREFIX}-drop-before`, isLeft);
			el.classList.toggle(`${GRID_PREFIX}-drop-after`, !isLeft);
		});

		el.addEventListener('dragleave', () => {
			el.classList.remove(`${GRID_PREFIX}-drop-before`, `${GRID_PREFIX}-drop-after`);
		});

		el.addEventListener('drop', (e) => {
			e.preventDefault();
			el.classList.remove(`${GRID_PREFIX}-drop-before`, `${GRID_PREFIX}-drop-after`);
			if (dragSourceIdx === null || dragSourceIdx === colIdx) return;

			const rect = el.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			const dropBefore = e.clientX < midX;

			// Remove the dragged entry.
			const moved = entries.splice(dragSourceIdx, 1)[0]!;

			// Find the new insertion index (adjusted for removal).
			let targetIdx = colIdx;
			if (dragSourceIdx < colIdx) targetIdx--;
			if (!dropBefore) targetIdx++;

			entries.splice(targetIdx, 0, moved);
			dragSourceIdx = null;
			render();
			callbacks.onChange();
		});
	}

	/** Open a dropdown selector for the column's duration. */
	function openDurationSelector(anchorEl: HTMLElement, col: TabColumn, colIdx: number) {
		// Close any existing dropdown.
		gridEl.querySelector(`.${GRID_PREFIX}-dur-dropdown`)?.remove();

		const dropdown = document.createElement('div');
		dropdown.className = `${GRID_PREFIX}-dur-dropdown`;

		// Position below the anchor element.
		const rect = anchorEl.getBoundingClientRect();
		const gridRect = gridEl.getBoundingClientRect();
		dropdown.style.left = `${rect.left - gridRect.left}px`;
		dropdown.style.top = `${rect.bottom - gridRect.top + 2}px`;

		// Duration options.
		for (const dur of DURATIONS) {
			const option = document.createElement('div');
			option.className = `${GRID_PREFIX}-dur-option`;
			if (dur.id === col.duration) {
				option.classList.add(`${GRID_PREFIX}-dur-option-active`);
			}
			option.textContent = dur.label;
			option.addEventListener('click', (e) => {
				e.stopPropagation();
				col.duration = dur.id;
				dropdown.remove();
				render();
				callbacks.onChange();
			});
			dropdown.appendChild(option);
		}

		// Separator.
		const sep = document.createElement('div');
		sep.className = `${GRID_PREFIX}-dur-separator`;
		dropdown.appendChild(sep);

		// Dotted toggle.
		const dotOption = document.createElement('div');
		dotOption.className = `${GRID_PREFIX}-dur-option ${GRID_PREFIX}-dur-dot-toggle`;
		if (col.dotted) {
			dotOption.classList.add(`${GRID_PREFIX}-dur-option-active`);
		}
		dotOption.textContent = 'Dotted';
		dotOption.addEventListener('click', (e) => {
			e.stopPropagation();
			col.dotted = !col.dotted;
			dropdown.remove();
			render();
			callbacks.onChange();
		});
		dropdown.appendChild(dotOption);

		gridEl.appendChild(dropdown);

		const closeHandler = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node)) {
				dropdown.remove();
				document.removeEventListener('click', closeHandler, true);
			}
		};
		setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
	}

	/** Open an inline input on a fret slot. */
	function openInput(colIdx: number, stringIdx: number, slotEl: HTMLElement) {
		commitActiveInput();

		const entry = entries[colIdx]!;
		if (!entry || isBarline(entry)) return;
		const col = entry as TabColumn;

		const input = document.createElement('input');
		input.type = 'text';
		input.className = `${GRID_PREFIX}-input`;
		input.value = col.frets[stringIdx] !== null ? String(col.frets[stringIdx]) : '';
		input.maxLength = 2;
		input.style.top = slotEl.style.top;

		const parentCol = slotEl.parentElement;
		if (!parentCol) return;
		parentCol.appendChild(input);
		input.focus();
		input.select();

		activeInput = input;
		(input as any).__colIdx = colIdx;
		(input as any).__stringIdx = stringIdx;

		const commit = () => {
			if (activeInput !== input) return;
			const val = input.value.trim();
			if (val === '' || val === '–') {
				col.frets[stringIdx] = null;
			} else {
				const num = parseInt(val, 10);
				if (!isNaN(num) && num >= 0 && num <= MAX_FRET) {
					col.frets[stringIdx] = num;
				}
			}
			activeInput = null;
			render();
			callbacks.onChange();
		};

		input.addEventListener('blur', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				activeInput = null;
				render();
			}
		});
	}

	/** Commit any currently active input before re-rendering. */
	function commitActiveInput() {
		if (!activeInput) return;
		const input = activeInput;
		const colIdx = (input as any).__colIdx as number;
		const stringIdx = (input as any).__stringIdx as number;
		const entry = entries[colIdx]!;
		if (entry != null && !isBarline(entry)) {
			const val = input.value.trim();
			if (val === '' || val === '–') {
				entry.frets[stringIdx] = null;
			} else {
				const num = parseInt(val, 10);
				if (!isNaN(num) && num >= 0 && num <= MAX_FRET) {
					entry.frets[stringIdx] = num;
				}
			}
		}
		activeInput = null;
	}

	// Initial render.
	render();

	return {
		getEntries: () => entries,
		setEntries: (newEntries: GridEntry[]) => {
			entries = [...newEntries];
			if (entries.length === 0) {
				entries.push(emptyColumn(activeDuration()));
			}
			render();
		},
		addBarline: () => {
			entries.push({ type: 'barline' });
			entries.push(emptyColumn(activeDuration()));
			render();
			callbacks.onChange();
		},
		render,
		destroy: () => {
			gridEl.remove();
		},
	};
}
