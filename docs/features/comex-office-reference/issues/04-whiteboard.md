# Funcionalidad — Pizarra infinita tipo Claude Whiteboard

**Título sugerido:** `[Feature] Artefacto Whiteboard: lienzo infinito con formas, conectores y asistencia`
**Labels sugeridas:** `feature`, `ux`, `comex`, `artifact`, `needs-design-review`
**Depende de:** `00-epico-artefactos-oficina`, `06-temas`
**Estimación sugerida:** 1–2 semanas con librería embebida

> **Estado real (2026-11-24): RENDERER MÍNIMO, CANVAS PENDIENTE.**
>
> **Implementado**
> - Schema `board` con nodos, posiciones y conectores.
> - Visor mínimo que lista nodos y conexiones dentro del shell común.
> - Decisión de librería y spike de Excalidraw documentados.
>
> **Pendiente**
> - Integrar `@excalidraw/excalidraw` como canvas infinito.
> - Herramientas de dibujo, zoom/pan, undo/redo y persistencia de escena.
> - Export PNG/SVG/JSON, Ask Claude y conversión a documento.

> **✅ Decisión (2026-11-17, confirmada por el usuario y publicada en el issue):** **Excalidraw (MIT)**, paquete `@excalidraw/excalidraw` embebido. Sin pago. Se aceptan las limitaciones documentadas (sin páginas múltiples, colaboración fuera del paquete, estilo sketch, self-host de fuentes). Se descarta tldraw por licencia en producción. Ver `../matriz-decisiones.md`.

---

## Contexto (qué hace Claude Whiteboard)

Fuente: `../investigacion-web-funcionalidades.md` §5, capturas `wb-*.jpg`.

- Artifact de pizarra compartida: se habla/escribe/dibuja y Claude organiza ideas en **diagramas, flujos y grupos** con **formas, flechas y secciones**.
- Dictado por voz (~25 idiomas); reorganizar por tema, convertir en timeline, encontrar huecos entre pasos, enfocar una región para preguntar.
- Colaboración en vivo y "seguir" a otra persona; convertir en doc o deck; **Send to** Lucid/Miro/Zoho Vani; exportar **PNG**.
- Añadir imágenes/videos; no importar desde archivo. Beta: sin contexto de apps conectadas.
- UI observada: lienzo con cuadrícula, zoom (28 %, 47 %, 60 %, 104 %), secciones/frames, post-its, conectores (incl. numerados), selección con handles y nodos de conexión, lápiz con sub-barra de colores, dock inferior (`cursor`, mano, texto, sección, post-it, lápiz, forma, emoji, comentario, **Ask Claude**) y prompt flotante `Describe a change`.

## Problema en Comex hoy

- No hay forma de explorar visualmente un proceso, arquitectura o flujo de internacionalización; Mermaid solo renderiza diagramas estáticos en el chat.

## Objetivo

Incorporar un lienzo infinito como artefacto para pensar/diagramar junto al agente, con exportación e interoperabilidad reales.

## Alcance

### Incluye (MVP)
- Esquema `board`: `{ id, title, scene, viewport, meta }` (formato JSON portable, p. ej. JSON Canvas / formato de la librería elegida).
- Embeber librería de canvas: **Excalidraw** (MIT, recomendado para evitar licencia) o **tldraw** (UX premium, requiere licencia en producción — ver `../analisis-repos-tecnologias.md` §3.4).
- Herramientas mínimas: selección, mano, texto, sección/frame, nota adhesiva, formas, conectores, lápiz, undo/redo, zoom.
- Persistencia de la escena en el artefacto; abrir/cerrar sin pérdida.
- Exportar **PNG** y **JSON** de la escena.
- Botón **Ask Claude** con prompt inline (`Describe a change`) que recibe el contexto de la selección/escena y propone cambios.
- Acción "Convertir en documento" (alimenta el issue `01`).

### Incluye (fase 2)
- Colaboración multiusuario (Yjs / sync de la librería), "seguir" a otro usuario.
- Send to Miro/Lucid (vía MCP o export), import de imágenes/videos.
- Generación automática de diagramas desde un dataset o informe.

### No incluye
- Edición colaborativa en el MVP.
- Export SVG/vectorial nativo si la librería no lo ofrece (no prometer lo que el video mostró pero la doc oficial no confirma).

## Criterios de aceptación

- [ ] Se puede crear un tablero vacío y otro desde un prompt/dataset de Comex.
- [ ] El lienzo permite dibujar, crear notas, conectar formas y hacer zoom sin perder estado.
- [ ] La escena se guarda y se recupera al reabrir el artefacto.
- [ ] Export PNG y JSON producen archivos válidos.
- [ ] El botón `Ask Claude` envía el contexto de la escena/selección y muestra la respuesta en el chat.
- [ ] "Convertir en documento" crea un `doc` con el contenido del tablero.
- [ ] Flag `comex.artifacts.whiteboard`, tests headless (crear/guardar/exportar), screenshots y reglas de `DESIGN.md` citadas.

## Notas técnicas

- Decisión de librería y licencia: Excalidraw MIT vs tldraw (licencia comercial en prod). Documentar antes de implementar.
- Alternativa acelerada: conectar un MCP de pizarra externo existente (Excalidraw/draw.io/Miro) si se acepta dependencia externa; ver `../analisis-repos-tecnologias.md` §5.3.
- El dock y la barra contextual deben seguir el patrón de "acciones donde está la selección" del épico.
- Usar tokens de tema del issue `06` para el lienzo (colores propios, no copiar la paleta de Claude).
- Formato de escena portable para poder migrar de librería sin perder contenido.

## Dependencias

- Épico `00`, tema `06`.
- Decisión de librería/licencia (bloqueante).

## Referencias

- `../investigacion.md` §4.4, §13.4 (pizarra tipo Figma).
- Capturas: `wb-canvas.jpg`, `wb-zoom.jpg`, `wb-diagrama.jpg`, `wb-conectores-flujo.jpg`, `wb-postits-conectores.jpg`, `wb-seleccion-handles.jpg`, `wb-lapiz.jpg`, `wb-compartir.jpg`.
- Fuente web: https://support.claude.com/en/articles/18324319-get-started-with-claude-whiteboards

## Definition of Done

- [x] Librería elegida y licencia validada.
- [ ] Criterios de aceptación + tests + screenshots.
