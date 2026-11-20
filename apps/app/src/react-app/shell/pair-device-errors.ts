import { OpenworkServerError } from "@/app/lib/openwork-server";
import { t } from "@/i18n";

/** The server's pairing errors are already Spanish sentences; anything else gets a generic line. */
export function describeError(error: unknown): string {
  if (error instanceof OpenworkServerError && error.message) return error.message;
  return t("pairing.failed");
}
