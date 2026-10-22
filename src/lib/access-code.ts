import { createHash, randomInt } from "node:crypto";

// Crockford-style alphabet without look-alike characters (no I, L, O, U, 0, 1).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 16; // 16 × log2(30) ≈ 78 bits of entropy

/** A new random access code, e.g. "K7QM-2XTR-9HBD-PW4C". */
export function generateAccessCode(): string {
  let s = "";
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s.match(/.{4}/g)!.join("-");
}

/** Accept codes typed with spaces, dashes or lowercase. */
export function normaliseAccessCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function looksLikeAccessCode(normalised: string) {
  return normalised.length === LENGTH && [...normalised].every((c) => ALPHABET.includes(c));
}

/** Codes are high-entropy, so a plain SHA-256 is a safe one-way storage format. */
export function hashAccessCode(code: string): string {
  return createHash("sha256").update(`access-code:${normaliseAccessCode(code)}`).digest("hex");
}

export function codeHint(code: string) {
  return normaliseAccessCode(code).slice(-4);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(`session:${token}`).digest("hex");
}
