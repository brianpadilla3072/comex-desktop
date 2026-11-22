import type { GuideModel, GuideObservation } from "@openwork/types/model-guide";

/** Guidance from published capabilities, never a made-up task benchmark. */
export function modelUsageHints(model?: GuideModel, observation?: GuideObservation) {
  const hints: string[] = [];
  const lower = model?.reasoning?.level ?? model?.reasoningEstimate?.rangeLow;
  if (lower !== undefined && lower >= 4) hints.push("Análisis y revisión de problemas complejos");
  else if (lower !== undefined) hints.push("Borradores, resúmenes y tareas sencillas");
  if (observation?.input.includes("image")) hints.push("Trabajar con imágenes adjuntas");
  if (observation?.tools) hints.push("Usar herramientas del proyecto");
  return hints.slice(0, 3);
}
