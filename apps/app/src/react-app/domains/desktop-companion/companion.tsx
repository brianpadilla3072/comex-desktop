import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ChevronUp, Paperclip, Pin, Settings2, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CompanionAction, CompanionFile, CompanionPreferences, CompanionSnapshot, CompanionState } from "@/app/lib/desktop-companion";
import { Mascot } from "./mascot";

const DEFAULTS: CompanionPreferences = { mascot: "sprout", image: "", motion: true, openOnHover: false, autoClose: 15, alerts: true };
const EMPTY: CompanionState = { enabled: false, connected: false, expanded: false, snapshot: null, preferences: DEFAULTS, updatedAt: 0, recentSessions: [], recentsUpdatedAt: 0 };

async function encodeFile(file: File): Promise<CompanionFile> {
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("No se pudo leer el archivo.")); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result.split(",")[1] ?? "" : ""); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, data };
}

function Question({ request, selected, setSelected, busy, answer }: { request: NonNullable<CompanionSnapshot["question"]>; selected: string[][]; setSelected: (next: string[][]) => void; busy: boolean; answer: (answers: string[][] | null) => void }) {
  return <section className="companion-request" aria-label="Pregunta pendiente">{request.questions.map((question, index) => <fieldset key={index} disabled={busy}>
    <legend>{question.text}</legend>
    {question.options.map(option => <label key={option} className="companion-option"><input type={question.multiple ? "checkbox" : "radio"} name={`question-${index}`} checked={selected[index]?.includes(option) ?? false}
      onChange={() => setSelected(selected.map((values, i) => i !== index ? values : question.multiple ? values.includes(option) ? values.filter(x => x !== option) : [...values, option] : [option]))} />{option}</label>)}
    {question.custom && <input className="companion-other" placeholder="Otra respuesta" aria-label={`Otra respuesta: ${question.text}`} value={(selected[index] ?? []).filter(value => !question.options.includes(value)).join("")}
      onChange={event => setSelected(selected.map((values, i) => i !== index ? values : [...(question.multiple ? values.filter(value => question.options.includes(value)) : []), ...(event.target.value ? [event.target.value] : [])]))} />}
  </fieldset>)}<div className="companion-actions"><Button size="sm" disabled={busy || selected.some(values => !values.some(value => value.trim()))} onClick={() => answer(selected.map(values => [...new Set(values.map(value => value.trim()).filter(Boolean))]))}>Responder</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => answer(null)}>Descartar</Button></div></section>;
}

export function Companion() {
  const [state, setState] = useState<CompanionState>(EMPTY);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filesByTarget, setFilesByTarget] = useState<Record<string, File[]>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string[][]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const [pinned, setPinned] = useState(false), [settings, setSettings] = useState(false), [activity, setActivity] = useState(false), [peeking, setPeeking] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null), editor = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false), openedByHover = useRef(false), inFlight = useRef(false), preparingSend = useRef(false);
  const target = state.snapshot?.target ?? "";
  const draftKey = state.snapshot ? JSON.stringify([state.snapshot.scope || "local", state.snapshot.workspaceId ?? "", state.snapshot.sessionId]) : "";
  const draft = drafts[draftKey] ?? "", files = filesByTarget[draftKey] ?? [];
  const stale = state.connected === false;
  const status = stale ? "offline" : state.snapshot?.state ?? "idle";
  const recentSessions = state.recentSessions ?? [];
  const recentsStale = state.connected === false;
  const activeRecent = recentSessions.find(session => session.sessionId === state.snapshot?.sessionId && session.workspaceId === state.snapshot?.workspaceId);
  const switching = pendingSession !== null && pendingSession !== activeRecent?.key;
  const requestId = state.snapshot?.permission?.id ?? state.snapshot?.question?.id;
  const questionKey = JSON.stringify([draftKey, state.snapshot?.question?.id ?? ""]);
  const held = pinned || Boolean(requestId) || busy || switching || Boolean(draft.trim()) || files.length > 0;
  const api = window.__OPENWORK_COMPANION__;
  useEffect(() => {
    if (!api) return;
    let disposed = false, booting = true;
    let initialPatches: Partial<CompanionState> = {};
    const stop = api.onState(next => { if (!disposed) {
      if (booting) initialPatches = { ...initialPatches, ...next };
      setState(current => ({ ...current, ...next }));
    } });
    void api.state().then(next => {
      if (next && !disposed) setState({ ...next, ...initialPatches });
      booting = false; initialPatches = {};
    }).catch(() => { booting = false; if (!disposed) setError("No se pudo conectar con la app."); });
    return () => { disposed = true; stop(); };
  }, [api]);
  useEffect(() => { setError(null); setAcknowledged(null); setPinned(false); setActivity(false); }, [target, requestId]);
  useEffect(() => {
    if (!pendingSession) return;
    if (pendingSession === activeRecent?.key) { setPendingSession(null); return; }
    const timer = setTimeout(() => { setPendingSession(null); setError("No se pudo abrir esa conversación. Revisá la app."); }, 8000);
    return () => clearTimeout(timer);
  }, [pendingSession, activeRecent?.key]);
  const readCurrent = useRef(() => {});
  readCurrent.current = () => {
    if (!state.expanded || settings || activity || switching || stale || recentsStale || activeRecent?.status !== "unread" || !document.hasFocus()) return;
    if ((state.snapshot?.responseAt ?? 0) >= activeRecent.responseAt && state.snapshot?.messages.some(message => message.role === "assistant" && message.text.trim())) void api?.readSession?.(activeRecent.key).catch(() => {});
  };
  useEffect(() => {
    const focus = () => readCurrent.current();
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, []);
  useEffect(() => { readCurrent.current(); }, [state.expanded, state.snapshot, settings, activity, switching, stale, recentsStale, activeRecent?.key, activeRecent?.status, api]);
  const cancelClose = useCallback(() => { clearTimeout(closeTimer.current); }, []);
  const view = useCallback((expanded: boolean, focus = false) => {
    cancelClose(); if (!expanded) { setPinned(false); openedByHover.current = false; }
    void api?.view({ expanded, focus }).catch(() => setError("No se pudo cambiar la vista."));
  }, [api, cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (!state.enabled || state.visible === false || !state.expanded || held || settings) return;
    closeTimer.current = setTimeout(() => view(false), openedByHover.current ? 600 : state.preferences.autoClose * 1000);
  }, [cancelClose, held, settings, state.enabled, state.visible, state.expanded, state.preferences.autoClose, view]);
  useEffect(() => { if (!hovered.current) scheduleClose(); return cancelClose; }, [scheduleClose, cancelClose]);
  useEffect(() => () => { clearTimeout(hoverTimer.current); }, []);
  useEffect(() => { if (!state.enabled || state.visible === false) clearTimeout(hoverTimer.current); }, [state.enabled, state.visible]);
  useEffect(() => {
    if (!root.current || !state.enabled || state.visible === false || !state.expanded) return;
    let previousHeight = 0;
    const resize = new ResizeObserver(() => { const panel = root.current?.querySelector(".companion-panel"); if (panel) { const height = panel.scrollHeight + 48; if (height !== previousHeight) { previousHeight = height; void api?.view({ height }); } } });
    resize.observe(root.current); return () => resize.disconnect();
  }, [state.enabled, state.visible, state.expanded, api]);
  async function execute(action: CompanionAction) {
    if (!api || !target || inFlight.current || stale || switching) return;
    inFlight.current = true; setBusy(true); setError(null);
    const origin = target;
    const originDraftKey = draftKey;
    try {
      const result = await api.command({ id: crypto.randomUUID(), target: origin, action });
      if (result.ok) {
        if (action.kind === "send") { setDrafts(current => ({ ...current, [originDraftKey]: "" })); setFilesByTarget(current => ({ ...current, [originDraftKey]: [] })); }
        if (action.kind === "permission" || action.kind === "question") setAcknowledged(action.requestId);
      } else { setError(result.error ?? "No se pudo completar la acción."); if (result.uncertain) setUncertain(current => ({ ...current, [originDraftKey]: true })); }
    } catch { setError("No se pudo confirmar la acción. Revisá el chat en la app."); setUncertain(current => ({ ...current, [originDraftKey]: true })); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send() {
    if (!state.snapshot?.canSend || busy || switching || preparingSend.current || uncertain[draftKey] || (!draft.trim() && !files.length)) return;
    if (files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) { setError("Para adjuntos de más de 8 MB, abrí el chat en la app."); return; }
    preparingSend.current = true; setBusy(true);
    try { await execute({ kind: "send", text: draft, files: await Promise.all(files.map(encodeFile)) }); }
    catch { setError("No se pudieron leer los adjuntos. El borrador se conserva."); }
    finally { preparingSend.current = false; setBusy(false); }
  }
  function attach(input: File[]) {
    if (switching) return;
    if (input.length + files.length > 8) { setError("Podés adjuntar hasta ocho archivos desde la cápsula."); return; }
    setFilesByTarget(current => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...input] })); view(true, true);
  }
  async function savePreferences(next: CompanionPreferences) { try { if (!await api?.preferences(next)) setError("No se pudo guardar la preferencia."); } catch { setError("No se pudo guardar la preferencia."); } }
  async function selectSession(key: string) {
    if (!api?.selectSession || busy || switching || recentsStale) return;
    setSettings(false); setActivity(false); setError(null);
    if (key !== activeRecent?.key) setPendingSession(key);
    try { if (!await api.selectSession(key)) { setPendingSession(null); setError("Esa conversación ya no está disponible."); } }
    catch { setPendingSession(null); setError("No se pudo abrir esa conversación."); }
  }
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
  if (!state.enabled || state.visible === false) return null;
  return <div ref={root} className={`companion ${state.expanded ? "expanded" : ""}`} data-state={status}
    onPointerEnter={() => { hovered.current = true; cancelClose(); }} onPointerLeave={() => { hovered.current = false; scheduleClose(); }}
    onPointerDown={() => { openedByHover.current = false; cancelClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); view(false); } }}
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); attach(Array.from(event.dataTransfer.files)); }}>
    <div className={`companion-bar ${recentSessions.length ? "has-recents" : ""}`}>
    <Button variant="ghost" className={`companion-pill ${peeking ? "peeking" : ""}`} aria-label={state.expanded ? "Plegar asistente" : "Abrir asistente"} aria-expanded={state.expanded}
      onPointerEnter={() => { setPeeking(true); if (state.preferences.openOnHover && !state.expanded && !requestId) hoverTimer.current = setTimeout(() => { openedByHover.current = true; view(true); }, 500); }}
      onPointerLeave={() => { clearTimeout(hoverTimer.current); setPeeking(false); }} onClick={() => view(!state.expanded, !state.expanded)}>
      <Mascot state={status} preferences={state.preferences} active={false} size={peeking ? 32 : 27} />
    </Button>
    {recentSessions.length > 0 && <nav className="companion-recents" aria-label="Conversaciones recientes">{recentSessions.map(session => {
      const label = `${session.title} · ${recentsStale ? "Sin actualizar" : session.status === "waiting" ? "Necesita tu respuesta" : session.status === "unread" ? "Respuesta sin leer" : "Leída, sin novedades"}`;
      return <Button key={session.key} variant="ghost" size="icon-xs" className="companion-recent" aria-label={label} title={label} aria-pressed={state.expanded && activeRecent?.key === session.key} aria-busy={pendingSession === session.key}
        disabled={busy || switching || recentsStale} onClick={() => void selectSession(session.key)}><span className="companion-session-dot" data-status={recentsStale ? "idle" : session.status} /></Button>;
    })}</nav>}
    </div>
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
            {snapshot.permission && <section className="companion-request" aria-label="Permiso pendiente"><strong>{snapshot.permission.title}</strong><p>{snapshot.permission.detail}</p><div className="companion-actions"><Button size="sm" disabled={busy || switching || stale || snapshot.permission.busy || acknowledged === snapshot.permission.id} onClick={() => void execute({ kind: "permission", requestId: snapshot.permission!.id, reply: "once" })}>Permitir una vez</Button><Button variant="ghost" size="sm" disabled={busy || switching || stale || snapshot.permission.busy || acknowledged === snapshot.permission.id} onClick={() => void execute({ kind: "permission", requestId: snapshot.permission!.id, reply: "reject" })}>Rechazar</Button></div></section>}
            {snapshot.question && <Question key={questionKey} request={snapshot.question} selected={questionDrafts[questionKey] ?? snapshot.question.questions.map(() => [])}
              setSelected={answers => setQuestionDrafts(current => ({ ...current, [questionKey]: answers }))}
              busy={busy || switching || stale || snapshot.question.busy || acknowledged === snapshot.question.id} answer={answers => void execute({ kind: "question", requestId: snapshot.question!.id, answers })} />}
            {!snapshot.permission && !snapshot.question && <div className="companion-composer">
              {files.length > 0 && <div className="companion-files">{files.map((file, index) => <span key={`${index}-${file.name}`}>{file.name}<Button size="icon-xs" variant="ghost" aria-label={`Quitar ${file.name}`} onClick={() => setFilesByTarget(current => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}><X /></Button></span>)}</div>}
              <Textarea ref={editor} aria-label="Mensaje al asistente" placeholder="Continuá este trabajo…" value={draft} disabled={busy || switching || stale || status === "offline" || uncertain[draftKey]} onFocus={cancelClose}
                onChange={event => setDrafts(current => ({ ...current, [draftKey]: event.target.value }))}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
              <div className="companion-composer-tools"><input ref={fileInput} type="file" multiple hidden onChange={event => { attach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <Button size="icon-xs" variant="ghost" aria-label="Adjuntar archivos" disabled={busy || switching || stale} onClick={() => fileInput.current?.click()}><Paperclip /></Button><span>{snapshot.model}</span>
                {status === "working" ? <Button size="icon-sm" variant="ghost" aria-label="Detener trabajo" disabled={busy || switching || stale} onClick={() => void execute({ kind: "stop" })}><Square /></Button> : <Button size="icon-sm" aria-label="Enviar mensaje" disabled={busy || switching || !snapshot.canSend || stale || uncertain[draftKey] || !draft.trim() && !files.length} onClick={() => void send()}><ArrowUp /></Button>}
              </div>
            </div>}
          </>}
        </>}
        {error && <p role="alert" className="companion-status">{error}<Button size="xs" variant="ghost" onClick={() => void api?.openMain()}>Ver chat</Button></p>}
      </div></div>
    </section>}
  </div>;
}
