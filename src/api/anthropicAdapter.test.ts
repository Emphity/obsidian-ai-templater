import type AnthropicSdk from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam } from "openai/resources";
import { describe, expect, it } from "vitest";
import {
	anthropicToSimpleCompletion,
	messagesToAnthropic,
} from "./anthropicAdapter";

describe("messagesToAnthropic", () => {
	it("extracts system messages and merges consecutive turns", () => {
		const messages = [
			{ role: "system", content: "Be concise." },
			{ role: "user", content: "First question" },
			{ role: "user", content: "Additional detail" },
			{ role: "assistant", content: "First answer" },
		] as ChatCompletionMessageParam[];

		const draft = messagesToAnthropic("Default system", messages);
		expect(draft.system).toBe("Be concise.");
		expect(draft.messages).toEqual([
			{ role: "user", content: "First question\nAdditional detail" },
			{ role: "assistant", content: "First answer" },
		]);
	});

	it("uses the default system prompt when none was provided", () => {
		const draft = messagesToAnthropic("Default system", [
			{ role: "user", content: "Hello" },
		]);
		expect(draft.system).toBe("Default system");
		expect(draft.messages).toEqual([{ role: "user", content: "Hello" }]);
	});

	it("flattens text content parts", () => {
		const messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Hello " },
					{ type: "text", text: "world" },
				],
			},
		] as ChatCompletionMessageParam[];

		const draft = messagesToAnthropic("Default system", messages);
		expect(draft.messages).toEqual([{ role: "user", content: "Hello world" }]);
	});

	it("drops empty messages and unsupported roles", () => {
		const messages = [
			{ role: "user", content: "   " },
			{ role: "tool", content: "tool output" },
			{ role: "assistant", content: "Answer" },
		] as ChatCompletionMessageParam[];

		const draft = messagesToAnthropic("Default system", messages);
		expect(draft.messages).toEqual([{ role: "assistant", content: "Answer" }]);
	});
});

describe("anthropicToSimpleCompletion", () => {
	it("joins text blocks and normalizes usage", () => {
		const response = {
			content: [
				{ type: "text", text: "Hello " },
				{ type: "tool_use", id: "tool", name: "tool", input: {} },
				{ type: "text", text: "world" },
			],
			usage: { input_tokens: 3, output_tokens: 5 },
			stop_reason: "end_turn",
			model: "claude-test",
		} as AnthropicSdk.Message;

		const completion = anthropicToSimpleCompletion(response);
		expect(completion.content).toBe("Hello world");
		expect(completion.usage).toEqual({
			prompt_tokens: 3,
			completion_tokens: 5,
			total_tokens: 8,
		});
		expect(completion.stop_reason).toBe("end_turn");
		expect(completion.model).toBe("claude-test");
	});
});
