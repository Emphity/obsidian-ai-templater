import { describe, expect, it } from "vitest";
import {
	ANONYMOUS_API_KEY,
	normalizeAnthropicBaseURL,
	providerForEndpoint,
} from "./provider";

describe("providerForEndpoint", () => {
	it("honors the explicit endpoint type", () => {
		expect(providerForEndpoint("https://example.com/v1", "openai")).toBe(
			"openai",
		);
		expect(providerForEndpoint("https://example.com/v1", "anthropic")).toBe(
			"anthropic",
		);
	});

	it("detects native Anthropic endpoints by hostname", () => {
		expect(providerForEndpoint("https://api.anthropic.com/v1")).toBe(
			"anthropic",
		);
		expect(providerForEndpoint("https://api.openai.com/v1")).toBe("openai");
		expect(providerForEndpoint("https://openrouter.ai/api/v1")).toBe("openai");
	});

	it("falls back to OpenAI-compatible for invalid URLs", () => {
		expect(providerForEndpoint("not a url")).toBe("openai");
	});
});

describe("normalizeAnthropicBaseURL", () => {
	it("removes the /v1 suffix added for OpenAI-compatible endpoints", () => {
		expect(normalizeAnthropicBaseURL("https://api.anthropic.com/v1/")).toBe(
			"https://api.anthropic.com",
		);
		expect(normalizeAnthropicBaseURL("https://api.anthropic.com/v1")).toBe(
			"https://api.anthropic.com",
		);
	});

	it("keeps other paths and handles empty URLs", () => {
		expect(normalizeAnthropicBaseURL("https://proxy.example/anthropic/")).toBe(
			"https://proxy.example/anthropic",
		);
		expect(normalizeAnthropicBaseURL("")).toBeUndefined();
	});
});

describe("anonymous credentials", () => {
	it("has a sentinel that can be stripped by the transport", () => {
		expect(ANONYMOUS_API_KEY.length).toBeGreaterThan(0);
		expect(ANONYMOUS_API_KEY).not.toContain(" ");
	});
});
