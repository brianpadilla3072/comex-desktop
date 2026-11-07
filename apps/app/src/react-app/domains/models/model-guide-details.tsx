import { useEffect, useRef } from "react";
import { ModelValueGraphic } from "./model-guide-value";
import { X } from "lucide-react";
import type { GuideAssessment, GuideEstimate, GuideModel, GuideObservation, GuideProvider, GuideSnapshot } from "@openwork/types/model-guide";
import type { ModelOption } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function guideOffering(option: ModelOption, snapshot?: GuideSnapshot) {
  return {
    model: snapshot?.catalog.models.find(row => row.providerID === option.providerID && row.modelID === option.modelID),
    provider: snapshot?.catalog.providers.find(row => row.providerID === option.providerID),
    observation: option.guideObservation ?? snapshot?.observations.find(row => row.providerID === option.providerID && row.modelID === option.modelID),
  };
}
export function guideBillingLabel(providerID: string, provider?: GuideProvider, observation?: GuideObservation, model?: GuideModel) {
  if (providerID === "opencode-go") return "Go · suscripción";
  if (provider?.billing === "subscription") return "Suscripción";
  const price = model?.pricing ?? observation?.pricing;
  if (model?.pricing ? price?.input === 0 && price.output === 0 && price.cacheRead === 0 && price.cacheWrite === 0 : observation?.freeVerified) return "Gratis con límites";
  if (price || provider?.billing === "metered") return "Pago por uso";
  return "Costo sin verificar";
}
const barColors = ["bg-emerald-500", "bg-lime-500", "bg-yellow-500", "bg-amber-500", "bg-orange-500", "bg-red-500"];
const heights = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3", "h-3.5"];
export function ReasoningBars({ level, reference = false, estimated = false }: { level?: number; reference?: boolean; estimated?: boolean }) {
  if (!level) return <span className="text-xs text-muted-foreground" aria-label="Capacidad general: sin evaluar">Sin datos</span>;
  return <span className="inline-flex shrink-0 items-center gap-1" aria-label={`${estimated ? "Estimación de capacidad general" : reference ? "Referencia del modelo base" : "Capacidad general"}: ${level} de 6`}>
    <span className="inline-flex h-3.5 items-end gap-px" aria-hidden="true">{barColors.map((color, index) => <span key={color} className={`w-0.5 rounded-sm ${heights[index]} ${index < level ? color : "bg-muted-foreground/25"}`} />)}</span>
  </span>;
}
function Assessment({ label, assessment, estimate }: { label: string; assessment?: GuideAssessment; estimate?: GuideEstimate }) {
  if (!assessment && estimate) return <div className="space-y-1">
    <p className="font-medium">{label}: ≈{estimate.level}/6 · Estimación</p>
    <p className="text-muted-foreground">Rango {estimate.rangeLow}–{estimate.rangeHigh}/6 · Confianza {estimate.confidence === "medium" ? "media" : "baja"}</p>
    <details className="text-muted-foreground"><summary className="cursor-pointer">Ver criterio y fuentes</summary><div className="mt-1 space-y-1">
      <p>{estimate.rationale}</p><p>{estimate.methodology}</p>
      {estimate.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block underline underline-offset-2">{source.label} · Consultado el {new Date(source.checkedAt).toLocaleDateString("es-AR")}</a>)}
    </div></details>
  </div>;
  return <div className="space-y-1"><p className="font-medium">{label}: {assessment ? `${assessment.level}/6` : "Sin evaluar"}</p>{assessment && <details className="text-xs text-muted-foreground">
    <summary className="cursor-pointer">Ver evaluación y fuente</summary>
    <div className="mt-1 space-y-1">
      <p>{assessment.benchmark} {assessment.benchmarkVersion}: {assessment.score} {assessment.metric}. Esfuerzo: {assessment.effort}.</p>
      <p>{assessment.methodology}</p>
      <a href={assessment.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{assessment.source.label} · {assessment.measuredAt ? `Evaluado el ${new Date(assessment.measuredAt).toLocaleDateString("es-AR")}` : `Consultado el ${new Date(assessment.source.checkedAt).toLocaleDateString("es-AR")}`}</a>
    </div>
  </details>}</div>;
}
export function ModelGuideBody({ option, model, provider, observation, snapshot, onClose }: { onClose?: () => void; option: ModelOption; model?: GuideModel; provider?: GuideProvider; observation?: GuideObservation; snapshot?: GuideSnapshot }) {
  const price = model?.pricing ?? observation?.pricing;
  const lastSeen = snapshot?.observations.find(row => row.providerID === option.providerID && row.modelID === option.modelID)?.lastSeen;
  const subscription = provider?.billing === "subscription" || option.providerID === "opencode-go";
  const displayPrice = (value: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 6 }).format(value);
  return <div className="space-y-2 text-xs" data-testid="model-guide-body">
    <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{option.title}</p><p className="text-muted-foreground">{option.description ?? option.providerID}</p></div>{onClose && <Button type="button" variant="ghost" size="icon-sm" className="size-6" aria-label="Cerrar información del modelo" onClick={onClose}><X aria-hidden="true" className="size-3.5" /></Button>}</div>
    <p className="font-medium">{guideBillingLabel(option.providerID, provider, observation, model)}</p>
    <ModelValueGraphic option={option} model={model} observation={observation} provider={provider} snapshot={snapshot} />
    <details><summary className="cursor-pointer text-muted-foreground">Ver capacidades y fuentes</summary><div className="mt-2 space-y-2">
    <div className="space-y-1"><p className="font-medium">{guideBillingLabel(option.providerID, provider, observation, model)}</p>
      {price ? <p>Referencia: US$ {displayPrice(price.input)} entrada / US$ {displayPrice(price.output)} salida por millón de tokens.</p>
        : <p className="text-muted-foreground">Precio por token sin verificar.</p>}
    </div>
    <Assessment label={model?.assessmentScope === "base-reference" ? "Capacidad del modelo base*" : "Capacidad general"} assessment={model?.reasoning} estimate={model?.reasoningEstimate} />
    <Assessment label="Desempeño con agentes" assessment={model?.agentic} estimate={model?.agenticEstimate} />
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Herramientas</dt><dd>{observation?.tools === true ? "Admite herramientas; autonomía sin verificar" : observation?.tools === false ? "No declaradas" : "Sin verificar"}</dd>
      <dt className="text-muted-foreground">Entradas</dt><dd>{observation?.input.length ? observation.input.map(kind => ({ text: "Texto", image: "Imágenes", audio: "Audio", video: "Video", pdf: "PDF" })[kind] ?? kind).join(", ") : "Sin verificar"}</dd>
      <dt className="text-muted-foreground">Contexto</dt><dd>{observation?.context ? `${observation.context.toLocaleString("es-AR")} tokens` : "Sin verificar"}</dd>
      <dt className="text-muted-foreground">Esfuerzo</dt><dd className="break-words">{observation?.efforts.length ? observation.efforts.join(", ") : "Sin opciones declaradas"}</dd>
    </dl>
    {model?.summary && <p className="text-xs">{model.summary}</p>}
    </div></details>
    <details className="text-muted-foreground"><summary className="cursor-pointer">Condiciones y actualización</summary><div className="mt-1 space-y-1">
      {provider && <p>{provider.note}</p>}
      {subscription && price && <p>La tarifa de referencia no es una estimación de tu factura de Go.</p>}
      {price && <p>{price.cacheRead !== undefined ? `Caché lectura: US$ ${displayPrice(price.cacheRead)}. ` : ""}{price.cacheWrite !== undefined ? `Caché escritura: US$ ${displayPrice(price.cacheWrite)}.` : ""}</p>}
      {model?.pricing ? <a href={model.pricing.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">Precio verificado el {new Date(model.pricing.source.checkedAt).toLocaleDateString("es-AR")}</a> : observation?.pricing ? <p>Precio informado por el motor; puede variar por contexto, herramientas o condiciones del proveedor.</p> : null}
    {(model?.source ?? provider?.source) && <a href={(model?.source ?? provider?.source)?.url} target="_blank" rel="noreferrer" className="block text-xs underline underline-offset-2">Consultar fuente del catálogo</a>}
    <p className="text-xs text-muted-foreground">{snapshot ? `Catálogo r${snapshot.catalog.revision} · ${snapshot.status.source === "bundled" ? "Incluido en la aplicación" : "Actualizado desde JSON"} · ${new Date(snapshot.catalog.publishedAt).toLocaleDateString("es-AR")}` : "Catálogo no disponible; mostrando datos de esta conexión."}</p>
    {lastSeen && <p className="text-xs text-muted-foreground">Detectado el {new Date(lastSeen).toLocaleString("es-AR")}</p>}
    </div></details>
    {snapshot?.status.error && <p role="status" className="text-xs text-muted-foreground">{snapshot.status.error}</p>}
  </div>;
}
export function ModelGuideDetails({ option, snapshot, open, onOpenChange, onHover }: { option: ModelOption; snapshot?: GuideSnapshot; open: boolean; onOpenChange: (open: boolean) => void; onHover: () => void }) {
  const offering = guideOffering(option, snapshot);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  return <Popover open={open} onOpenChange={(value, details) => { if (!value && details.reason === "trigger-press") { details.cancel(); return; } onOpenChange(value); }}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`Ver información de ${option.title}`} className="h-6 shrink-0 px-0.5" title="Las barras muestran inteligencia general; abrí la ficha para comparar el costo." onMouseEnter={() => { cancelHover(); hoverTimer.current = setTimeout(onHover, 250); }} onMouseLeave={cancelHover} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }} onClick={event => event.stopPropagation()} />}>
      <ReasoningBars level={offering.model?.reasoning?.level ?? offering.model?.reasoningEstimate?.level} reference={offering.model?.assessmentScope === "base-reference"} estimated={!offering.model?.reasoning && !!offering.model?.reasoningEstimate} />
    </PopoverTrigger>
    <PopoverContent side="right" align="start" className="w-72 gap-2 rounded-xl p-3" aria-label={`Información de ${option.title}`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <ModelGuideBody option={option} snapshot={snapshot} onClose={() => onOpenChange(false)} {...offering} />
    </PopoverContent>
  </Popover>;
}
