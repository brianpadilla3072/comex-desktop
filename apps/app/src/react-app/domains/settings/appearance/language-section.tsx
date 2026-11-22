/** @jsxImportSource react */
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGE_OPTIONS, t } from "@/i18n";
import type { AppearanceViewProps } from "../pages/appearance-view";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "../settings-layout";

interface LanguageSectionProps extends Pick<AppearanceViewProps, "busy" | "language" | "setLanguage"> {}

export function LanguageSection(props: LanguageSectionProps) {
  return (
    <LayoutSectionItem anchor="language">
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{t("settings.language")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{t("settings.language.description")}</LayoutSectionItemDescription>

        <LayoutSectionItemHeaderActions>
          <div className="w-64 max-w-full">
            <Select
              value={props.language}
              // The trigger shows each language in its own name, like the list does.
              items={LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: option.nativeName }))}
              onValueChange={(value) => {
                if (value) props.setLanguage(value);
              }}
              disabled={props.busy}
            >
              <SelectTrigger className="w-full" aria-label={t("settings.language")}>
                <SelectValue placeholder={t("settings.language")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.nativeName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
    </LayoutSectionItem>
  );
}
