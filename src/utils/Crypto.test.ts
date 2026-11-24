import { describe, expect, it } from "vitest";
import {
	decrypt,
	deriveKey,
	encrypt,
	fromBase64,
	isEncrypted,
	toBase64,
} from "./Crypto";

const randomKey = async (): Promise<CryptoKey> => {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return deriveKey("test-password", salt);
};

describe("encrypted blobs", () => {
	it("detects its own format", () => {
		expect(isEncrypted("plain-key")).toBe(false);
		expect(isEncrypted("enc:v1:abc:def:ghi")).toBe(true);
	});

	it("round-trips plaintext through AES-GCM", async () => {
		const key = await randomKey();
		const blob = await encrypt("sk-test-123", key);
		expect(blob.startsWith("enc:v1:")).toBe(true);
		await expect(decrypt(blob, key)).resolves.toBe("sk-test-123");
	});

	it("fails with a different key", async () => {
		const key = await randomKey();
		const otherKey = await deriveKey(
			"wrong-password",
			crypto.getRandomValues(new Uint8Array(16)),
		);
		const blob = await encrypt("sk-test-123", key);
		await expect(decrypt(blob, otherKey)).rejects.toThrow();
	});

	it("rejects malformed blobs", async () => {
		const key = await randomKey();
		await expect(decrypt("plain-key", key)).rejects.toThrow(
			"Value is not an encrypted blob",
		);
		await expect(decrypt("enc:v1:only-two-parts", key)).rejects.toThrow(
			"Malformed encrypted blob",
		);
	});

	it("preserves arbitrary binary-looking text through base64", () => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it("uses a fresh IV for every encryption", async () => {
		const key = await randomKey();
		const first = await encrypt("same-secret", key);
		const second = await encrypt("same-secret", key);
		expect(first).not.toBe(second);
	});
});
