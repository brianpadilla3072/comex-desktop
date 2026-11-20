import { randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors.js";

/**
 * One-time codes that let another device (a phone, a laptop over Tailscale) get its own owner
 * token. The desktop shows a code; the browser redeems it once. Codes live only in memory, expire
 * in minutes, and a few wrong guesses burn the code, so the 8-character code cannot be brute
 * forced. The issued token is an ordinary revocable owner token (see tokens.ts).
 */
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
export const PAIRING_MAX_FAILURES = 5;
export const DEVICE_LABEL_PREFIX = "device:";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const redeemInput = z.object({
  code: z.string().trim().min(1).max(32),
  deviceName: z.string().trim().min(1).max(60),
});

type ActiveCode = { code: string; expiresAt: number; failures: number };

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sameCode(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createPairingRegistry(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let active: ActiveCode | null = null;
  return {
    /** A new code replaces any earlier one: only the last code shown is valid. */
    issue(): { code: string; expiresAt: number } {
      const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
      active = { code, expiresAt: now() + PAIRING_CODE_TTL_MS, failures: 0 };
      return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: active.expiresAt };
    },
    /** Consumes the code on success. Throws a Spanish ApiError the web shows as is. */
    consume(input: string): void {
      const current = active;
      if (!current || current.expiresAt <= now()) {
        active = null;
        throw new ApiError(410, "pairing_code_expired", "El código venció o ya se usó. Generá uno nuevo en la app de escritorio.");
      }
      if (!sameCode(normalizePairingCode(input), current.code)) {
        current.failures += 1;
        if (current.failures >= PAIRING_MAX_FAILURES) active = null;
        throw new ApiError(400, "pairing_code_invalid", "El código no es correcto. Revisalo y volvé a intentar.");
      }
      active = null;
    },
    cancel(): void { active = null; },
  };
}

export type PairingRegistry = ReturnType<typeof createPairingRegistry>;
