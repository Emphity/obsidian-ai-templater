// Encryption helpers for storing API keys at rest. Uses the Web Crypto API:
// PBKDF2-SHA256 to derive an AES-GCM key from a user password, then AES-GCM
// to encrypt. The persisted blob format is versioned:
//   enc:v1:<base64 salt>:<base64 iv>:<base64 ciphertext>
// salt and iv are generated fresh on every encryption.

const LEGACY_BLOB_PREFIX = "enc:v1:";
const BLOB_PREFIX = "enc:v2:";
const PBKDF2_ITERATIONS = 210_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
// PBKDF2 salt used by the v2 session key; unlike the legacy v1 salt this one
// is random, unique to the vault, and persisted outside the encrypted blobs
export const KEY_SALT_LENGTH = 32;

export const isEncrypted = (value: string): boolean =>
	value.startsWith(LEGACY_BLOB_PREFIX) || value.startsWith(BLOB_PREFIX);

// v1 blobs used a fixed all-zero KDF salt; they can only be decrypted with a
// legacy key. New blobs use the vault-specific session key.
export const isLegacyEncrypted = (value: string): boolean =>
	value.startsWith(LEGACY_BLOB_PREFIX);

export const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

export const fromBase64 = (value: string): Uint8Array => {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

const randomBytes = (length: number): Uint8Array =>
	crypto.getRandomValues(new Uint8Array(length));

// generates the persistent vault salt used to derive the v2 session key
export const generateKeySalt = (): Uint8Array => randomBytes(KEY_SALT_LENGTH);

// accepts only a base64 value of exactly KEY_SALT_LENGTH bytes
export const decodeKeySalt = (value: unknown): Uint8Array | undefined => {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const salt = fromBase64(value);
		return salt.length === KEY_SALT_LENGTH ? salt : undefined;
	} catch {
		return undefined;
	}
};

// derives an AES-GCM 256 key from the password and a per-blob salt
export const deriveKey = async (
	password: string,
	salt: Uint8Array,
): Promise<CryptoKey> => {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
};

export const encrypt = async (
	plaintext: string,
	key: CryptoKey,
): Promise<string> => {
	const iv = randomBytes(IV_LENGTH);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv as BufferSource },
			key,
			new TextEncoder().encode(plaintext),
		),
	);
	return `${BLOB_PREFIX}${toBase64(iv)}:${toBase64(ciphertext)}`;
};

// compatibility helper for v1 data: legacy blobs carried a per-blob salt, but
// decryption ignored it because the unlock key was derived from a fixed salt
export const encryptLegacy = async (
	plaintext: string,
	key: CryptoKey,
): Promise<string> => {
	const iv = randomBytes(IV_LENGTH);
	const salt = randomBytes(SALT_LENGTH);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv as BufferSource },
			key,
			new TextEncoder().encode(plaintext),
		),
	);
	return `${LEGACY_BLOB_PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(ciphertext)}`;
};

export const decrypt = async (
	blob: string,
	key: CryptoKey,
): Promise<string> => {
	if (!isEncrypted(blob)) {
		throw new Error("Value is not an encrypted blob");
	}
	if (blob.startsWith(BLOB_PREFIX)) {
		const parts = blob.slice(BLOB_PREFIX.length).split(":");
		if (parts.length !== 2) {
			throw new Error("Malformed encrypted blob");
		}
		const [iv, ciphertext] = parts;
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
			key,
			fromBase64(ciphertext) as BufferSource,
		);
		return new TextDecoder().decode(plaintext);
	}

	const parts = blob.slice(LEGACY_BLOB_PREFIX.length).split(":");
	if (parts.length !== 3) {
		throw new Error("Malformed encrypted blob");
	}
	const [, iv, ciphertext] = parts;
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
		key,
		fromBase64(ciphertext) as BufferSource,
	);
	return new TextDecoder().decode(plaintext);
};
