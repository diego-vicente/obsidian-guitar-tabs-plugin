import { Plugin } from 'obsidian';
import { CODEBLOCK_LANGUAGE, DEFAULT_SETTINGS, type GuitarTabsSettings } from './types';
import { GuitarTabsSettingTab } from './settings';
import { createVexTabProcessor } from './renderer';

export default class GuitarTabsPlugin extends Plugin {
	settings: GuitarTabsSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor(
			CODEBLOCK_LANGUAGE,
			createVexTabProcessor(CODEBLOCK_LANGUAGE, () => this.settings),
		);

		this.addSettingTab(new GuitarTabsSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<GuitarTabsSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
