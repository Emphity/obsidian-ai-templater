import type {
	App,
	ButtonComponent,
	TextComponent,
	ToggleComponent,
} from "obsidian";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type AitPlugin from "../main";
import { decrypt, isEncrypted } from "../utils/Crypto";
import { promotionalLinks } from "./Promotional";
import type { SavedModelList } from "./settings";
import { mergeModels, savedModelListFor } from "./settings";

interface SelectableListEntry {
	value: string;
	alias?: string;
	apiKey?: string;
	// optional detail line shown below the value (e.g. detected token limit)
	hint?: string;
}

interface SelectableListHeaderButton {
	icon: string;
	tooltip: string;
	onClick: () => Promise<void>;
}

interface SelectableListConfig {
	name: string;
	description: string;
	placeholder: string;
	aliasPlaceholder?: string;
	apiKeyPlaceholder?: string;
	allowEmpty: boolean;
	emptyOptionName: string;
	emptyMessage?: string;
	headerButton?: SelectableListHeaderButton;
	getValue: () => string;
	setValue: (value: string) => Promise<void>;
	getSavedEntries: () => SelectableListEntry[];
	setSavedEntries: (entries: SelectableListEntry[]) => Promise<void>;
}

export class OWlSettingTab extends PluginSettingTab {
	plugin: AitPlugin;

	constructor(app: App, plugin: AitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addSelectableListSetting(containerEl, {
			name: "Endpoint",
			description:
				"The endpoint for the AI service. Provide an OpenAI API compatible endpoint, for example: https://openrouter.ai/api/v1/ or https://api.openai.com/v1/",
			placeholder: "https://openrouter.ai/api/v1/",
			aliasPlaceholder: "Alias (optional)",
			apiKeyPlaceholder: "API key (optional)",
			allowEmpty: true,
			emptyOptionName: "Select an endpoint",
			getValue: () => this.plugin.settings.defaultEndpoint,
			setValue: async (value) => {
				this.plugin.settings.defaultEndpoint = value;
				this.plugin.settings.defaultApiKey = this.apiKeyForEndpoint(value);
				await this.plugin.saveSettings();
			},
			getSavedEntries: () => this.plugin.settings.savedEndpoints,
			setSavedEntries: async (entries) => {
				// encrypt any plaintext key before persisting
				this.plugin.settings.savedEndpoints = await Promise.all(
					entries.map(async (entry) => ({
						value: entry.value,
						alias: entry.alias ?? "",
						apiKey: await this.plugin.encryptKey(entry.apiKey ?? ""),
					})),
				);
				if (
					this.plugin.settings.defaultEndpoint &&
					!this.plugin.settings.savedEndpoints.some(
						(entry) => entry.value === this.plugin.settings.defaultEndpoint,
					)
				) {
					this.plugin.settings.defaultApiKey = "";
				} else {
					this.plugin.settings.defaultApiKey = this.apiKeyForEndpoint(
						this.plugin.settings.defaultEndpoint,
					);
				}
				await this.plugin.saveSettings();
			},
		});

		this.addSelectableListSetting(containerEl, {
			name: "Model",
			description: "Name of language model to use.",
			placeholder: "glemma-qwen-opus-astra-llama-2017x.0",
			allowEmpty: true,
			emptyOptionName: "Select a model",
			emptyMessage:
				"No models yet. Use the refresh button to fetch them from the endpoint.",
			headerButton: {
				icon: "refresh-cw",
				tooltip: "Fetch available models from the endpoint",
				onClick: async () => {
					await this.fetchModelsForEndpoint();
				},
			},
			getValue: () => this.plugin.settings.defaultModel,
			setValue: async (value) => {
				this.plugin.settings.defaultModel = value;
				await this.plugin.saveSettings();
			},
			getSavedEntries: () => {
				const list = savedModelListFor(
					this.plugin.settings.savedModels,
					this.plugin.settings.defaultEndpoint || "",
				);
				return (list?.models ?? [])
					.map((value) => {
						const detected = this.plugin.detectedMaxTokensFor(
							this.plugin.settings.defaultEndpoint || "",
							value,
						);
						return {
							value,
							hint: detected
								? `${detected.toString()} tokens (detected)`
								: undefined,
						};
					})
					.reduce<SelectableListEntry[]>((unique, entry) => {
						if (!unique.some((candidate) => candidate.value === entry.value)) {
							unique.push(entry);
						}
						return unique;
					}, []);
			},
			setSavedEntries: async (entries) => {
				await this.updateModelListForActiveEndpoint((list) => {
					list.models = entries.map((entry) => entry.value);
				});
				await this.plugin.saveSettings();
			},
		});

		new Setting(containerEl)
			.setName("Max tokens per request")
			.setDesc(
				`Maximum number of tokens the AI can generate. Enter 0 (or leave empty) to use the maximum
        detected for the selected model when the endpoint reports it; if nothing is detected the field
        is omitted and the provider applies its default. A value entered here takes priority over the
        detected maximum, and a template call to tp.ai.chat(...) can override both with its maxTokens
        argument. It also helps in managing costs.`,
			)
			.setClass("ait-settings")
			.addText((text) => {
				text
					.setPlaceholder("0 = use model max")
					.setValue(this.plugin.settings.defaultMaxNumTokens.toString())
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.defaultMaxNumTokens = Number.isFinite(parsed)
							? Math.max(0, parsed)
							: 0;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Max characters per outgoing request")
			.setDesc(
				`Each model calculates tokens differently. This setting controls how many characters can be sent 
        before a function call fails. This is not the same as token count, but is a safety measure to 
        prevent large amounts of text being sent and potentially large costs being incurred.`,
			)
			.setClass("ait-settings")
			.addText((text) => {
				text
					.setValue(
						this.plugin.settings.defaultMaxOutgoingCharacters.toString(),
					)
					.onChange(async (value) => {
						this.plugin.settings.defaultMaxOutgoingCharacters = Number.parseInt(
							value,
							10,
						);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("System message")
			.setDesc(
				"Default system message sent with each prompt. This message is used to initialize the conversation.",
			)
			.setClass("ait-settings")
			.addTextArea((textEl) => {
				textEl
					.setValue(this.plugin.settings.defaultSystemMessage || "")
					.onChange(async (value) => {
						this.plugin.settings.defaultSystemMessage = value;
						await this.plugin.saveData(this.plugin.settings);
					});
				textEl.inputEl.rows = 6;
			});

		promotionalLinks(containerEl);
		containerEl.createEl("hr");

		new Setting(containerEl).setName("Debugging").setHeading();

		new Setting(containerEl)
			.setName("Debug to the console")
			.setDesc("Dumps detailed into to the console for debugging.")
			.addToggle((cb: ToggleComponent) => {
				cb.setValue(this.plugin.settings.debugToConsole ?? false);
				cb.onChange(async (value: boolean) => {
					this.plugin.settings.debugToConsole = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Display token usage on desktop")
			.setDesc(
				`Displays the number of tokens used a notification on the desktop. Message format is prompt 
        tokens/completion tokens/total tokens. So it will look something like:  45/100/145.`,
			)
			.addToggle((cb: ToggleComponent) => {
				cb.setValue(this.plugin.settings.displayTokenUsageDesktop ?? false);
				cb.onChange(async (value: boolean) => {
					this.plugin.settings.displayTokenUsageDesktop = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Display token usage on mobile")
			.setDesc(
				"Displays the  number of tokens used a notification on the mobile.",
			)
			.addToggle((cb: ToggleComponent) => {
				cb.setValue(this.plugin.settings.displayTokenUsageMobile ?? false);
				cb.onChange(async (value: boolean) => {
					this.plugin.settings.displayTokenUsageMobile = value;
					await this.plugin.saveSettings();
				});
			});
	}

	private apiKeyForEndpoint(value: string): string {
		return (
			this.plugin.settings.savedEndpoints.find((entry) => entry.value === value)
				?.apiKey ?? ""
		);
	}

	private async updateModelListForActiveEndpoint(
		update: (list: SavedModelList) => void,
	): Promise<void> {
		const endpoint = this.plugin.settings.defaultEndpoint || "";
		const lists = this.plugin.settings.savedModels;
		let list = savedModelListFor(lists, endpoint);
		if (!list) {
			list = { endpoint, models: [] };
			lists.push(list);
		}
		update(list);
		await this.plugin.saveSettings();
	}

	// fetches the models available on the current endpoint and stores them
	// as that endpoint's list. Manual models are preserved on refresh; a
	// refetch only happens when the user presses the button.
	private async fetchModelsForEndpoint(): Promise<void> {
		const endpoint = this.plugin.settings.defaultEndpoint;
		if (!endpoint) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Select an endpoint first.`,
				8000,
			);
			return;
		}

		const apiKey = this.apiKeyForEndpoint(endpoint);
		const fetched = await this.plugin.openAiApi.availableModels(
			endpoint,
			apiKey || null,
		);
		if (fetched.length === 0) return;

		const modelLists = this.plugin.settings.savedModels ?? [];
		const existing = savedModelListFor(modelLists, endpoint);
		const models = existing
			? mergeModels(existing.models, fetched)
			: [...new Set(fetched)];
		this.plugin.settings.savedModels = modelLists;
		if (existing) {
			existing.models = models;
			existing.fetchedAt = Date.now();
		} else {
			modelLists.push({ endpoint, models, fetchedAt: Date.now() });
		}
		if (
			this.plugin.settings.defaultModel &&
			!models.includes(this.plugin.settings.defaultModel)
		) {
			models.push(this.plugin.settings.defaultModel);
		}
		await this.plugin.saveSettings();

		if (this.plugin.settings.debugToConsole) {
			this.plugin.log("fetchModelsForEndpoint", {
				endpoint,
				total: models.length,
				fetched: fetched.length,
			});
		}
		new Notice(
			`${this.plugin.APP_ABBREVIARTION}: ${fetched.length.toString()} models available for this endpoint.`,
			6000,
		);
		this.display();
	}

	private addSelectableListSetting(
		containerEl: HTMLElement,
		config: SelectableListConfig,
	): void {
		const entries = config.getSavedEntries();
		const labelFor = (entry: SelectableListEntry): string =>
			entry.alias?.trim() || entry.value;

		const setting = new Setting(containerEl)
			.setName(config.name)
			.setDesc(config.description)
			.setClass("ait-settings");

		if (config.headerButton) {
			const headerConfig = config.headerButton;
			setting.addButton((button) => {
				button.setClass("ait-fetch-button");
				button.setIcon(headerConfig.icon);
				button.setTooltip(headerConfig.tooltip);
				button.onClick(async () => {
					button.setDisabled(true);
					button.setIcon("loader");
					try {
						await headerConfig.onClick();
					} finally {
						button.setDisabled(false);
					}
				});
			});
		}

		const inputWrapper = containerEl.createDiv({
			cls: "ait-saved-list-input-wrapper",
		});
		inputWrapper.hide();

		let toggleButton: ButtonComponent | undefined;
		setting.addButton((button) => {
			toggleButton = button;
			button.setClass("ait-add-toggle");
			button.setIcon("plus");
			button.setTooltip("Add new option");
			button.onClick(() => {
				setInputsVisible(!inputsShown);
			});
		});
		setting.addDropdown((dropdown) => {
			if (config.allowEmpty) {
				dropdown.addOption("", config.emptyOptionName);
			}
			for (const entry of entries) {
				dropdown.addOption(entry.value, labelFor(entry));
			}
			dropdown.setValue(config.getValue());
			dropdown.onChange(async (value) => {
				await config.setValue(value);
				this.display();
			});
		});

		const inputSetting = new Setting(inputWrapper).setClass(
			"ait-settings ait-saved-list-input",
		);
		let aliasInput: TextComponent | undefined;
		let valueInput: TextComponent | undefined;
		let apiKeyInput: TextComponent | undefined;
		let saveButton: ButtonComponent | undefined;
		let editingValue: string | undefined;
		let inputsShown = false;
		const setInputsVisible = (visible: boolean): void => {
			inputsShown = visible;
			if (visible) {
				inputWrapper.show();
			} else {
				inputWrapper.hide();
				editingValue = undefined;
				saveButton?.setButtonText("Save");
				aliasInput?.setValue("");
				valueInput?.setValue("");
				apiKeyInput?.setValue("");
			}
			toggleButton?.setIcon(visible ? "x" : "plus");
		};
		if (config.aliasPlaceholder) {
			const aliasPlaceholder = config.aliasPlaceholder;
			inputSetting.addText((text) => {
				aliasInput = text;
				text.setPlaceholder(aliasPlaceholder);
				text.inputEl.addClass("ait-input-alias");
			});
		}
		inputSetting.addText((text) => {
			valueInput = text;
			text.setPlaceholder(config.placeholder);
			text.inputEl.addClass("ait-input-value");
		});
		if (config.apiKeyPlaceholder) {
			const apiKeyPlaceholder = config.apiKeyPlaceholder;
			inputSetting.addText((text) => {
				apiKeyInput = text;
				setPasswordOnBlur(text.inputEl);
				text.setPlaceholder(apiKeyPlaceholder);
				text.inputEl.addClass("ait-input-apikey");
				if (!this.plugin.isUnlocked()) {
					const stored = config.getSavedEntries().find((entry) => entry.apiKey);
					if (stored && isEncrypted(stored.apiKey ?? "")) {
						text.setDisabled(true);
						text.setPlaceholder("Locked — unlock to edit API keys");
					}
				}
			});
		}
		inputSetting.addButton((button) => {
			saveButton = button;
			button.setButtonText("Save").onClick(async () => {
				const value = valueInput?.getValue().trim() ?? "";
				if (!value) return;
				const alias = aliasInput?.getValue().trim() ?? "";
				const apiKey = apiKeyInput?.getValue().trim() ?? "";
				if (apiKey && !this.plugin.isUnlocked()) {
					new Notice(
						`${this.plugin.APP_ABBREVIARTION} is locked. Unlock to save API keys.`,
						8000,
					);
					return;
				}

				const nextEntries = [...entries];
				const existing = editingValue
					? nextEntries.find((entry) => entry.value === editingValue)
					: nextEntries.find((entry) => entry.value === value);
				if (existing) {
					existing.value = value;
					existing.alias = alias;
					existing.apiKey = apiKey
						? await this.plugin.encryptKey(apiKey)
						: existing.apiKey;
				} else {
					nextEntries.push({
						value,
						alias,
						apiKey: await this.plugin.encryptKey(apiKey),
					});
				}

				await config.setSavedEntries(nextEntries);
				if (config.getValue() === editingValue || config.getValue() === value) {
					await config.setValue(value);
				}
				editingValue = undefined;
				if (saveButton) saveButton.setButtonText("Save");
				setInputsVisible(false);
				this.display();
			});
		});

		const showInputsFor = (entry: SelectableListEntry): void => {
			editingValue = entry.value;
			aliasInput?.setValue(entry.alias ?? "");
			valueInput?.setValue(entry.value);
			if (entry.apiKey && isEncrypted(entry.apiKey)) {
				if (this.plugin.isUnlocked()) {
					void decrypt(entry.apiKey, this.plugin.unlockKey as CryptoKey).then(
						(plaintext) => {
							apiKeyInput?.setValue(plaintext);
						},
					);
				} else {
					apiKeyInput?.setValue("");
				}
			} else {
				apiKeyInput?.setValue(entry.apiKey ?? "");
			}
			saveButton?.setButtonText("Update");
			setInputsVisible(true);
			valueInput?.inputEl.focus();
		};

		const listEl = inputWrapper.createDiv({ cls: "ait-saved-list" });
		if (entries.length === 0) {
			listEl.createDiv({
				cls: "ait-saved-list-empty",
				text: config.emptyMessage ?? "No saved values",
			});
			return;
		}

		for (const entry of entries) {
			const itemEl = listEl.createDiv({ cls: "ait-saved-list-item" });
			const textsEl = itemEl.createDiv({ cls: "ait-saved-list-texts" });
			textsEl.createSpan({
				cls: "ait-saved-list-value",
				text: labelFor(entry),
			});
			if (entry.alias?.trim()) {
				textsEl.createDiv({ cls: "ait-saved-list-url", text: entry.value });
			}
			if (entry.hint?.trim()) {
				textsEl.createDiv({ cls: "ait-saved-list-url", text: entry.hint });
			}
			const editButton = itemEl.createEl("button", { text: "Edit" });
			editButton.addEventListener("click", () => {
				showInputsFor(entry);
			});
			const removeButton = itemEl.createEl("button", {
				cls: "mod-warning",
				text: "Remove",
			});
			removeButton.addEventListener("click", async () => {
				if (!config.allowEmpty && entries.length === 1) return;
				const nextEntries = entries.filter(
					(candidate) => candidate.value !== entry.value,
				);
				await config.setSavedEntries(nextEntries);
				if (config.getValue() === entry.value) {
					await config.setValue(nextEntries[0]?.value ?? "");
				}
				this.display();
			});
		}
	}
}

// Thank you chhoumann for this code
// https://github.com/chhoumann/quickadd/blob/master/src/utils/setPasswordOnBlur.ts
function setPasswordOnBlur(el: HTMLInputElement) {
	el.addEventListener("focus", () => {
		el.type = "text";
	});

	el.addEventListener("blur", () => {
		el.type = "password";
	});

	el.type = "password";
}
