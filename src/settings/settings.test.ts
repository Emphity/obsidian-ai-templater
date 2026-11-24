import { describe, expect, it } from "vitest";
import {
	apiTypeForEndpoint,
	DEFAULT_SETTINGS,
	manualMaxTokensFor,
	mergeModels,
	sanitizeApiType,
	savedModelListFor,
} from "./settings";

describe("sanitizeApiType", () => {
	it("accepts only known values", () => {
		expect(sanitizeApiType("openai")).toBe("openai");
		expect(sanitizeApiType("anthropic")).toBe("anthropic");
		expect(sanitizeApiType("auto")).toBe("auto");
		expect(sanitizeApiType("unknown")).toBe("auto");
		expect(sanitizeApiType(null)).toBe("auto");
		expect(sanitizeApiType(undefined)).toBe("auto");
	});
});

describe("apiTypeForEndpoint", () => {
	it("uses the stored type and defaults to auto", () => {
		const endpoints = [
			{
				value: "https://a.example",
				alias: "",
				apiKey: "",
				apiType: "anthropic" as const,
			},
			{
				value: "https://b.example",
				alias: "",
				apiKey: "",
				apiType: "openai" as const,
			},
		];
		expect(apiTypeForEndpoint(endpoints, "https://a.example")).toBe(
			"anthropic",
		);
		expect(apiTypeForEndpoint(endpoints, "https://missing.example")).toBe(
			"auto",
		);
	});
});

describe("model list helpers", () => {
	it("finds a list by endpoint", () => {
		const lists = [
			{ endpoint: "https://a.example", models: ["model-a"] },
			{ endpoint: "https://b.example", models: ["model-b"] },
		];
		expect(savedModelListFor(lists, "https://b.example")?.models).toEqual([
			"model-b",
		]);
		expect(savedModelListFor(lists, "https://missing.example")).toBeUndefined();
	});

	it("merges and deduplicates models", () => {
		expect(mergeModels(["a", "b"], ["", "b", "c"])).toEqual(["a", "b", "c"]);
	});

	it("reads the informational per-model limit", () => {
		const lists = [
			{
				endpoint: "https://a.example",
				models: ["model-a"],
				manualLimits: { "model-a": 8192 },
			},
		];
		expect(manualMaxTokensFor(lists, "https://a.example", "model-a")).toBe(
			8192,
		);
		expect(
			manualMaxTokensFor(lists, "https://a.example", "missing"),
		).toBeUndefined();
		expect(
			manualMaxTokensFor(lists, "https://missing.example", "model-a"),
		).toBeUndefined();
	});

	it("exposes independent default arrays", () => {
		const first = {
			...DEFAULT_SETTINGS,
			savedModels: DEFAULT_SETTINGS.savedModels,
		};
		const second = {
			...DEFAULT_SETTINGS,
			savedModels: DEFAULT_SETTINGS.savedModels,
		};
		expect(first.savedModels).toEqual(second.savedModels);
	});
});
