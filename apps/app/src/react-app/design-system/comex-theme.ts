/**
 * Tokens de tema propios de Comex para artefactos (issue #7).
 *
 * Capa declarativa mínima: define los tokens que cualquier renderer de
 * artefacto podrá consumir. No aplica ningún tema por sí sola, no cambia la
 * apariencia actual y no copia la paleta ni las tipografías de Claude Design.
 *
 * Los colores de superficie/texto/borde/acento y los radios referencian las
 * variables semánticas ya existentes en `apps/app/src/app/index.css` (DESIGN.md
 * V2 y V4), así que el tema por defecto hereda light/dark sin duplicar valores.
 * La tipografía es la pila del sistema (DESIGN.md V1), sin webfonts externas.
 */

export type ComexTheme = {
  readonly surface: string;
  readonly text: string;
  readonly border: string;
  readonly accent: string;
  readonly radii: {
    readonly control: string;
    readonly shell: string;
    readonly window: string;
  };
  readonly typography: {
    readonly fontFamily: string;
    readonly fontSize: {
      readonly xs: string;
      readonly sm: string;
      readonly base: string;
      readonly md: string;
      readonly lg: string;
      readonly xl: string;
    };
  };
  /** Colores categóricos para series de gráficos. Se mantienen iguales a los
   *  valores hardcodeados previos para que la migración no cambie lo visible. */
  readonly chartSeries: readonly [string, string, string, string];
};

const systemFontStack = '-apple-system, BlinkMacSystemFont, system-ui, ui-sans-serif, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const chartSeries: ComexTheme["chartSeries"] = ["#2563eb", "#dc2626", "#059669", "#d97706"];

export const comexDefaultTheme: ComexTheme = {
  surface: "var(--dls-surface)",
  text: "var(--dls-text-primary)",
  border: "var(--dls-border)",
  accent: "var(--dls-accent)",
  radii: {
    control: "var(--radius)",
    shell: "var(--dls-radius)",
    window: "var(--dls-radius-lg)",
  },
  typography: {
    fontFamily: systemFontStack,
    fontSize: {
      xs: "0.75rem",
      sm: "0.8125rem",
      base: "0.8125rem",
      md: "0.875rem",
      lg: "1rem",
      xl: "1.25rem",
    },
  },
  chartSeries,
};
