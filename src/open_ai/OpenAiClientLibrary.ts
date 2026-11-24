// This module takes care of all communication with the AI providers. Requests
// go either to OpenAI-compatible endpoints (OpenAI, OpenRouter, Ollama, LM
// Studio, OpenCode...) through the OpenAI client library, or to native
// Anthropic endpoints through the Anthropic client library, selected per
// endpoint (see src/api/provider.ts)
// https://platform.openai.com/docs/api-reference
// https://docs.anthropic.com/en/api/messages

import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import { Anthropic } from "@anthropic-ai/sdk";
import { Notice, Platform } from "obsidian";
import type { ClientOptions as OpenAiClientOptions } from "openai";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import {
	anthropicToSimpleCompletion,
	messagesToAnthropic,
} from "../api/anthropicAdapter";
import { obsidianFetch } from "../api/obsidianFetch";
import type { ApiProvider } from "../api/provider";
import {
	ANONYMOUS_API_KEY,
	ANTHROPIC_OAUTH_BETA,
	DEFAULT_ANTHROPIC_MAX_TOKENS,
	isAnthropicOAuthKey,
	normalizeAnthropicBaseURL,
	providerForEndpoint,
} from "../api/provider";
import type { SimpleChatCompletion } from "../api/types";
import type AitPlugin from "../main";
import type { ModelLimit } from "../settings/settings";
import { apiTypeForEndpoint } from "../settings/settings";

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

// maps an OpenAI chat completion into the provider-agnostic shape shared by
// the debug logging and the token usage notice
const openAiToSimpleCompletion = (completion: {
	choices?: { message?: { content?: string | null } }[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	} | null;
	model?: string;
}): SimpleChatCompletion => {
	const usage = completion.usage
		? {
				prompt_tokens: completion.usage.prompt_tokens ?? 0,
				completion_tokens: completion.usage.completion_tokens ?? 0,
				total_tokens: completion.usage.total_tokens ?? 0,
			}
		: undefined;
	return {
		content: completion.choices?.[0]?.message?.content ?? "",
		usage,
		model: completion.model,
	};
};

export default class OpenAiApi {
	private plugin: AitPlugin;

	constructor(plugin: AitPlugin) {
		this.plugin = plugin;
	}

	// resolves the API dialect for an endpoint: the per-endpoint setting wins,
	// otherwise the hostname decides (api.anthropic.com => Anthropic)
	private resolveProvider = (baseURL: string): ApiProvider =>
		providerForEndpoint(
			baseURL,
			apiTypeForEndpoint(this.plugin.settings.savedEndpoints, baseURL),
		);

	// creates the OpenAI client with the Obsidian fetch wrapper and the
	// client identification headers required by OpenCode Go
	private createClient = (apiKey: string | null, baseURL: string): OpenAI => {
		const defaultHeaders: Record<string, string> = {
			"User-Agent": `${this.plugin.manifest.id}/${this.plugin.manifest.version}`,
		};
		if (isOpenCodeEndpoint(baseURL)) {
			defaultHeaders["x-opencode-session"] = sessionGuid;
		}
		return new OpenAI({
			// the SDK rejects an empty key; the sentinel is removed later by
			// obsidianFetch for unauthenticated endpoints
			apiKey: apiKey || ANONYMOUS_API_KEY,
			dangerouslyAllowBrowser: true,
			fetch: obsidianFetch,
			defaultHeaders,
		} as OpenAiClientOptions);
	};

	// creates the Anthropic client with the Obsidian fetch wrapper; OAuth
	// access tokens authenticate via Authorization header and require the
	// oauth beta flag instead of x-api-key
	private createAnthropicClient = (
		apiKey: string | null,
		baseURL: string,
	): Anthropic => {
		const defaultHeaders: Record<string, string> = {
			"User-Agent": `${this.plugin.manifest.id}/${this.plugin.manifest.version}`,
		};
		const effectiveApiKey = apiKey || ANONYMOUS_API_KEY;
		const options: AnthropicClientOptions = {
			dangerouslyAllowBrowser: true,
			fetch: obsidianFetch,
			defaultHeaders,
			baseURL: normalizeAnthropicBaseURL(baseURL),
		};
		if (isAnthropicOAuthKey(effectiveApiKey)) {
			options.authToken = effectiveApiKey;
			defaultHeaders["anthropic-beta"] = ANTHROPIC_OAUTH_BETA;
		} else {
			options.apiKey = effectiveApiKey;
		}
		return new Anthropic(options);
	};

	// validates the effective request settings. The API key is optional:
	// unauthenticated endpoints (Ollama, LM Studio, ...) send no credentials.
	validateSettings = (baseURL: string, model?: string | null): boolean => {
		if (!baseURL) {
			this.plugin.log("validateSettings", "endpoint is not set");
			return false;
		}
		if (!model) {
			this.plugin.log("validateSettings", "model is not set");
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

		// resolve the API key: an explicit argument wins (including an empty
		// string, which means "no credentials"), otherwise decrypt the stored
		// key for this endpoint. A locked session blocks the request.
		let effectiveApiKey: string | null = null;
		if (apiKey !== undefined && apiKey !== null) {
			effectiveApiKey = apiKey;
		} else {
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

		const requestModel = model ?? this.plugin.settings.defaultModel;
		const provider = this.resolveProvider(effectiveBaseURL);

		if (!this.validateSettings(effectiveBaseURL, requestModel)) {
			new Notice("Check your settings for a valid endpoint and model.", 10000);
			return "";
		}

		// work on a copy: the caller may reuse the same messages array across
		// requests and must not observe the injected/replaced system message
		const messages: ChatCompletionMessageParam[] =
			typeof promptOrMessages === "string"
				? [{ role: "user", content: promptOrMessages }]
				: [...promptOrMessages];

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

		// only a valid positive number may tighten the configured guard
		const maxCharacters =
			typeof maxOutgoingCharacters === "number" &&
			Number.isSafeInteger(maxOutgoingCharacters) &&
			maxOutgoingCharacters > 0
				? maxOutgoingCharacters
				: this.plugin.settings.defaultMaxOutgoingCharacters;
		if (characterCount > maxCharacters) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION}: the request is too large.\n` +
					`Characters: ${characterCount.toString()} of ${maxCharacters.toString()} allowed.\n` +
					`Lower the amount of text, or raise "Max characters per outgoing request".`,
				15000,
			);
			this.plugin.log(
				`chat: character count exceeds limit. Defined limit is ${maxCharacters.toString()} and the current character count is ${characterCount.toString()}.`,
			);
			return "";
		}

		// resolve the completion token limit: template argument > manual
		// setting > maximum detected for the model > 0 (= omit the field so
		// the provider applies its own default; Anthropic instead falls back
		// to DEFAULT_ANTHROPIC_MAX_TOKENS because max_tokens is required)
		const resolvedMaxTokens = this.plugin.resolveMaxTokens(
			maxTokens ?? null,
			effectiveBaseURL,
			model ?? null,
		);

		try {
			let completion: SimpleChatCompletion;
			let rawResponse: unknown;

			if (provider === "anthropic") {
				const client = this.createAnthropicClient(
					effectiveApiKey,
					effectiveBaseURL,
				);
				// Anthropic keeps the system prompt out of the messages array
				const draft = messagesToAnthropic(
					this.plugin.settings.defaultSystemMessage,
					messages,
				);
				if (draft.messages.length === 0) {
					throw new Error(
						"Anthropic requires at least one non-empty user or assistant message",
					);
				}
				// streaming keeps long generations alive: Anthropic rejects
				// non-streaming requests whose max_tokens could exceed the
				// 10 minute request limit, which happens when the detected
				// model maximum is sent. finalMessage() resolves with the
				// complete Message once the stream ends, so the caller sees
				// the same shape as a non-streaming response.
				const stream = client.messages.stream({
					model: requestModel,
					max_tokens:
						resolvedMaxTokens > 0
							? resolvedMaxTokens
							: DEFAULT_ANTHROPIC_MAX_TOKENS,
					...(draft.system ? { system: draft.system } : {}),
					messages: draft.messages,
				});
				const response = await stream.finalMessage();
				completion = anthropicToSimpleCompletion(response);
				rawResponse = response;
			} else {
				const openai = this.createClient(effectiveApiKey, effectiveBaseURL);
				if (effectiveBaseURL !== "") openai.baseURL = effectiveBaseURL;

				if (organization) openai.organization = organization;

				const response = await openai.chat.completions.create({
					messages: messages,
					model: requestModel,
					...(resolvedMaxTokens > 0
						? { max_completion_tokens: resolvedMaxTokens }
						: {}),
				});
				completion = openAiToSimpleCompletion(response);
				rawResponse = response;
			}

			if (this.plugin.settings.debugToConsole) {
				const logMessage = {
					provider,
					prompt: messages,
					completion: rawResponse,
					// apiKey intentionally omitted so decrypted keys never
					// reach the console
					clientOptions: {
						baseURL: effectiveBaseURL,
						organization: organization ?? undefined,
					},
					resolvedMaxCompletionTokens:
						resolvedMaxTokens > 0 ? resolvedMaxTokens : "omitted",
					outgoingCharacterCountMax: maxCharacters,
					outgoingCharacerCountActual: characterCount,
				};
				this.plugin.log("chat", logMessage);
			}

			const usage = completion.usage;
			const usageMessage = usage
				? this.formatTokenUsage(usage, characterCount)
				: `Characters sent: ${characterCount.toString()}`;
			if (
				((Platform.isDesktop &&
					this.plugin.settings.displayTokenUsageDesktop) ??
					false) ||
				((Platform.isMobile && this.plugin.settings.displayTokenUsageMobile) ??
					false)
			) {
				// 0 keeps the usage notice visible until the user dismisses it
				new Notice(
					`${this.plugin.APP_ABBREVIARTION}: response received.\n${usageMessage}`,
					0,
				);
			}

			return completion.content ? completion.content : "";
		} catch (error) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Error: ${String(error)}`,
				20000,
			);
			return "";
		}
	};

	// Formats usage without the opaque prompt/completion/total notation.
	private formatTokenUsage(
		usage: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		},
		characterCount: number,
	): string {
		return [
			`Sent: ${usage.prompt_tokens.toLocaleString()} tokens`,
			`Received: ${usage.completion_tokens.toLocaleString()} tokens`,
			`Total: ${usage.total_tokens.toLocaleString()} tokens`,
			`Characters sent: ${characterCount.toLocaleString()}`,
		].join("\n");
	}

	// resolve the API key for the model list: explicit argument wins,
	// otherwise decrypt the stored key. Locked sessions just omit the key
	// (local endpoints such as Ollama/LM Studio work without any key).
	availableModels = async (
		baseURL?: string | null,
		apiKey?: string | null,
	): Promise<string[]> => {
		const result = await this.availableModelsWithLimits(baseURL, apiKey);
		await this.plugin.saveModelLimits(
			baseURL || this.plugin.settings.defaultEndpoint,
			result.limits,
		);
		return result.ids;
	};

	// same provider request as availableModels, but limits are returned to
	// Settings so models and limits can be persisted in a single write
	availableModelsWithLimits = async (
		baseURL?: string | null,
		apiKey?: string | null,
	): Promise<{ ids: string[]; limits: Record<string, ModelLimit> }> => {
		const effectiveBaseURL = baseURL || this.plugin.settings.defaultEndpoint;
		if (!effectiveBaseURL) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Select an endpoint before fetching models.`,
				10000,
			);
			this.plugin.log("availableModels", "no endpoint to fetch models from");
			return { ids: [], limits: {} };
		}

		let effectiveApiKey: string | null = null;
		if (apiKey !== undefined && apiKey !== null) {
			effectiveApiKey = apiKey;
		} else {
			const decrypted = await this.plugin.decryptKeyFor(effectiveBaseURL);
			if (decrypted === null) {
				new Notice(
					`${this.plugin.APP_ABBREVIARTION} is locked. Run "Unlock API keys" to send credentials to this endpoint.`,
					10000,
				);
				return { ids: [], limits: {} };
			}
			effectiveApiKey = decrypted;
		}

		if (this.plugin.settings.debugToConsole) {
			this.plugin.log("availableModels", {
				provider: this.resolveProvider(effectiveBaseURL),
				endpoint: effectiveBaseURL,
				usingApiKey: Boolean(effectiveApiKey),
			});
		}

		return this.fetchAvailableModels(effectiveBaseURL, effectiveApiKey);
	};

	private fetchAvailableModels = async (
		effectiveBaseURL: string,
		effectiveApiKey: string | null,
	): Promise<{ ids: string[]; limits: Record<string, ModelLimit> }> => {
		// Anthropic native Models API: returns each model's max output tokens
		// and context window, which are persisted for the max tokens cascade
		if (this.resolveProvider(effectiveBaseURL) === "anthropic") {
			try {
				const client = this.createAnthropicClient(
					effectiveApiKey,
					effectiveBaseURL,
				);
				const models = await client.models.list();
				const ids: string[] = [];
				const limits: Record<string, ModelLimit> = {};
				// auto-pagination: iterates every page of the list
				for await (const model of models) {
					ids.push(model.id);
					const maxCompletionTokens = asPositiveNumber(model.max_tokens);
					const contextLength = asPositiveNumber(model.max_input_tokens);
					if (
						maxCompletionTokens !== undefined ||
						contextLength !== undefined
					) {
						limits[model.id] = {
							maxCompletionTokens,
							contextLength,
							fetchedAt: Date.now(),
						};
					}
				}
				if (this.plugin.settings.debugToConsole) {
					this.plugin.log("availableModels", {
						models: ids,
						limitsDetected: Object.keys(limits).length,
					});
				}
				return { ids, limits };
			} catch (error) {
				new Notice(
					`${this.plugin.APP_ABBREVIARTION} Error fetching models: ${String(error)}`,
					15000,
				);
				return { ids: [], limits: {} };
			}
		}

		try {
			const openai = this.createClient(effectiveApiKey, effectiveBaseURL);
			openai.baseURL = effectiveBaseURL;
			const models = await openai.models.list();

			// persist the token limits the endpoint reports, if any
			const limits: Record<string, ModelLimit> = {};
			for (const raw of models.data) {
				const limit = extractLimit(raw);
				if (limit) {
					limits[raw.id] = limit;
				}
			}
			if (this.plugin.settings.debugToConsole) {
				this.plugin.log("availableModels", {
					models: models.data,
					limitsDetected: Object.keys(limits).length,
				});
			}

			return { ids: models.data.map((model) => model.id), limits };
		} catch (error) {
			new Notice(
				`${this.plugin.APP_ABBREVIARTION} Error fetching models: ${String(error)}`,
				15000,
			);
			return { ids: [], limits: {} };
		}
	};
}
