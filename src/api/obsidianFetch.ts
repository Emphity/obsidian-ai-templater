// fetch implementation backed by Obsidian's requestUrl, which performs the
// request from the main process and is not subject to CORS restrictions.
// requestUrl has no native AbortSignal support, so cancellation is cooperative:
// the fetch promise rejects promptly, but the underlying request cannot be
// detached.
import { requestUrl } from "obsidian";
import { ANONYMOUS_API_KEY } from "./provider";

const isAnonymousAuthorization = (value: string | undefined): boolean =>
	value === ANONYMOUS_API_KEY || value === `Bearer ${ANONYMOUS_API_KEY}`;

const abortError = (): Error => {
	if (typeof DOMException === "function") {
		return new DOMException("The request was aborted.", "AbortError");
	}
	const error = new Error("The request was aborted.");
	error.name = "AbortError";
	return error;
};

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

	const request = requestUrl({
		url,
		method: init?.method ?? "GET",
		headers,
		body: body as string | undefined,
		throw: false,
	});
	const signal = init?.signal;
	if (!signal) {
		const response = await request;
		return new Response(response.text, {
			status: response.status,
			headers: response.headers,
		});
	}

	// honor SDK timeouts and AbortController signals as soon as possible
	return new Promise<Response>((resolve, reject) => {
		let finished = false;
		const onAbort = (): void => {
			if (finished) return;
			finished = true;
			reject(abortError());
		};
		const cleanup = (): void => {
			signal.removeEventListener("abort", onAbort);
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		request
			.then((response) => {
				if (finished) return;
				finished = true;
				resolve(
					new Response(response.text, {
						status: response.status,
						headers: response.headers,
					}),
				);
			})
			.catch((error: unknown) => {
				if (finished) return;
				finished = true;
				reject(error);
			})
			.finally(cleanup);
	});
};
