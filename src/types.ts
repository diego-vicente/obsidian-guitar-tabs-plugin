/**
 * Plugin settings persisted via Obsidian's loadData/saveData.
 */
export interface GuitarTabsSettings {
	/** Rendering scale factor (0.5 – 3.0). */
	scale: number;
	/** Default stave width in pixels. 0 = auto-fit to container. */
	width: number;
}

/**
 * Sensible defaults for first-time users.
 */
export const DEFAULT_SETTINGS: GuitarTabsSettings = {
	scale: 1.0,
	width: 0,
};

/** The fenced code block language identifier this plugin processes. */
export const CODEBLOCK_LANGUAGE = 'vextab';

/** CSS class prefix to scope all plugin-generated markup. */
export const CSS_PREFIX = 'guitar-tabs';
