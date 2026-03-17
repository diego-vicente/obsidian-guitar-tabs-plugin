/**
 * Minimal type declarations for vextab v4.x.
 *
 * The published package ships only a UMD bundle without type definitions.
 * These declarations cover the subset of the API that this plugin uses.
 */
declare module 'vextab' {
	/**
	 * Options accepted by the Artist constructor.
	 */
	interface ArtistOptions {
		font_face?: string;
		font_size?: number;
		font_style?: string | null;
		bottom_spacing?: number;
		tab_stave_lower_spacing?: number;
		note_stave_lower_spacing?: number;
		scale?: number;
	}

	/**
	 * Artist orchestrates VexFlow rendering from parsed VexTab data.
	 */
	export class Artist {
		static DEBUG: boolean;
		static NOLOGO: boolean;

		constructor(
			x: number,
			y: number,
			width: number,
			options?: Partial<ArtistOptions>,
		);

		render(renderer: unknown): void;
		reset(): void;
	}

	/**
	 * VexTab parses VexTab notation strings using an Artist instance.
	 */
	export class VexTab {
		constructor(artist: Artist);
		parse(input: string): void;
	}

	/**
	 * Re-exported VexFlow namespace.
	 */
	export const Vex: {
		Flow: {
			Renderer: {
				new (
					element: HTMLElement | string,
					backend: number,
				): {
					resize(width: number, height: number): void;
					getContext(): unknown;
				};
				Backends: {
					CANVAS: number;
					SVG: number;
				};
			};
		};
	};
}
