import type { GuideModel, GuideObservation, GuideProvider, GuideSnapshot } from "@openwork/types/model-guide";
import type { ModelOption } from "@/app/types";

/** A fixed workload makes prices comparable without treating an ordinal intelligence level as a ratio. */
export function referenceCost(price?: { input: number; output: number } | null) {
  return price ? price.input + price.output / 4 : null;
}
function capability(model?: GuideModel) {
  return model?.reasoning?.level ?? model?.reasoningEstimate?.level;
}
function comparable(a: GuideModel | undefined, b: GuideModel) {
  if (a?.reasoning && b.reasoning) return a.reasoning.benchmark === b.reasoning.benchmark && a.reasoning.benchmarkVersion === b.reasoning.benchmarkVersion && a.reasoning.metric === b.reasoning.metric && a.reasoning.methodology === b.reasoning.methodology;
  return !a?.reasoning && !b.reasoning && !!a?.reasoningEstimate && a.reasoningEstimate.methodology === b.reasoningEstimate?.methodology;
}

export function modelValueComparison(option: ModelOption, model?: GuideModel, observation?: GuideObservation, snapshot?: GuideSnapshot) {
  const price = model?.pricing ?? observation?.pricing;
  const cost = referenceCost(price);
  const level = capability(model);
  const peers = snapshot?.observations.filter(row => row.available && row.providerID === option.providerID && row.modelID !== option.modelID).flatMap(row => {
    const entry = snapshot.catalog.models.find(item => item.providerID === row.providerID && item.modelID === row.modelID);
    const peerCost = referenceCost(entry?.pricing ?? row.pricing);
    const peerLevel = capability(entry);
    return entry && comparable(model, entry) && peerCost !== null && peerLevel ? [{ name: row.name, cost: peerCost, level: peerLevel, lower: entry.reasoning?.score ?? entry.reasoningEstimate?.rangeLow, score: entry.reasoning?.score }] : [];
  }) ?? [];
  // Use conservative range endpoints for estimates. Overlapping ranges cannot justify a better-value claim.
  const lower = model?.reasoning?.score ?? model?.reasoningEstimate?.rangeLow;
  const alternatives = cost === null || lower === undefined ? [] : peers.filter(peer => {
    const upper = model?.reasoning?.score ?? model?.reasoningEstimate?.rangeHigh;
    return peer.lower !== undefined && upper !== undefined && peer.lower >= upper && peer.cost < cost;
  }).sort((a, b) => a.cost - b.cost);
  const cheaper = cost === null ? [] : peers.filter(peer => peer.cost < cost).sort((a, b) => b.level - a.level || (b.score ?? 0) - (a.score ?? 0) || a.cost - b.cost).slice(0, 2);
  return { cost, level, peers, alternative: alternatives[0], cheaper };
}

export function ModelValueGraphic({ option, model, observation, provider, snapshot }: { option: ModelOption; model?: GuideModel; observation?: GuideObservation; provider?: GuideProvider; snapshot?: GuideSnapshot }) {
  const { cost, level, peers, alternative, cheaper } = modelValueComparison(option, model, observation, snapshot);
  const estimated = !model?.reasoning && !!model?.reasoningEstimate;
  const subscription = option.providerID === "opencode-go" || provider?.billing === "subscription";
  const costLabel = cost === null ? "Sin verificar" : cost === 0 ? "Sin cargo por uso" : cost <= 0.5 ? "Bajo" : cost <= 2 ? "Medio" : "Alto";
  const intelligenceLabel = level ? ["", "Básica", "Sencilla", "Intermedia", "Alta", "Muy alta", "Muy alta"][level] : "Sin evaluar";
  // Fixed across providers and data coverage; points above the range sit at the labeled cap.
  const x = (value: number) => 12 + 218 * Math.log1p(Math.min(10, value)) / Math.log1p(10);
  const y = (value: number) => 112 - (value - 1) * 19;
  const conclusion = !level ? "Inteligencia sin evaluar" : cost === null ? "Costo pendiente de verificar" : `${intelligenceLabel === "Alta" || intelligenceLabel === "Muy alta" ? "Alta capacidad" : "Capacidad " + intelligenceLabel.toLowerCase()} · ${cost === 0 ? "sin cargo por uso" : "costo " + costLabel.toLowerCase()}`;
  return <div className="space-y-1.5" data-testid="model-value-graphic">
    <p className="font-medium">{conclusion}</p>
    <div className="flex justify-between gap-3">
      <div><p className="text-muted-foreground">Inteligencia</p><p className="font-medium">{intelligenceLabel}{level ? ` · ${estimated ? "≈" : ""}${level}/6` : ""}</p></div>
      <div className="text-right"><p className="text-muted-foreground">{subscription ? "Consumo en Go" : "Costo de uso"}</p><p className="font-medium">{costLabel}</p></div>
    </div>
    {level && cost !== null ? <figure className="space-y-1">
      <p className="text-muted-foreground">Más inteligente ↑</p>
      <svg viewBox="0 0 244 126" role="img" aria-label={`${option.title}: inteligencia ${estimated ? "estimada " : ""}${level} de 6; costo de referencia ${costLabel.toLowerCase()}. Más arriba y a la izquierda es mejor.`} className="h-28 w-full overflow-visible">
        <path d="M12 8V114H234" fill="none" stroke="currentColor" className="text-border" />
        <path d="M12 65H234M121 8V114" fill="none" stroke="currentColor" strokeDasharray="3 4" className="text-border" />
        {peers.map((peer, index) => <circle key={index} cx={x(peer.cost)} cy={y(peer.level)} r="2.5" fill="currentColor" className="text-muted-foreground/40"><title>{peer.name}: {peer.level}/6 · US$ {peer.cost.toFixed(4)} por el ejemplo de uso</title></circle>)}
        {estimated && model.reasoningEstimate && <path d={`M${x(cost)} ${y(model.reasoningEstimate.rangeLow)}V${y(model.reasoningEstimate.rangeHigh)}`} stroke="currentColor" strokeDasharray="2 3" className="text-primary/50" />}
        <circle cx={x(cost)} cy={y(level)} r="6" fill="currentColor" stroke="var(--background)" strokeWidth="2" className="text-primary" />
      </svg>
      <div className="flex justify-between text-muted-foreground"><span>← Más barato</span><span>Más caro · US$ 10+</span></div>
      <figcaption className="text-muted-foreground">Punto grande: este modelo{peers.length ? ` · ${peers.length} alternativas comparables` : ""}{estimated ? " · Estimado" : ""}</figcaption>
    </figure> : <p className="text-muted-foreground">{!level ? "Falta una evaluación de inteligencia para ubicarlo." : "Falta un precio comparable para ubicarlo."}</p>}
    {estimated && model.reasoningEstimate && <p className="text-muted-foreground">Estimación · Rango {model.reasoningEstimate.rangeLow}–{model.reasoningEstimate.rangeHigh}/6 · Confianza {model.reasoningEstimate.confidence === "medium" ? "media" : "baja"}</p>}
    {alternative && <p className="font-medium">{alternative.name}: menor costo y {estimated ? "rango estimado igual o superior" : "puntuación publicada igual o mayor"}.</p>}
    {cheaper.length > 0 && <div className="space-y-1" aria-label="Alternativas de menor costo"><p className="text-muted-foreground">Alternativas de menor costo</p>{cheaper.map(peer => <div key={peer.name} className="flex justify-between gap-2"><span className="min-w-0 truncate" title={peer.name}>{peer.name}</span><span className="shrink-0 text-muted-foreground">{estimated ? "≈" : ""}{peer.level}/6 · US$ {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(peer.cost)}</span></div>)}</div>}
    {subscription && <p className="text-muted-foreground">Requiere Go. El gráfico compara consumo, no la cuota de tu plan.</p>}
    <details className="text-muted-foreground"><summary className="cursor-pointer">Cómo se compara el costo</summary><div className="mt-1 space-y-1">
      <p>Ejemplo fijo: 1 millón de tokens de entrada + 250 mil de salida, sin caché. {cost !== null ? `US$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(cost)} con la tarifa de referencia.` : "Tarifa sin verificar."}</p>
      <p>Bajo: hasta US$ 0,50; medio: hasta US$ 2; alto: más de US$ 2 por ese ejemplo. El eje usa escala logarítmica fija de US$ 0 a US$ 10; importes mayores quedan en el extremo derecho (US$ 10 o más). No calcula tu factura ni el costo de completar una tarea.</p>
      <p>Se comparan ofertas disponibles del mismo proveedor y con el mismo criterio de evaluación. Las estimaciones se comparan aparte; la línea punteada representa su rango. Tarifas, límites y consumo real pueden variar.</p>
    </div></details>
  </div>;
}
