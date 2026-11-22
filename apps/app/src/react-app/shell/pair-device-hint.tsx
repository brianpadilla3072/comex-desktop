/** @jsxImportSource react */
import { Link } from "react-router";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";

/** In the web app, a read-only connection can get full access by pairing this browser. */
export function PairDeviceHint() {
  if (isDesktopRuntime()) return null;
  return <Link to="/pair" className="text-xs font-medium underline underline-offset-2" data-pair-device-hint>{t("pairing.hint")}</Link>;
}
