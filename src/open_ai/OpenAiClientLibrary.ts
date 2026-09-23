// This module takes care of all communication with the OpenAI Client Library
// https://platform.openai.com/docs/api-reference

import { Notice, Platform, requestUrl } from "obsidian";
import type { ClientOptions } from "openai";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import type AitPlugin from "../main";
import type { ModelLimit } from "../settings/settings";

// fetch implementation backed by Obsidian's requestUrl, which performs the
// request from the main process and is not subject to CORS restrictions
const obsidianFetch = async (
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> => {
	const body = init?.body;
	if (body !== undefined && typeof body !== "string") {
		return globalThis.fetch(input, init);
	}
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.toString()
				: input.url;
	const headers: Record<string, string> = {};
	if (init?.headers) {
		for (const [key, value] of new Headers(init.headers).entries()) {
			headers[key] = value;
		}
	}
	const response = await requestUrl({
		url,
		method: init?.method ?? "GET",
		headers,
		body: body as string | undefined,
		throw: false,
	});
	return new Response(response.text, {
		status: response.status,
		headers: response.headers,
	});
};

// session identifier sent as x-opencode-session, generated once per plugin
// load as required by OpenCode Go (https://opencode.ai/docs/go/)
const sessionGuid = crypto.randomUUID();

// header only needed for OpenCode endpoints
const isOpenCodeEndpoint = (baseURL: string): boolean => {
	try {
		return new URL(baseURL).hostname === "opencode.ai";
	} catch {
		return false;
	}
};

const asPositiveNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;

// extracts the token limits a model object reports, when any. The standard
// OpenAI /v1/models payload has no limit fields; OpenRouter adds
// context_length + top_provider.max_completion_tokens, LM Studio sometimes
// adds max_context_length. Unknown fields are ignored.
const extractLimit = (raw: unknown): ModelLimit | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined;
	const record = raw as {
		id?: unknown;
		context_length?: unknown;
		max_context_length?: unknown;
		context_window?: unknown;
		top_provider?: unknown;
	};
	const id = typeof record.id === "string" ? record.id : "";
	if (!id) return undefined;
	const top =
		typeof record.top_provider === "object" && record.top_provider !== null
			? (record.top_provider as { max_completion_tokens?: unknown })
			: undefined;
	const maxCompletionTokens = asPositiveNumber(top?.max_completion_tokens);
	const contextLength =
		asPositiveNumber(record.context_length) ??
		asPositiveNumber(record.max_context_length) ??
		asPositiveNumber(record.context_window);
	if (maxCompletionTokens === undefined && contextLength === undefined) {
		return undefined;
	}
	return { maxCompletionTokens, contextLength, fetchedAt: Date.now() };
};

export default class OpenAiApi {
	private plugin: AitPlugin;

	constructor(plugin: AitPlugin) {
		this.plugin = plugin;
	}

	// creates the OpenAI client with the Obsidian fetch wrapper and the
	// client identification headers required by OpenCode Go
	private createClient = (apiKey: string, baseURL: string): OpenAI => {
		const defaultHeaders: Record<string, string> = {
			"User-Agent": `${this.plugin.manifest.id}/${this.plugin.manifest.version}`,
		};
		if (isOpenCodeEndpoint(baseURL)) {
			defaultHeaders["x-opencode-session"] = sessionGuid;
		}
		return new OpenAI({
			apiKey,
			dangerouslyAllowBrowser: true,
			fetch: obsidianFetch,
			defaultHeaders,
		} as ClientOptions);
	};

	// validates the current settings (API Key, Endpoint and Model)
	validateSettings = (): boolean => {
		if (!this.plugin.settings.defaultEndpoint) {
			this.plugin.log("validateSettings", "defaultEndpoint is not set");
			return false;
		}
		if (!this.plugin.settings.defaultApiKey) {
			this.plugin.log("validateSettings", "defaultApiKey is not set");
			return false;
		}
		if (!this.plugin.settings.defaultModel) {
			this.plugin.log("validateSettings", "defaultModel is not set");
			return false;
		}
		return true;
	};

	// executes a single prompt and returns the completion
	chat = async (
		promptOrMessages: string | ChatCompletionMessageParam[],
		model?: string | null,
		systemMessage?: string | null,
		maxTokens?: number,
		maxOutgoingCharacters?: number,
		baseURL?: string | null,
		apiKey?: string | null,
		organization?: string | null,
	): Promise<string> => {
		const effectiveBaseURL = baseURL || this.plugin.settings.defaultEndpoint;

		// resolve the API key: explicit argument wins, otherwise decrypt the
		// stored key for the endpoint. A locked session blocks the request.
		let effectiveApiKey = apiKey ?? null;
		if (!effectiveApiKey) {
			const decrypted = await this.plugin.decryptKeyFor(effectiveBaseURL);
			if (decrypted === null) {
				new Notice(
					`${this.plugin.APP_ABBREVIARTION} is locked. Run "Unlock API keys" to use this endpoint.`,
					10000,
				);
				return "";
			}
			effectiveApiKey = decrypted;
		}
		const openai = this.createClient(effectiveApiKey, effectiveBaseURL);

		if (organization) openai.organization = organization;

		if (!this.validateSettings()) {
			new Notice(
				"Check your setting for valid API key, model and endpoint.",
				10000,
			);
			return "";
		}

		if (effectiveBaseURL !== "") openai.baseURL = effectiveBaseURL;

		const messages: ChatCompletionMessageParam[] =
			typeof promptOrMessages === "string"
				? [{ role: "user", content: promptOrMessages }]
				: promptOrMessages;

		// check if messages contains a role of 'system' and if not, add it
		if (!messages.find((message) => message.role === "system")) {
			messages.unshift({
				role: "system",
				content: this.plugin.settings.defaultSystemMessage,
			});
		}
		// find the system message from the messages and replace it with the systemMessage parameter if defined
		if (systemMessage) {
			const systemMessageIndex = messages.findIndex(
				(message) => message.role === "system",
			);
			if (systemMessageIndex > -1) {
				messages[systemMessageIndex].content = systemMessage;
			}
		}

		// Test the character count of messages to make sure it does not exceed the user defined maxOutgoingCharacters
		const jsonString = JSON.stringify(messages);
		const characterCount = jsonString.length;

		const maxCharacters = maxOutgoingCharacters
			? maxOutgoingCharacters
			: this.plugin.settings.defaultMaxOutgoingCharacters;
		if (characterCount > maxCharacters) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION}: Character count exceeds the limit of ${maxCharacters.toString()} for outgoing AI requests and the current character count is ${characterCount.toString()}. This setting can be changed in Settings or as part of the command.`,
				15000,
			);
			this.plugin.log(
				`chat', 'Character count exceeds limt. Defined limit is ${maxCharacters.toString()} and the current character count is ${characterCount.toString()}.`,
			);
			return "";
		}

		// resolve the completion token limit: template argument > manual
		// setting > maximum detected for the model > 0 (= omit the field so
		// the provider applies its own default)
		const resolvedMaxTokens = this.plugin.resolveMaxTokens(
			maxTokens ?? null,
			effectiveBaseURL,
			model ?? null,
		);

		try {
			const completion = await openai.chat.completions.create({
				messages: messages,
				model: model ?? this.plugin.settings.defaultModel,
				...(resolvedMaxTokens > 0
					? { max_completion_tokens: resolvedMaxTokens }
					: {}),
			});

			if (this.plugin.settings.debugToConsole) {
				const logMessage = {
					prompt: messages,
					completion: completion,
					// apiKey intentionally omitted so decrypted keys never
					// reach the console
					clientOptions: {
						baseURL: openai.baseURL,
						organization: openai.organization,
					},
					resolvedMaxCompletionTokens:
						resolvedMaxTokens > 0 ? resolvedMaxTokens : "omitted",
					outgoingCharacterCountMax: maxCharacters,
					outgoingCharacerCountActual: characterCount,
				};
				this.plugin.log("chat", logMessage);
			}

			if (
				((Platform.isDesktop &&
					this.plugin.settings.displayTokenUsageDesktop) ??
					false) ||
				((Platform.isMobile && this.plugin.settings.displayTokenUsageMobile) ??
					false)
			) {
				const { usage } = completion;
				if (usage) {
					const displayMessage =
						`${this.plugin.APP_ABBREVIARTION}:\n` +
						`Tokens: ${usage.prompt_tokens.toString()}/${usage.completion_tokens.toString()}/${usage.total_tokens.toString()}\n` +
						`Character count: ${characterCount.toString()}`;
					new Notice(displayMessage, 8000);
				}
			}

			return completion.choices[0].message.content
				? completion.choices[0].message.content
				: "";
		} catch (error) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Error: ${String(error)}`,
				20000,
			);
			return "";
		}
	};

	// resolve the API key for the model list: explicit argument wins,
	// otherwise decrypt the stored key. Locked sessions just omit the key
	// (local endpoints such as Ollama/LM Studio work without any key).
	availableModels = async (
		baseURL?: string | null,
		apiKey?: string | null,
	): Promise<string[]> => {
		const effectiveBaseURL = baseURL || this.plugin.settings.defaultEndpoint;
		if (!effectiveBaseURL) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Select an endpoint before fetching models.`,
				10000,
			);
			this.plugin.log("availableModels", "no endpoint to fetch models from");
			return [];
		}

		let effectiveApiKey = apiKey ?? null;
		if (!effectiveApiKey) {
			const decrypted = await this.plugin.decryptKeyFor(effectiveBaseURL);
			if (decrypted === null) {
				new Notice(
					`${this.plugin.APP_ABBREVIARTION} is locked. Run "Unlock API keys" to send credentials to this endpoint.`,
					10000,
				);
				return [];
			}
			effectiveApiKey = decrypted;
		}
		const openai = this.createClient(effectiveApiKey, effectiveBaseURL);
		openai.baseURL = effectiveBaseURL;

		if (this.plugin.settings.debugToConsole) {
			this.plugin.log("availableModels", {
				endpoint: effectiveBaseURL,
				usingApiKey: Boolean(effectiveApiKey),
			});
		}

		try {
			const models = await openai.models.list();

			// persist the token limits the endpoint reports, if any
			const limits: Record<string, ModelLimit> = {};
			for (const raw of models.data) {
				const limit = extractLimit(raw);
				if (limit) {
					limits[raw.id] = limit;
				}
			}
			if (Object.keys(limits).length > 0) {
				await this.plugin.saveModelLimits(effectiveBaseURL, limits);
			}

			if (this.plugin.settings.debugToConsole) {
				this.plugin.log("availableModels", {
					models: models.data,
					limitsDetected: Object.keys(limits).length,
				});
			}

			return models.data.map((model) => model.id);
		} catch (error) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Error fetching models: ${String(error)}`,
				15000,
			);
			return [];
		}
	};
}
