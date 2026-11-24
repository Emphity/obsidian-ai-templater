// Utility functions for interacting with the Templater plugin

import { around } from "monkey-around";
import type { App } from "obsidian";
import type AitPlugin from "../main";
import { InternalModuleAit } from "./InternalModuleAit";

type ObsidianPlugins = {
	enablePlugin: (id: string) => Promise<void>;
	disablePlugin: (id: string) => Promise<void>;
	getPlugin: (id: string) => unknown;
};

type TemplaterPluginLike = {
	templater: {
		functions_generator: {
			internal_functions: {
				modules_array: unknown[];
			};
		};
	};
};

const getTemplater = (plugin: AitPlugin): TemplaterPluginLike | null =>
	(plugin.app as App & { plugins: ObsidianPlugins }).plugins.getPlugin(
		"templater-obsidian",
	) as TemplaterPluginLike | null;

// removes a module from Templater's internal list. Without a target this
// retires every previous "ai" module after a hot reload; with a target it
// removes exactly the instance owned by this plugin.
const removeTemplaterModule = (
	templater: TemplaterPluginLike,
	target?: InternalModuleAit,
): void => {
	const modules_array =
		templater.templater.functions_generator.internal_functions.modules_array;
	for (let index = modules_array.length - 1; index >= 0; index--) {
		const module = modules_array[index] as
			| (InternalModuleAit & { teardown?: () => Promise<void> })
			| undefined;
		const matches = target
			? module === target
			: (module as { name?: unknown })?.name === "ai";
		if (matches && module) {
			modules_array.splice(index, 1);
			void module.teardown?.();
		}
	}
};

export const initializeTemplaterInternalModule = async (
	plugin: AitPlugin,
): Promise<InternalModuleAit> => {
	return new Promise((resolve, reject) => {
		let retries = 30;
		const intervalId = activeWindow.setInterval(() => {
			const templater = getTemplater(plugin);
			if (templater) {
				activeWindow.clearInterval(intervalId);
				const internal_module = new InternalModuleAit(templater);
				internal_module.setPlugin(plugin);

				// hot-reload re-runs this on every plugin reload; retire any
				// previous ai module first so Templater does not accumulate
				// duplicates
				removeTemplaterModule(templater);
				templater.templater.functions_generator.internal_functions.modules_array.push(
					internal_module,
				);
				internal_module
					.init()
					.then(() => {
						resolve(internal_module);
					})
					.catch((error: unknown) => {
						// do not leave a partially initialized module registered
						removeTemplaterModule(templater, internal_module);
						if (error instanceof Error) {
							console.error(
								"Error initializing internal module:",
								error.message,
							);
							reject(error);
						} else {
							console.error("Caught an unknown error:", error);
							reject(new Error("Caught an unknown error"));
						}
					});
			} else if (retries === 0) {
				activeWindow.clearInterval(intervalId);
				reject(new Error("Templater plugin not found after 30 seconds"));
			} else {
				retries--;
			}
		}, 1000);
		// unloading the plugin cancels a still-pending lookup
		plugin.registerInterval(intervalId);
	});
};

// removes this plugin's module from Templater and drops the plugin reference.
// Safe to call several times and during plugin unload/hot reload.
export const detachTemplaterInternalModule = (plugin: AitPlugin): void => {
	const module = plugin.internalModuleAit;
	if (module) {
		const templater = getTemplater(plugin);
		if (templater) removeTemplaterModule(templater, module);
		module.plugin = undefined;
	}
	plugin.internalModuleAit = null;
};

export const trackTemplater = (plugin: AitPlugin): void => {
	plugin.register(
		around((plugin.app as App & { plugins: ObsidianPlugins }).plugins, {
			enablePlugin(oldMethod: (id: string) => Promise<void>) {
				return async function (this: unknown, pluginId: string) {
					const result = await oldMethod.call(this, pluginId);
					if (pluginId === "templater-obsidian") {
						const timeoutId = activeWindow.setTimeout(async () => {
							try {
								plugin.internalModuleAit =
									await initializeTemplaterInternalModule(plugin);
							} catch (error) {
								console.error("Error initializing internal module:", error);
							}
						}, 1000);
						plugin.register(() => activeWindow.clearTimeout(timeoutId));
					}
					return result;
				};
			},
			disablePlugin(oldMethod: (id: string) => Promise<void>) {
				return async function (this: unknown, pluginId: string) {
					if (pluginId === "templater-obsidian") {
						detachTemplaterInternalModule(plugin);
					}
					return oldMethod.call(this, pluginId);
				};
			},
		}),
	);
};
