import { describe, expect, it } from "vitest";
import {
	decodeKeySalt,
	decrypt,
	deriveKey,
	encrypt,
	encryptLegacy,
	fromBase64,
	generateKeySalt,
	isEncrypted,
	isLegacyEncrypted,
	KEY_SALT_LENGTH,
	toBase64,
} from "./Crypto";

const randomKey = async (): Promise<CryptoKey> => {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return deriveKey("test-password", salt);
};

describe("encrypted blobs", () => {
	it("detects current and legacy formats", () => {
		expect(isEncrypted("plain-key")).toBe(false);
		expect(isEncrypted("enc:v1:abc:def:ghi")).toBe(true);
		expect(isEncrypted("enc:v2:abc:def")).toBe(true);
		expect(isLegacyEncrypted("enc:v1:abc:def:ghi")).toBe(true);
		expect(isLegacyEncrypted("enc:v2:abc:def")).toBe(false);
	});

	it("round-trips plaintext through AES-GCM v2", async () => {
		const key = await randomKey();
		const blob = await encrypt("sk-test-123", key);
		expect(blob.startsWith("enc:v2:")).toBe(true);
		await expect(decrypt(blob, key)).resolves.toBe("sk-test-123");
	});

	it("decrypts legacy v1 blobs with their fixed-salt key", async () => {
		const key = await deriveKey("old-password", new Uint8Array(16));
		const blob = await encryptLegacy("sk-legacy-123", key);
		expect(blob.startsWith("enc:v1:")).toBe(true);
		await expect(decrypt(blob, key)).resolves.toBe("sk-legacy-123");
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
		await expect(decrypt("enc:v2:only-two-parts", key)).rejects.toThrow(
			"Malformed encrypted blob",
		);
	});

	it("isolates the vault through the v2 salt", async () => {
		const password = "same-password";
		const sessionKey = await deriveKey(password, generateKeySalt());
		const legacyKey = await deriveKey(password, new Uint8Array(16));
		const blob = await encryptLegacy("sk-legacy-123", legacyKey);
		await expect(decrypt(blob, sessionKey)).rejects.toThrow();
	});

	it("preserves arbitrary binary-looking text through base64", () => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it("validates the persisted v2 key salt", () => {
		const salt = generateKeySalt();
		expect(salt).toHaveLength(KEY_SALT_LENGTH);
		expect(decodeKeySalt(toBase64(salt))).toEqual(salt);
		expect(decodeKeySalt(toBase64(new Uint8Array(16)))).toBeUndefined();
		expect(decodeKeySalt("not-base64!")).toBeUndefined();
		expect(decodeKeySalt(undefined)).toBeUndefined();
	});

	it("uses a fresh IV for every encryption", async () => {
		const key = await randomKey();
		const first = await encrypt("same-secret", key);
		const second = await encrypt("same-secret", key);
		expect(first).not.toBe(second);
	});
});
