import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ChevronUp, Paperclip, Pin, Settings2, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CompanionAction, CompanionFile, CompanionPreferences, CompanionSnapshot, CompanionState } from "@/app/lib/desktop-companion";
import { Mascot } from "./mascot";

const DEFAULTS: CompanionPreferences = { mascot: "sprout", image: "", motion: true, openOnHover: false, autoClose: 15, alerts: true };
const EMPTY: CompanionState = { enabled: false, expanded: false, snapshot: null, preferences: DEFAULTS, updatedAt: 0 };

async function encodeFile(file: File): Promise<CompanionFile> {
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("No se pudo leer el archivo.")); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result.split(",")[1] ?? "" : ""); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, data };
}

function Question({ request, busy, answer }: { request: NonNullable<CompanionSnapshot["question"]>; busy: boolean; answer: (answers: string[][] | null) => void }) {
  const [selected, setSelected] = useState<string[][]>(() => request.questions.map(() => []));
  return <section className="companion-request" aria-label="Pregunta pendiente">{request.questions.map((question, index) => <fieldset key={index}>
    <legend>{question.text}</legend>
    {question.options.map(option => <label key={option} className="companion-option"><input type={question.multiple ? "checkbox" : "radio"} name={`question-${index}`} checked={selected[index]?.includes(option) ?? false}
      onChange={() => setSelected(current => current.map((values, i) => i !== index ? values : question.multiple ? values.includes(option) ? values.filter(x => x !== option) : [...values, option] : [option]))} />{option}</label>)}
    <input className="companion-other" placeholder="Otra respuesta" aria-label={`Otra respuesta: ${question.text}`} onChange={event => setSelected(current => current.map((values, i) => i === index ? event.target.value ? [event.target.value] : [] : values))} />
  </fieldset>)}<div className="companion-actions"><Button size="sm" disabled={busy || selected.some(values => !values.length)} onClick={() => answer(selected)}>Responder</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => answer(null)}>Descartar</Button></div></section>;
}

export function Companion() {
  const [state, setState] = useState<CompanionState>(EMPTY);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filesByTarget, setFilesByTarget] = useState<Record<string, File[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false), [settings, setSettings] = useState(false), [activity, setActivity] = useState(false), [peeking, setPeeking] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null), editor = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false), openedByHover = useRef(false), inFlight = useRef(false), preparingSend = useRef(false);
  const target = state.snapshot?.target ?? "", draft = drafts[target] ?? "", files = filesByTarget[target] ?? [];
  const [clock, setClock] = useState(Date.now());
  const stale = state.snapshot !== null && clock - state.updatedAt > 15000;
  const status = stale ? "offline" : state.snapshot?.state ?? "idle";
  const requestId = state.snapshot?.permission?.id ?? state.snapshot?.question?.id;
  const held = pinned || Boolean(requestId) || busy || Boolean(draft.trim()) || files.length > 0;
  const api = window.__OPENWORK_COMPANION__;
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const stop = api.onState(next => { if (!disposed) { setState(next); setClock(Date.now()); } });
    void api.state().then(next => { if (next && !disposed) setState(next); }).catch(() => setError("No se pudo conectar con la app."));
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => { disposed = true; stop(); clearInterval(timer); };
  }, [api]);
  useEffect(() => { setError(null); setAcknowledged(null); setPinned(false); setActivity(false); }, [target, requestId]);
  const cancelClose = useCallback(() => { clearTimeout(closeTimer.current); }, []);
  const view = useCallback((expanded: boolean, focus = false) => {
    cancelClose(); if (!expanded) { setPinned(false); openedByHover.current = false; }
    void api?.view({ expanded, focus }).catch(() => setError("No se pudo cambiar la vista."));
  }, [api, cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (!state.expanded || held || settings) return;
    closeTimer.current = setTimeout(() => view(false), openedByHover.current ? 600 : state.preferences.autoClose * 1000);
  }, [cancelClose, held, settings, state.expanded, state.preferences.autoClose, view]);
  useEffect(() => { if (!hovered.current) scheduleClose(); return cancelClose; }, [scheduleClose, cancelClose]);
  useEffect(() => () => { clearTimeout(hoverTimer.current); }, []);
  useEffect(() => {
    if (!root.current || !state.expanded) return;
    const resize = new ResizeObserver(() => { const panel = root.current?.querySelector(".companion-panel"); if (panel) void api?.view({ expanded: true, height: panel.scrollHeight + 48 }); });
    resize.observe(root.current); return () => resize.disconnect();
  }, [state.expanded, api]);
  async function execute(action: CompanionAction) {
    if (!api || !target || inFlight.current || stale) return;
    inFlight.current = true; setBusy(true); setError(null);
    const origin = target;
    try {
      const result = await api.command({ id: crypto.randomUUID(), target: origin, action });
      if (result.ok) {
        if (action.kind === "send") { setDrafts(current => ({ ...current, [origin]: "" })); setFilesByTarget(current => ({ ...current, [origin]: [] })); }
        if (action.kind === "permission" || action.kind === "question") setAcknowledged(action.requestId);
      } else { setError(result.error ?? "No se pudo completar la acción."); if (result.uncertain) setUncertain(origin); }
    } catch { setError("No se pudo confirmar la acción. Revisá el chat en la app."); setUncertain(origin); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send() {
    if (!state.snapshot?.canSend || busy || preparingSend.current || uncertain === target || (!draft.trim() && !files.length)) return;
    if (files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) { setError("Para adjuntos de más de 8 MB, abrí el chat en la app."); return; }
    preparingSend.current = true; setBusy(true);
    try { await execute({ kind: "send", text: draft, files: await Promise.all(files.map(encodeFile)) }); }
    catch { setError("No se pudieron leer los adjuntos. El borrador se conserva."); }
    finally { preparingSend.current = false; setBusy(false); }
  }
  function attach(input: File[]) {
    if (input.length + files.length > 8) { setError("Podés adjuntar hasta ocho archivos desde la cápsula."); return; }
    setFilesByTarget(current => ({ ...current, [target]: [...(current[target] ?? []), ...input] })); view(true, true);
  }
  async function savePreferences(next: CompanionPreferences) { try { if (!await api?.preferences(next)) setError("No se pudo guardar la preferencia."); } catch { setError("No se pudo guardar la preferencia."); } }
  async function importMascot(file: File) {
    if (!/^image\/(png|webp|jpeg)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setError("Elegí PNG, WebP o JPG de hasta 5 MB."); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); const scale = Math.min(256 / image.width, 256 / image.height, 1);
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error(); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      await savePreferences({ ...state.preferences, mascot: "image", image: canvas.toDataURL("image/png") });
    } catch { setError("No se pudo abrir esa imagen."); } finally { URL.revokeObjectURL(url); }
  }
  const snapshot = state.snapshot;
  return <div ref={root} className={`companion ${state.expanded ? "expanded" : ""}`} data-state={status}
    onPointerEnter={() => { hovered.current = true; cancelClose(); }} onPointerLeave={() => { hovered.current = false; scheduleClose(); }}
    onPointerDown={() => { openedByHover.current = false; cancelClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); view(false); } }}
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); attach(Array.from(event.dataTransfer.files)); }}>
    <Button variant="ghost" className={`companion-pill ${peeking ? "peeking" : ""}`} aria-label={state.expanded ? "Plegar asistente" : "Abrir asistente"} aria-expanded={state.expanded}
      onPointerEnter={() => { setPeeking(true); if (state.preferences.openOnHover && !state.expanded && !requestId) hoverTimer.current = setTimeout(() => { openedByHover.current = true; view(true); }, 500); }}
      onPointerLeave={() => { clearTimeout(hoverTimer.current); setPeeking(false); }} onClick={() => view(!state.expanded, !state.expanded)}>
      <Mascot state={status} preferences={state.preferences} size={peeking ? 32 : 27} />{status !== "idle" && <span className="companion-dot" aria-label={status === "waiting" ? "Necesita tu respuesta" : status === "offline" ? "Sin conexión" : "En actividad"} />}
    </Button>
    {state.expanded && <section className="companion-panel" aria-label="Chat del asistente">
      <header><span className="companion-title">{snapshot?.project || "Asistente"}</span><span className="companion-subtitle">{snapshot?.title}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Mantener abierto" aria-pressed={pinned} onClick={() => setPinned(value => !value)}><Pin /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Personalizar mascota" aria-pressed={settings} onClick={() => setSettings(value => !value)}><Settings2 /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Abrir chat en la app" onClick={() => void api?.openMain()}><ArrowUpRight /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Plegar" onClick={() => view(false)}><ChevronUp /></Button>
      </header>
      <div className="companion-row"><div className="companion-pet"><Mascot state={status} preferences={state.preferences} /></div><div className="companion-chat">
        {settings ? <div className="companion-settings">
          <label>Mascota<select value={state.preferences.mascot} onChange={event => { const mascot = event.target.value; if (mascot === "sprout" || mascot === "ember" || mascot === "image") void savePreferences({ ...state.preferences, mascot }); }}><option value="sprout">Brote</option><option value="ember">Brasa</option><option value="image" disabled={!state.preferences.image}>Mi imagen</option></select></label>
          <label>Agregar mascota<input type="file" accept="image/png,image/webp,image/jpeg" onChange={event => { const file = event.target.files?.[0]; if (file) void importMascot(file); }} /></label>
          <label><input type="checkbox" checked={state.preferences.motion} onChange={event => void savePreferences({ ...state.preferences, motion: event.target.checked })} />Animación suave</label>
          <label><input type="checkbox" checked={state.preferences.openOnHover} onChange={event => void savePreferences({ ...state.preferences, openOnHover: event.target.checked })} />Abrir al pasar el cursor</label>
          <label><input type="checkbox" checked={state.preferences.alerts} onChange={event => void savePreferences({ ...state.preferences, alerts: event.target.checked })} />Mostrar preguntas y permisos</label>
          <label>Plegar después de<select value={state.preferences.autoClose} onChange={event => void savePreferences({ ...state.preferences, autoClose: Number(event.target.value) })}><option value={5}>5 segundos</option><option value={15}>15 segundos</option><option value={30}>30 segundos</option></select></label>
        </div> : <>
          {!snapshot ? <div className="companion-empty">Abrí una conversación en la app para usarla desde acá.<Button size="sm" onClick={() => void api?.openMain()}>Abrir app</Button></div> : <>
            <div className="companion-navigation"><Button size="xs" variant="ghost" aria-pressed={!activity} onClick={() => setActivity(false)}>Chat</Button><Button size="xs" variant="ghost" aria-pressed={activity} onClick={() => setActivity(true)}>Actividad</Button></div>
            {activity ? <div className="companion-transcript">{snapshot.activity.length ? snapshot.activity.map((line, index) => <p key={index}>{line}</p>) : <p className="text-muted-foreground">Sin actividad de herramientas en este turno.</p>}</div> : <div className="companion-transcript" aria-label="Mensajes del chat">{snapshot.messages.filter(message => message.text).slice(-4).map(message => <div key={message.id} className={`companion-message ${message.role === "user" ? "user" : ""}`}>{message.text}</div>)}</div>}
            {status === "offline" && <p role="status" className="companion-status">No se pudo verificar el chat. Abrí la app para reconectar.</p>}
            {snapshot.permission && <section className="companion-request" aria-label="Permiso pendiente"><strong>{snapshot.permission.title}</strong><p>{snapshot.permission.detail}</p><div className="companion-actions"><Button size="sm" disabled={busy || stale || snapshot.permission.busy || acknowledged === snapshot.permission.id} onClick={() => void execute({ kind: "permission", requestId: snapshot.permission!.id, reply: "once" })}>Permitir una vez</Button><Button variant="ghost" size="sm" disabled={busy || stale || snapshot.permission.busy || acknowledged === snapshot.permission.id} onClick={() => void execute({ kind: "permission", requestId: snapshot.permission!.id, reply: "reject" })}>Rechazar</Button></div></section>}
            {snapshot.question && <Question key={snapshot.question.id} request={snapshot.question} busy={busy || stale || snapshot.question.busy || acknowledged === snapshot.question.id} answer={answers => void execute({ kind: "question", requestId: snapshot.question!.id, answers })} />}
            <div className="companion-composer">
              {files.length > 0 && <div className="companion-files">{files.map((file, index) => <span key={`${index}-${file.name}`}>{file.name}<Button size="icon-xs" variant="ghost" aria-label={`Quitar ${file.name}`} onClick={() => setFilesByTarget(current => ({ ...current, [target]: files.filter((_, i) => i !== index) }))}><X /></Button></span>)}</div>}
              <Textarea ref={editor} aria-label="Mensaje al asistente" placeholder="Continuá este trabajo…" value={draft} disabled={busy || stale || status === "offline" || uncertain === target} onFocus={cancelClose}
                onChange={event => setDrafts(current => ({ ...current, [target]: event.target.value }))}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
              <div className="companion-composer-tools"><input ref={fileInput} type="file" multiple hidden onChange={event => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <Button size="icon-xs" variant="ghost" aria-label="Adjuntar archivos" disabled={busy || stale} onClick={() => fileInput.current?.click()}><Paperclip /></Button><span>{snapshot.model}</span>
                {status === "working" ? <Button size="icon-sm" variant="ghost" aria-label="Detener trabajo" disabled={busy || stale} onClick={() => void execute({ kind: "stop" })}><Square /></Button> : <Button size="icon-sm" aria-label="Enviar mensaje" disabled={busy || !snapshot.canSend || stale || uncertain === target || !draft.trim() && !files.length} onClick={() => void send()}><ArrowUp /></Button>}
              </div>
            </div>
          </>}
        </>}
        {error && <p role="alert" className="companion-status">{error}<Button size="xs" variant="ghost" onClick={() => void api?.openMain()}>Ver chat</Button></p>}
      </div></div>
    </section>}
  </div>;
}
