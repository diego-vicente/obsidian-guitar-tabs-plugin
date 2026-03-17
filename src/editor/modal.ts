import { App, Modal } from 'obsidian';
import { VexTab, Artist, Vex } from 'vextab';
import {
	type DurationId, type Stave,
	DURATIONS, DEFAULT_DURATION,
	emptyStave, TIME_SIGNATURES, DEFAULT_TIME_SIGNATURE,
} from './types';
import { createGrid } from './grid';
import { serializeStaves } from './serializer';
import { parseVexTabSource } from './parser';

const Renderer = Vex.Flow.Renderer;

/** Render width matching the main plugin renderer. */
const RENDER_WIDTH = 687;
const ARTIST_X = 10;
const ARTIST_Y = 10;

/**
 * Modal that presents a clickable tablature grid with multi-stave
 * navigation, a duration toolbar, a live VexTab preview, and a code
 * view of the generated source.
 */
export class TabEditorModal extends Modal {
	private onInsert: (vextabSource: string) => void;
	private initialSource: string;
	private activeDuration: DurationId = DEFAULT_DURATION;

	private staves: Stave[] = [];
	private activeStaveIdx = 0;

	private staveNavEl: HTMLElement;
	private gridContainerEl: HTMLElement;
	private previewEl: HTMLElement;
	private codeEl: HTMLElement;
	private grid: ReturnType<typeof createGrid>;

	constructor(
		app: App,
		onInsert: (vextabSource: string) => void,
		initialSource = '',
	) {
		super(app);
		this.onInsert = onInsert;
		this.initialSource = initialSource;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tab-editor-modal');

		// Parse initial source into staves.
		if (this.initialSource.trim()) {
			this.staves = parseVexTabSource(this.initialSource);
		} else {
			this.staves = [emptyStave(this.activeDuration)];
		}
		this.activeStaveIdx = 0;

		// ── Toolbar ──────────────────────────────────────────────
		const toolbar = contentEl.createDiv({ cls: 'tab-editor-toolbar' });

		const durGroup = toolbar.createDiv({ cls: 'tab-editor-dur-group' });
		durGroup.createEl('span', { text: 'Duration:', cls: 'tab-editor-dur-label' });

		for (const dur of DURATIONS) {
			const btn = durGroup.createEl('button', { text: dur.label });
			btn.addClass('tab-editor-dur-btn');
			if (dur.id === this.activeDuration) btn.addClass('tab-editor-dur-active');
			btn.addEventListener('click', () => {
				this.activeDuration = dur.id;
				durGroup.querySelectorAll('.tab-editor-dur-btn').forEach((b) =>
					b.classList.remove('tab-editor-dur-active'),
				);
				btn.classList.add('tab-editor-dur-active');
			});
		}

		const barBtn = toolbar.createEl('button', { text: '| Barline', cls: 'tab-editor-bar-btn' });
		barBtn.addEventListener('click', () => this.grid.addBarline());

		// ── Stave navigation ─────────────────────────────────────
		this.staveNavEl = contentEl.createDiv({ cls: 'tab-editor-stave-nav' });
		this.renderStaveNav();

		// ── Grid ─────────────────────────────────────────────────
		this.gridContainerEl = contentEl.createDiv({ cls: 'tab-editor-grid-container' });
		this.mountGrid();

		// ── Preview ──────────────────────────────────────────────
		contentEl.createEl('h4', { text: 'Preview', cls: 'tab-editor-section-label' });
		this.previewEl = contentEl.createDiv({ cls: 'tab-editor-preview' });

		// ── Code view ────────────────────────────────────────────
		contentEl.createEl('h4', { text: 'VexTab code', cls: 'tab-editor-section-label' });
		this.codeEl = contentEl.createEl('pre', { cls: 'tab-editor-code' });

		// ── Action buttons ───────────────────────────────────────
		const actions = contentEl.createDiv({ cls: 'tab-editor-actions' });
		const insertBtn = actions.createEl('button', { text: 'Insert', cls: 'mod-cta' });
		insertBtn.addEventListener('click', () => {
			this.syncGridToStave();
			this.onInsert(serializeStaves(this.staves));
			this.close();
		});
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.updatePreview();
	}

	onClose() {
		this.contentEl.empty();
	}

	// ── Stave navigation ────────────────────────────────────────

	private renderStaveNav() {
		this.staveNavEl.empty();

		const prevBtn = this.staveNavEl.createEl('button', { text: '\u25C0', cls: 'tab-editor-nav-btn' });
		prevBtn.disabled = this.activeStaveIdx === 0;
		prevBtn.addEventListener('click', () => this.switchStave(this.activeStaveIdx - 1));

		this.staveNavEl.createEl('span', {
			text: `Stave ${this.activeStaveIdx + 1} / ${this.staves.length}`,
			cls: 'tab-editor-nav-label',
		});

		const nextBtn = this.staveNavEl.createEl('button', { text: '\u25B6', cls: 'tab-editor-nav-btn' });
		nextBtn.disabled = this.activeStaveIdx === this.staves.length - 1;
		nextBtn.addEventListener('click', () => this.switchStave(this.activeStaveIdx + 1));

		// Time signature selector.
		const currentStave = this.staves[this.activeStaveIdx]!;
		const timeGroup = this.staveNavEl.createDiv({ cls: 'tab-editor-time-group' });
		timeGroup.createEl('span', { text: 'Time:', cls: 'tab-editor-time-label' });
		const timeSelect = timeGroup.createEl('select', { cls: 'tab-editor-time-select' });
		for (const ts of TIME_SIGNATURES) {
			const opt = timeSelect.createEl('option', { text: ts, value: ts });
			if (currentStave.options.time === ts) opt.selected = true;
		}
		timeSelect.addEventListener('change', () => {
			currentStave.options.time = timeSelect.value;
			this.updatePreview();
		});

		// Stave management buttons.
		const addBtn = this.staveNavEl.createEl('button', { text: '+ Stave', cls: 'tab-editor-nav-add' });
		addBtn.addEventListener('click', () => {
			this.syncGridToStave();
			// Inherit time signature from the current stave.
			const prevTime = this.staves[this.activeStaveIdx]?.options.time ?? DEFAULT_TIME_SIGNATURE;
			const newStave = emptyStave(this.activeDuration);
			newStave.options.time = prevTime;
			this.staves.push(newStave);
			this.switchStave(this.staves.length - 1);
		});

		const delBtn = this.staveNavEl.createEl('button', { text: '\u2212 Stave', cls: 'tab-editor-nav-del' });
		delBtn.disabled = this.staves.length <= 1;
		delBtn.addEventListener('click', () => {
			if (this.staves.length <= 1) return;
			this.staves.splice(this.activeStaveIdx, 1);
			if (this.activeStaveIdx >= this.staves.length) {
				this.activeStaveIdx = this.staves.length - 1;
			}
			this.renderStaveNav();
			this.mountGrid();
			this.updatePreview();
		});
	}

	private switchStave(newIdx: number) {
		this.syncGridToStave();
		this.activeStaveIdx = newIdx;
		this.renderStaveNav();
		this.mountGrid();
		this.updatePreview();
	}

	/** Copy the current grid entries back into the active stave. */
	private syncGridToStave() {
		const stave = this.staves[this.activeStaveIdx];
		if (stave) {
			stave.entries = this.grid.getEntries();
		}
	}

	// ── Grid management ─────────────────────────────────────────

	private mountGrid() {
		this.gridContainerEl.empty();
		const stave = this.staves[this.activeStaveIdx]!;
		this.grid = createGrid(
			this.gridContainerEl,
			stave.entries,
			() => this.activeDuration,
			{ onChange: () => this.updatePreview() },
		);
	}

	// ── Preview ─────────────────────────────────────────────────

	private updatePreview() {
		this.syncGridToStave();
		const source = serializeStaves(this.staves);
		this.codeEl.textContent = '```vextab\n' + source + '\n```';

		this.previewEl.empty();
		try {
			const renderDiv = this.previewEl.createDiv({ cls: 'tab-editor-preview-render' });
			const artist = new Artist(ARTIST_X, ARTIST_Y, RENDER_WIDTH, { scale: 1.0 });
			Artist.NOLOGO = true;
			const vexTab = new VexTab(artist);
			vexTab.parse(source);
			const renderer = new Renderer(renderDiv, Renderer.Backends.SVG);
			artist.render(renderer);

			const svg = renderDiv.querySelector('svg');
			if (svg) {
				svg.removeAttribute('width');
				svg.removeAttribute('height');
				svg.style.width = '100%';
				svg.style.height = 'auto';
			}
		} catch (e) {
			const errEl = this.previewEl.createDiv({ cls: 'tab-editor-preview-error' });
			errEl.textContent = e instanceof Error ? e.message : String(e);
		}
	}
}
