import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const id = z.string().trim().min(1).max(200);
const timestamp = z.string().datetime();
export const guideSourceSchema = z.object({ label: text, url: z.url().refine(value => new URL(value).protocol === "https:"), checkedAt: timestamp }).strict();
export const guidePricingSchema = z.object({
  currency: z.literal("USD"), input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative(),
  cacheRead: z.number().finite().nonnegative().optional(), cacheWrite: z.number().finite().nonnegative().optional(),
  source: guideSourceSchema,
}).strict();
export const guideAssessmentSchema = z.object({
  level: z.number().int().min(1).max(6), benchmark: text, benchmarkVersion: text,
  score: z.number().finite(), metric: text, effort: text, methodology: text,
  measuredAt: timestamp.nullable(), source: guideSourceSchema,
}).strict();
export const guideEstimateSchema = z.object({
  level: z.number().int().min(1).max(6),
  rangeLow: z.number().int().min(1).max(6), rangeHigh: z.number().int().min(1).max(6),
  confidence: z.enum(["low", "medium"]), rationale: text, methodology: text,
  estimatedAt: timestamp, sources: z.array(guideSourceSchema).min(1).max(5),
}).strict().superRefine((estimate, ctx) => {
  if (estimate.rangeLow > estimate.level || estimate.rangeHigh < estimate.level)
    ctx.addIssue({ code: "custom", message: "Estimate must lie within its uncertainty range" });
});
export const modelGuideCatalogSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().positive(), publishedAt: timestamp,
  // This URL is configured in the shipped file or environment, never accepted from a downloaded update.
  updateUrl: z.url().nullable(),
  providers: z.array(z.object({ providerID: id, billing: z.enum(["subscription", "metered", "unknown"]), note: text, source: guideSourceSchema }).strict()).max(500),
  models: z.array(z.object({
    providerID: id, modelID: id, summary: text.optional(), assessmentScope: z.enum(["model", "base-reference"]).optional(), source: guideSourceSchema,
    pricing: guidePricingSchema.optional(), reasoning: guideAssessmentSchema.optional(), agentic: guideAssessmentSchema.optional(),
    reasoningEstimate: guideEstimateSchema.optional(), agenticEstimate: guideEstimateSchema.optional(),
  }).strict()).max(20_000),
}).strict().superRefine((catalog, ctx) => {
  const providers = new Set<string>(); const models = new Set<string>();
  for (const p of catalog.providers) { if (providers.has(p.providerID)) ctx.addIssue({ code: "custom", message: "Duplicate provider" }); providers.add(p.providerID); }
  for (const m of catalog.models) { const key = JSON.stringify([m.providerID, m.modelID]); if (models.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate offering" }); models.add(key); }
});
export const guideObservationSchema = z.object({
  providerID: id, modelID: id, name: text, providerName: text,
  // null means unknown. Zero is accepted only when the engine explicitly supplied valid prices.
  pricing: z.object({ input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative(), cacheRead: z.number().finite().nonnegative().optional(), cacheWrite: z.number().finite().nonnegative().optional() }).strict().nullable(),
  freeVerified: z.boolean(), tools: z.boolean().nullable(), reasoning: z.boolean().nullable(),
  input: z.array(id).max(20), context: z.number().int().positive().nullable(),
  efforts: z.array(id).max(50),
}).strict();
export const guideDiscoverySchema = z.object({ scope: z.string().min(1).max(4096), models: z.array(guideObservationSchema).max(5000) }).strict();
export type ModelGuideCatalog = z.infer<typeof modelGuideCatalogSchema>;
export type GuideObservation = z.infer<typeof guideObservationSchema>;
export type GuideAssessment = z.infer<typeof guideAssessmentSchema>;
export type GuideEstimate = z.infer<typeof guideEstimateSchema>;
export type GuideModel = ModelGuideCatalog["models"][number];
export type GuideProvider = ModelGuideCatalog["providers"][number];
export type GuideSnapshot = {
  catalog: ModelGuideCatalog;
  observations: (GuideObservation & { firstSeen: string; lastSeen: string; available: boolean })[];
  status: { source: "bundled" | "remote"; checkedAt: string | null; updatedAt: string; error: string | null; remoteConfigured: boolean };
};
