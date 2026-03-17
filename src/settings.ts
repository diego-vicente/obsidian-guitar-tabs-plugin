import { App, PluginSettingTab, Setting } from 'obsidian';
import type GuitarTabsPlugin from './main';
import { DEFAULT_SETTINGS } from './types';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const MIN_WIDTH = 0;
const MAX_WIDTH = 2000;

export class GuitarTabsSettingTab extends PluginSettingTab {
	plugin: GuitarTabsPlugin;

	constructor(app: App, plugin: GuitarTabsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Render scale')
			.setDesc(
				`Zoom factor for rendered notation (${MIN_SCALE} – ${MAX_SCALE}). ` +
				`Default: ${DEFAULT_SETTINGS.scale}.`
			)
			.addSlider(slider =>
				slider
					.setLimits(MIN_SCALE, MAX_SCALE, 0.1)
					.setValue(this.plugin.settings.scale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.scale = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Default stave width')
			.setDesc(
				`Width in pixels for each stave. Set to ${MIN_WIDTH} to auto-fit the container width. ` +
				`Default: ${DEFAULT_SETTINGS.width}.`
			)
			.addText(text =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.width))
					.setValue(String(this.plugin.settings.width))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
							this.plugin.settings.width = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
