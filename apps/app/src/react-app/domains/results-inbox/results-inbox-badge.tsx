/** @jsxImportSource react */
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { resultsInboxBadge } from "./results-inbox-model";

/** The nav entry's accessible name: says how many results are unread. */
export function resultsInboxNavLabel(unread: number | null | undefined): string {
  return unread && unread > 0 ? t("results_inbox.nav_unread", { count: unread }) : t("results_inbox.nav");
}

/** Unread count next to the inbox entry. Decorative: the entry's label already says it. */
export function ResultsInboxBadge({ count, compact = false, className }: { count: number | null | undefined; compact?: boolean; className?: string }) {
  const text = resultsInboxBadge(count ?? 0);
  if (!text) return null;
  return <span aria-hidden data-results-inbox-badge={text}
    className={cn(
      "inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-4 text-primary-foreground tabular-nums",
      compact && "absolute -top-0.5 -right-0.5",
      className,
    )}>{text}</span>;
}
