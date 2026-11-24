// fetch implementation backed by Obsidian's requestUrl, which performs the
// request from the main process and is not subject to CORS restrictions
import { requestUrl } from "obsidian";
import { ANONYMOUS_API_KEY } from "./provider";

const isAnonymousAuthorization = (value: string | undefined): boolean =>
	value === ANONYMOUS_API_KEY || value === `Bearer ${ANONYMOUS_API_KEY}`;

export const obsidianFetch = async (
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
	// unauthenticated requests must not carry a placeholder credential
	if (isAnonymousAuthorization(headers.authorization)) {
		delete headers.authorization;
	}
	if (headers["x-api-key"] === ANONYMOUS_API_KEY) {
		delete headers["x-api-key"];
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
