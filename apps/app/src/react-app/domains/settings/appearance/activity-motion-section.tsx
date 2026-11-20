/** @jsxImportSource react */
import { Switch } from "@/components/ui/switch";
import { setActivityAnimationsEnabled, useActivityAnimations } from "@/app/lib/activity-motion";
import { t } from "@/i18n";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

/** "Animaciones de actividad": freeze the running-work marks to save CPU and GPU. */
export function ActivityMotionSection({ busy }: { busy: boolean }) {
  const { available, enabled } = useActivityAnimations();
  if (!available) return null;
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("activity_motion.section_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("activity_motion.section_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("activity_motion.toggle_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("activity_motion.toggle_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("activity_motion.toggle_title")}
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => setActivityAnimationsEnabled(checked)}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <p className="text-xs text-muted-foreground" data-activity-motion-impact>{t("activity_motion.impact")}</p>
      </LayoutSectionItem>
    </LayoutSection>
  );
}
