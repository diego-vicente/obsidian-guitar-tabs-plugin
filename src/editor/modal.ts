import { App, Modal } from 'obsidian';
import { VexTab, Artist, Vex } from 'vextab';
import {
	type DurationId, type Stave,
	DURATIONS, DEFAULT_DURATION, DEFAULT_BPM,
	emptyStave, TIME_SIGNATURES, DEFAULT_TIME_SIGNATURE,
} from './types';
import { createGrid } from './grid';
import { serializeStaves } from './serializer';
import { parseVexTabSource } from './parser';
import { playStaves } from '../playback';

const Renderer = Vex.Flow.Renderer;

/** Render width matching the main plugin renderer. */
const RENDER_WIDTH = 687;
const ARTIST_X = 10;
const ARTIST_Y = 10;

/** BPM limits for the tempo slider. */
const MIN_BPM = 40;
const MAX_BPM = 240;
const BPM_STEP = 5;

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
	private tempo = DEFAULT_BPM;

	private staveNavEl: HTMLElement;
	private gridContainerEl: HTMLElement;
	private previewEl: HTMLElement;
	private codeEl: HTMLElement;
	private grid: ReturnType<typeof createGrid>;
	private stopPlayback: (() => void) | null = null;
	private activePlayBtn: HTMLButtonElement | null = null;
	private activePlayLabel = '';
	private playStaveBtn: HTMLButtonElement;

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
			const result = parseVexTabSource(this.initialSource);
			this.staves = result.staves;
			this.tempo = result.tempo;
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

		// ── Tempo control ────────────────────────────────────────
		const tempoGroup = toolbar.createDiv({ cls: 'tab-editor-tempo-group' });
		tempoGroup.createEl('span', { text: 'Tempo:', cls: 'tab-editor-tempo-label' });
		const tempoValue = tempoGroup.createEl('span', {
			text: `${this.tempo}`,
			cls: 'tab-editor-tempo-value',
		});
		const tempoSlider = tempoGroup.createEl('input', { cls: 'tab-editor-tempo-slider' });
		tempoSlider.type = 'range';
		tempoSlider.min = String(MIN_BPM);
		tempoSlider.max = String(MAX_BPM);
		tempoSlider.step = String(BPM_STEP);
		tempoSlider.value = String(this.tempo);
		tempoSlider.addEventListener('input', () => {
			this.tempo = parseInt(tempoSlider.value, 10);
			tempoValue.textContent = String(this.tempo);
			this.updatePreview();
		});

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

		// Playback buttons with speed variants.
		const playGroup = actions.createDiv({ cls: 'tab-editor-play-group' });

		const SPEED_VARIANTS = [
			{ label: '\u25B6 \u00D70.5', speed: 0.5 },
			{ label: '\u25B6 \u00D70.75', speed: 0.75 },
			{ label: '\u25B6 Play', speed: 1.0 },
		];

		for (const variant of SPEED_VARIANTS) {
			const btn = playGroup.createEl('button', { text: variant.label });
			btn.addEventListener('click', () => {
				this.togglePlayback(btn, variant.label, undefined, variant.speed);
			});
		}

		// Spacer pushes insert/cancel to the right.
		const spacer = actions.createDiv({ cls: 'tab-editor-actions-spacer' });

		const insertBtn = actions.createEl('button', { text: 'Insert', cls: 'mod-cta' });
		insertBtn.addEventListener('click', () => {
			this.syncGridToStave();
			this.onInsert(serializeStaves(this.staves, this.tempo));
			this.close();
		});
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.updatePreview();
	}

	onClose() {
		if (this.stopPlayback) {
			this.stopPlayback();
			this.stopPlayback = null;
		}
		this.contentEl.empty();
	}

	// ── Playback ────────────────────────────────────────────────

	private togglePlayback(
		btn: HTMLButtonElement,
		originalLabel: string,
		staveIndices?: number[],
		speed = 1.0,
	) {
		// If already playing, stop.
		if (this.stopPlayback) {
			this.stopPlayback();
			this.stopPlayback = null;
			if (this.activePlayBtn) {
				this.activePlayBtn.textContent = this.activePlayLabel;
			}
			this.activePlayBtn = null;
			return;
		}

		this.syncGridToStave();

		// Stop any other playback and update the button.
		this.activePlayBtn = btn;
		this.activePlayLabel = originalLabel;
		btn.textContent = '\u25A0 Stop';

		const effectiveBpm = Math.round(this.tempo * speed);
		const stop = playStaves(this.staves, effectiveBpm, staveIndices);
		this.stopPlayback = () => {
			stop();
			this.stopPlayback = null;
			btn.textContent = originalLabel;
			this.activePlayBtn = null;
		};
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

		// Play stave button.
		const PLAY_STAVE_LABEL = '\u25B6 Play stave';
		this.playStaveBtn = this.staveNavEl.createEl('button', { text: PLAY_STAVE_LABEL, cls: 'tab-editor-nav-btn' });
		this.playStaveBtn.addEventListener('click', () => {
			this.togglePlayback(this.playStaveBtn, PLAY_STAVE_LABEL, [this.activeStaveIdx]);
		});

		// Stave management buttons.
		const addBtn = this.staveNavEl.createEl('button', { text: 'New stave', cls: 'tab-editor-nav-add' });
		addBtn.addEventListener('click', () => {
			this.syncGridToStave();
			const prevTime = this.staves[this.activeStaveIdx]?.options.time ?? DEFAULT_TIME_SIGNATURE;
			const newStave = emptyStave(this.activeDuration);
			newStave.options.time = prevTime;
			this.staves.push(newStave);
			this.switchStave(this.staves.length - 1);
		});

		const delBtn = this.staveNavEl.createEl('button', { text: 'Delete stave', cls: 'tab-editor-nav-del' });
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
		const source = serializeStaves(this.staves, this.tempo);
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
