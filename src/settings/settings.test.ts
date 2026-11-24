import { describe, expect, it } from "vitest";
import {
	apiTypeForEndpoint,
	DEFAULT_SETTINGS,
	manualMaxTokensFor,
	mergeModels,
	removeModelData,
	removeSavedModelList,
	renameModelData,
	renameSavedModelList,
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

describe("endpoint cache cleanup", () => {
	it("moves cached models when an endpoint is renamed", () => {
		const lists = [
			{
				endpoint: "https://old.example",
				models: ["model-a"],
				limits: { "model-a": { contextLength: 100 } },
			},
		];
		expect(
			renameSavedModelList(lists, "https://old.example", "https://new.example"),
		).toBe(true);
		expect(lists[0].endpoint).toBe("https://new.example");
		expect(savedModelListFor(lists, "https://new.example")?.models).toEqual([
			"model-a",
		]);
	});

	it("merges a renamed endpoint into an existing cache", () => {
		const lists = [
			{ endpoint: "https://old.example", models: ["model-a"] },
			{ endpoint: "https://new.example", models: ["model-b"] },
		];
		renameSavedModelList(lists, "https://old.example", "https://new.example");
		expect(lists).toHaveLength(1);
		expect(lists[0].models).toEqual(["model-b", "model-a"]);
	});

	it("removes a removed endpoint's cache", () => {
		const lists = [
			{ endpoint: "https://keep.example", models: ["model-a"] },
			{ endpoint: "https://remove.example", models: ["model-b"] },
		];
		expect(removeSavedModelList(lists, "https://remove.example")).toBe(true);
		expect(lists).toHaveLength(1);
		expect(lists[0].endpoint).toBe("https://keep.example");
	});
});

describe("model annotation cleanup", () => {
	it("moves annotations when a model is renamed", () => {
		const lists = [
			{
				endpoint: "https://a.example",
				models: ["old-model"],
				limits: { "old-model": { maxCompletionTokens: 100 } },
				manualLimits: { "old-model": 8192 },
			},
		];
		expect(
			renameModelData(lists, "https://a.example", "old-model", "new-model"),
		).toBe(true);
		expect(lists[0].models).toEqual(["old-model"]);
		expect(lists[0].limits).toEqual({
			"new-model": { maxCompletionTokens: 100 },
		});
		expect(lists[0].manualLimits).toEqual({ "new-model": 8192 });
	});

	it("removes annotations when a model is removed", () => {
		const lists = [
			{
				endpoint: "https://a.example",
				models: ["old-model"],
				limits: { "old-model": { maxCompletionTokens: 100 } },
				manualLimits: { "old-model": 8192 },
			},
		];
		expect(removeModelData(lists, "https://a.example", "old-model")).toBe(true);
		expect(lists[0].models).toEqual(["old-model"]);
		expect(lists[0].limits).toEqual({});
		expect(lists[0].manualLimits).toEqual({});
	});
});
