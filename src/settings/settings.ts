// API dialect selection stored per endpoint; "auto" inspects the URL
// (api.anthropic.com => Anthropic, anything else => OpenAI-compatible)
export type ApiTypeSetting = "auto" | "openai" | "anthropic";

export const API_TYPE_OPTIONS: ApiTypeSetting[] = [
	"auto",
	"openai",
	"anthropic",
];

export const API_TYPE_LABELS: Record<ApiTypeSetting, string> = {
	auto: "Auto-detect",
	openai: "OpenAI compatible",
	anthropic: "Anthropic",
};

// accepts only the three known values; anything else falls back to "auto"
export const sanitizeApiType = (value: unknown): ApiTypeSetting =>
	value === "openai" || value === "anthropic" ? value : "auto";

export interface SavedEndpoint {
	value: string;
	alias: string;
	apiKey: string;
	apiType: ApiTypeSetting;
}

// stored api type for an endpoint ("auto" when absent)
export const apiTypeForEndpoint = (
	endpoints: SavedEndpoint[],
	endpoint: string,
): ApiTypeSetting =>
	endpoints.find((entry) => entry.value === endpoint)?.apiType ?? "auto";

// models fetched from an endpoint (or added manually), keyed by endpoint URL
export interface SavedModelList {
	endpoint: string;
	models: string[];
	fetchedAt?: number;
	// token limits per model id, when the endpoint reports them
	// (e.g. OpenRouter's context_length / top_provider.max_completion_tokens)
	limits?: Record<string, ModelLimit>;
	// max tokens per model id entered manually in settings (informational,
	// useful when the endpoint does not report the limits itself)
	manualLimits?: Record<string, number>;
}

// manual max tokens edited by the user for a model in settings, when any
export const manualMaxTokensFor = (
	lists: SavedModelList[],
	endpoint: string,
	model: string,
): number | undefined =>
	savedModelListFor(lists, endpoint)?.manualLimits?.[model];

// token limits for a single model as reported by the endpoint
export interface ModelLimit {
	// total context window (input + output), when reported
	contextLength?: number;
	// maximum completion (output) tokens, when reported
	maxCompletionTokens?: number;
	fetchedAt?: number;
}

export interface Settings {
	defaultEndpoint: string;
	defaultModel: string;
	savedEndpoints: SavedEndpoint[];
	savedModels: SavedModelList[];
	defaultApiKey: string;
	defaultMaxNumTokens: number;
	defaultMaxOutgoingCharacters: number;
	debugToConsole?: boolean;
	displayTokenUsageDesktop?: boolean;
	displayTokenUsageMobile?: boolean;
	defaultSystemMessage: string;
	// random PBKDF2 salt for the password-derived session key; it is not a
	// secret and is generated once per vault
	keySalt?: string;
}

export const savedModelListFor = (
	lists: SavedModelList[],
	endpoint: string,
): SavedModelList | undefined =>
	lists.find((list) => list.endpoint === endpoint);

export const mergeModels = (...sourceLists: string[][]): string[] => [
	...new Set(sourceLists.flat().filter(Boolean)),
];

// moves cached models/limits from an old endpoint URL to the renamed one. If
// the target already exists, both caches are merged and the source is removed.
export const renameSavedModelList = (
	lists: SavedModelList[],
	from: string,
	to: string,
): boolean => {
	const sourceIndex = lists.findIndex((list) => list.endpoint === from);
	if (sourceIndex === -1) return false;
	const source = lists[sourceIndex];
	if (from === to) return true;
	const targetIndex = lists.findIndex((list) => list.endpoint === to);
	if (targetIndex === -1) {
		source.endpoint = to;
		return true;
	}
	const target = lists[targetIndex];
	target.models = mergeModels(target.models, source.models);
	target.fetchedAt =
		target.fetchedAt && source.fetchedAt
			? Math.max(target.fetchedAt, source.fetchedAt)
			: (target.fetchedAt ?? source.fetchedAt);
	if (source.limits) {
		target.limits = { ...(target.limits ?? {}), ...source.limits };
	}
	if (source.manualLimits) {
		target.manualLimits = {
			...(target.manualLimits ?? {}),
			...source.manualLimits,
		};
	}
	lists.splice(sourceIndex, 1);
	return true;
};

// removes the cached model list and its limits/manual annotations
export const removeSavedModelList = (
	lists: SavedModelList[],
	endpoint: string,
): boolean => {
	const before = lists.length;
	const filtered = lists.filter((list) => list.endpoint !== endpoint);
	if (filtered.length === before) return false;
	lists.length = 0;
	lists.push(...filtered);
	return true;
};

// keeps a renamed model's informational/detected annotations attached to it
export const renameModelData = (
	lists: SavedModelList[],
	endpoint: string,
	from: string,
	to: string,
): boolean => {
	if (from === to) return true;
	const list = savedModelListFor(lists, endpoint);
	if (!list?.models.includes(from)) return false;
	if (list.limits?.[from] !== undefined) {
		list.limits = { ...list.limits };
		list.limits[to] = list.limits[from] as ModelLimit;
		delete list.limits[from];
	}
	if (list.manualLimits?.[from] !== undefined) {
		list.manualLimits = { ...list.manualLimits };
		list.manualLimits[to] = list.manualLimits[from] as number;
		delete list.manualLimits[from];
	}
	return true;
};

// removes a model's annotations; the model itself is removed by the caller
export const removeModelData = (
	lists: SavedModelList[],
	endpoint: string,
	model: string,
): boolean => {
	const list = savedModelListFor(lists, endpoint);
	if (!list?.models.includes(model)) return false;
	if (list.limits && list.limits[model] !== undefined) {
		const limits = { ...list.limits };
		delete limits[model];
		list.limits = limits;
	}
	if (list.manualLimits && list.manualLimits[model] !== undefined) {
		const manualLimits = { ...list.manualLimits };
		delete manualLimits[model];
		list.manualLimits = manualLimits;
	}
	return true;
};

export const DEFAULT_SETTINGS: Settings = {
	defaultEndpoint: "",
	defaultModel: "",
	savedEndpoints: [],
	savedModels: [],
	defaultApiKey: "",
	defaultMaxOutgoingCharacters: 4096,
	// 0 = auto: use the maximum detected for the selected model (when the
	// endpoint reports it); if nothing is detected, omit max_completion_tokens
	defaultMaxNumTokens: 0,
	debugToConsole: false,
	displayTokenUsageDesktop: true,
	displayTokenUsageMobile: false,
	defaultSystemMessage: "You are a helpful assistant.",
};
