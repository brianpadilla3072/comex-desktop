/** @jsxImportSource react */
import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { renderToStaticMarkup } = await import("react-dom/server");
const { ExtensionCard } = await import("../src/react-app/design-system/extension-card");
const { setLocale } = await import("../src/i18n");
afterAll(async () => { setLocale("en"); await GlobalRegistrator.unregister(); });

// In the two-column skills catalog, a card's minimum content width (name, description and two
// buttons) widened its grid column, and the Complementos page scrolled sideways. The card root
// must be allowed to shrink so the description truncates instead.
test("the card root can shrink inside a grid column", () => {
  const html = renderToStaticMarkup(<ExtensionCard name="Impeccable" description="Diseño UI/UX" iconSlug="skill" connected={false} />);
  const root = new DOMParser().parseFromString(html, "text/html").querySelector("[data-library-integrated-row]");
  expect(root?.className.split(/\s+/)).toContain("min-w-0");
});

test("the readiness status follows the interface language", () => {
  setLocale("es");
  const html = renderToStaticMarkup(<ExtensionCard name="Impeccable" description="Diseño UI/UX" iconSlug="skill" connected={false} />);
  expect(new DOMParser().parseFromString(html, "text/html").querySelector("[data-library-status]")?.textContent).toBe("Configurar");
  setLocale("en");
  const english = renderToStaticMarkup(<ExtensionCard name="Impeccable" description="Diseño UI/UX" iconSlug="skill" connected={false} />);
  expect(new DOMParser().parseFromString(english, "text/html").querySelector("[data-library-status]")?.textContent).toBe("Set up");
});
