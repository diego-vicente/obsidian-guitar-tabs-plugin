import { App, MarkdownPostProcessorContext } from 'obsidian';
import { VexTab, Artist, Vex } from 'vextab';
import { CSS_PREFIX, type GuitarTabsSettings } from './types';
import { TabEditorModal } from './editor/modal';

const Renderer = Vex.Flow.Renderer;

/** Origin coordinates for the Artist canvas. */
const ARTIST_X = 10;
const ARTIST_Y = 10;

/**
 * Default render width passed to the VexFlow Artist.
 * TODO: expose this as a user-configurable setting in the future.
 */
const RENDER_WIDTH = 687;

/** Extra padding added around the SVG content bounding box. */
const SVG_PADDING = 5;

/**
 * Matches normal printable text: digits, ASCII letters, punctuation, spaces.
 * Music-notation glyphs use Unicode Private Use Area codepoints which will
 * NOT match this pattern.
 */
const READABLE_TEXT_RE = /^[\x20-\x7E]+$/;

/** CSS class applied to SVG text elements that contain human-readable text. */
const READABLE_TEXT_CLASS = `${CSS_PREFIX}-readable-text`;

/** Colors that VexFlow hardcodes and we need to replace. */
const DARK_FILLS = new Set(['black', '#000', '#000000']);
const WHITE_FILLS = new Set(['white', '#fff', '#ffffff', 'ffffff']);

/**
 * Register a markdown code-block post-processor that converts VexTab source
 * into rendered SVG notation.
 */
export function createVexTabProcessor(
	language: string,
	getSettings: () => GuitarTabsSettings,
	app: App,
) {
	return (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		renderVexTab(source, el, getSettings(), app, ctx);
	};
}

/**
 * Parse a VexTab source string and render it as SVG inside the given element.
 */
function renderVexTab(
	source: string,
	container: HTMLElement,
	settings: GuitarTabsSettings,
	app: App,
	ctx: MarkdownPostProcessorContext,
): void {
	const wrapper = container.createDiv({ cls: `${CSS_PREFIX}-container` });

	try {
		const width = settings.width > 0 ? settings.width : RENDER_WIDTH;
		const artist = new Artist(ARTIST_X, ARTIST_Y, width, {
			scale: settings.scale,
		});

		Artist.NOLOGO = true;

		const vexTab = new VexTab(artist);
		vexTab.parse(source);

		const renderDiv = wrapper.createDiv({ cls: `${CSS_PREFIX}-render` });
		const renderer = new Renderer(renderDiv, Renderer.Backends.SVG);
		artist.render(renderer);
		fitSvgToContent(renderDiv);
		applyTextClass(renderDiv);
		applyThemeColors(renderDiv);

		addEditButton(wrapper, source, app, ctx);
	} catch (error) {
		renderError(wrapper, error);
	}
}

/**
 * Add a subtle edit button to the rendered code block.  When clicked,
 * opens the tab editor modal pre-filled with the current source.
 */
function addEditButton(
	wrapper: HTMLElement,
	source: string,
	app: App,
	ctx: MarkdownPostProcessorContext,
): void {
	const btn = wrapper.createDiv({ cls: `${CSS_PREFIX}-edit-btn` });
	btn.textContent = 'Edit';
	btn.setAttribute('aria-label', 'Edit guitar tab');

	btn.addEventListener('click', () => {
		const modal = new TabEditorModal(
			app,
			(newSource: string) => {
				// Find the section info to locate the code block in the file.
				const sectionInfo = ctx.getSectionInfo(wrapper);
				if (!sectionInfo) return;

				const { lineStart, lineEnd } = sectionInfo;
				const file = app.vault.getAbstractFileByPath(sectionInfo.text ? ctx.sourcePath : ctx.sourcePath);
				if (!file) return;

				app.vault.read(file as any).then((content: string) => {
					const lines = content.split('\n');
					// Replace only the content between the code fences.
					const newBlock = '```vextab\n' + newSource + '\n```';
					const before = lines.slice(0, lineStart).join('\n');
					const after = lines.slice(lineEnd + 1).join('\n');
					const newContent = before + (before ? '\n' : '') + newBlock + (after ? '\n' : '') + after;
					app.vault.modify(file as any, newContent);
				});
			},
			source,
		);
		modal.open();
	});
}

/**
 * Set the SVG viewBox to the actual content bounding box and let CSS
 * scale it to fill the container.  This is a safety net in case any
 * content extends past the Artist's nominal width.
 */
function fitSvgToContent(renderDiv: HTMLElement): void {
	const svg = renderDiv.querySelector('svg');
	if (!svg) return;

	// Defer to next frame so the SVG is attached to the DOM.
	requestAnimationFrame(() => {
		try {
			const bbox = svg.getBBox();
			if (bbox.width <= 0 || bbox.height <= 0) return;

			const originalWidth = parseFloat(svg.getAttribute('width') ?? '0');
			const originalHeight = parseFloat(svg.getAttribute('height') ?? '0');
			const contentWidth = Math.ceil(bbox.x + bbox.width + SVG_PADDING);
			const contentHeight = Math.ceil(bbox.y + bbox.height + SVG_PADDING);

			const finalWidth = Math.max(originalWidth, contentWidth);
			const finalHeight = Math.max(originalHeight, contentHeight);

			svg.setAttribute('viewBox', `0 0 ${finalWidth} ${finalHeight}`);
			svg.removeAttribute('width');
			svg.removeAttribute('height');
			svg.style.width = '100%';
			svg.style.height = 'auto';
		} catch {
			// SVG not yet visible — keep original dimensions.
		}
	});
}

/**
 * Replace all hardcoded VexFlow colours in the SVG with the active theme's
 * values.  Done imperatively because Obsidian themes can interfere with
 * CSS-only overrides on SVG presentation attributes.
 */
function applyThemeColors(renderDiv: HTMLElement): void {
	const style = getComputedStyle(document.body);
	const textColor = style.getPropertyValue('--text-normal').trim() || 'currentColor';
	const bgColor = style.getPropertyValue('--background-primary').trim() || 'transparent';

	const svg = renderDiv.querySelector('svg');
	if (!svg) return;

	svg.setAttribute('fill', textColor);
	svg.setAttribute('stroke', textColor);

	svg.querySelectorAll('*').forEach((el) => {
		const tag = el.tagName.toLowerCase();
		const stroke = el.getAttribute('stroke');
		if (stroke && stroke !== 'none') {
			el.setAttribute('stroke', textColor);
		}

		const fill = el.getAttribute('fill');
		if (!fill || fill === 'none') return;
		const fillLower = fill.toLowerCase();
		if (DARK_FILLS.has(fillLower)) {
			el.setAttribute('fill', textColor);
		} else if (WHITE_FILLS.has(fillLower)) {
			el.setAttribute('fill', bgColor);
		} else if (tag === 'rect' && el.getAttribute('opacity') !== '0') {
			el.setAttribute('fill', bgColor);
		}
	});
}

/**
 * Tag every <text> element whose content is human-readable (fret numbers,
 * annotations, lyrics, chord names) with a CSS class so the stylesheet can
 * restyle them without touching the music-notation glyphs.
 */
function applyTextClass(renderDiv: HTMLElement): void {
	renderDiv.querySelectorAll('text').forEach((el) => {
		const content = el.textContent ?? '';
		if (content.length > 0 && READABLE_TEXT_RE.test(content)) {
			el.classList.add(READABLE_TEXT_CLASS);
		}
	});
}

function renderError(container: HTMLElement, error: unknown): void {
	container.empty();
	const errorEl = container.createDiv({ cls: `${CSS_PREFIX}-error` });
	const message = error instanceof Error ? error.message : String(error);
	errorEl.createEl('strong', { text: 'VexTab error' });
	errorEl.createEl('pre', { text: message });
}
