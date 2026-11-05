# Plan: fork de OpenWork con el pack de Comercio Exterior adentro

> Documento de decisión y estimación. No es código: es qué habría que tocar, cuánto cuesta, cómo se instala y cómo se mantiene.
> Base analizada: `different-ai/openwork`, rama `dev`, clon del 5-nov-2026 (v0.18.65). Las cifras de esfuerzo son estimaciones de un dev solo, a medio tiempo.
> La especificación de producto (qué necesita ella y qué hay que agregarle a OpenWork) está en `ESPECIFICACION-APP-COMEX.md`.

---

## 1. Veredicto corto

**Sí conviene, pero solo como fork fino.** El producto que ella necesita es "una app que ya sabe de comercio exterior", y hoy eso se logra con tres cosas: marca, primera vez guiada y pack preinstalado. Nada de eso exige tocar el corazón de OpenWork.

| Camino | Qué es | Esfuerzo | Mantenimiento | Veredicto |
|---|---|---|---|---|
| **0. Sin fork** | OpenWork oficial + `instalar.sh` del pack | 0 días | 0 | Sirve hoy, pero la instalación tiene fricción (terminal, Python, UI en inglés, sin seed) |
| **A. Fork fino (recomendado)** | OpenWork + marca + seed del pack + primera vez en castellano + releases propios | **~23 días** de MVP (versión reducida: ~15) | 1–2 días/mes | Producto instalable de verdad, con `git pull` barato |
| **B. Fork profundo** | UI propia, traducción completa, pipeline de documentos propio, onboarding a medida | 2–3 meses | 1 semana/mes | Se rompe con cada release de upstream; no |
| **C. App desde cero** | Electron propio sobre OpenCode | 4–6 meses | alta | No compite con 24k estrellas y 100 commits cada 36 h |

La regla que decide todo: **el diff contra upstream tiene que caber en ~10 archivos y ~300 líneas.** Lo demás va en archivos nuevos (pack, seed, MCP server). Si un cambio obliga a editar 40 archivos de `apps/app`, se descarta o se hace upstream-first.

Datos que justifican la prudencia: ~24.400 estrellas, ~2.500 forks, 384 issues abiertas, releases cada 1–4 días y ~100 commits en 36 horas. Un fork profundo es un segundo trabajo no pago.

---

## 2. Qué se toca (presupuesto de diff)

### 2.1 Archivos existentes (ediciones mínimas)

| # | Archivo | Cambio | Líneas | Riesgo de conflicto |
|---|---|---|---|---|
| 1 | `apps/desktop/electron-builder.base.yml` | `appId`, `productName`, iconos, `extraResources` del pack, `publish.owner/repo` propios | 8–12 | **Alto** (upstream lo mueve seguido) |
| 2 | `apps/desktop/electron/updater.mjs` | URLs de releases propias (3 constantes) | 3 | Medio |
| 3 | `apps/app/src/react-app/shell/shell-config.tsx` | `appName: "OpenWork"` → nombre del producto | 1 | Bajo |
| 4 | `apps/server/src/workspace-init.ts` | Llamar al seed del pack al crear/abrir workspace | 3–5 | Medio |
| 5 | `apps/server/src/skills.ts` | (Opcional) incluir la carpeta del pack como fuente global | 3–5 | Medio |
| 6 | `apps/app/src/react-app/shell/welcome-route.tsx` | Saltar atribución y sign-in; copy de bienvenida | 10–15 | **Alto** |
| 7 | `apps/app/src/react-app/domains/onboarding/welcome-page.tsx` | Texto y 3 accesos rápidos ("cotizar", "estudio de mercado", "TFI") | 15–25 | **Alto** |
| 8 | `apps/app/src/i18n/locales/es.ts` | Traducir solo las ~120 claves de las pantallas que se ven el día 1 | 120–200 | Bajo (archivo propio) |
| 9 | `apps/app/src/app/lib/analytics-key.ts` | PostHog desactivado (sin clave) | 1 | Bajo |
| 10 | `apps/desktop/electron/sentry.mjs` | Sentry desactivado salvo opt-in | 3–5 | Bajo |
| 11 | `.github/workflows/build-electron-desktop.yml` | Release propio con tag, artefactos y `contents: write` | 10–20 | Medio |
| 12 | `apps/desktop/package.json` | `name`/`productName` del fork | 2 | Bajo |

### 2.2 Archivos nuevos (sin conflicto)

| Archivo/carpeta | Qué hace |
|---|---|
| `pack/` | El `comex-pack` copiado tal cual (9 skills + 4 agentes + scripts + validador) |
| `apps/desktop/electron/comex-seed.mjs` | Copia el pack a `~/.config/opencode/skills` y `agents` la primera vez, con marcador de versión; **nunca pisa** lo que ella editó |
| `apps/desktop/scripts/bundle-pack.mjs` | Empaqueta `pack/` en `extraResources` durante el build |
| `packages/comex-tools/` (fase 2) | MCP server en Node con Word/Excel/CSV sin Python |
| `.github/workflows/sync-upstream.yml` | Abre un PR semanal con `upstream/dev` y corre el build |
| `docs/INSTALAR.md` | Guía para ella, con capturas y el aviso de SmartScreen |

**Total: 12 archivos tocados, ~180–300 líneas, + 4 archivos nuevos.** Ese es el presupuesto. Si se pasa, se recorta alcance, no se agranda el fork.

### 2.3 Lo que NO se toca

- El motor de OpenCode (viene embebido como binario; se actualiza con upstream).
- `ee/` (licencia distinta, 411k líneas; no se usa ni se redistribuye).
- `apps/app` más allá de `shell-config`, welcome y `es.ts`.
- La lógica de sesiones, MCP, browser, automations, computer-use.

---

## 3. Las tres funciones que justifican el fork

### 3.1 Primera vez que parece un producto, no un IDE

Hoy OpenWork abre pidiendo workspace, proveedor y atribución, en inglés. Para una estudiante de Comercio Exterior eso es una pared. El fork tiene que abrir con:

1. **"¿Con qué modelo querés trabajar?"** — tres opciones: pegar una clave (OpenAI/Anthropic/Google), iniciar sesión con ChatGPT, o usar un modelo local. Sin cuenta de OpenWork Cloud.
2. **"¿Dónde guardamos tus trabajos?"** — crea `Documentos/Comercio Exterior` y lo abre como workspace.
3. **"Probá esto"** — tres tarjetas: *Cotizar una exportación*, *Estudio de mercado para la facultad*, *Armar mi TFI*. Cada una inserta un pedido de ejemplo en el chat.

No hace falta traducir toda la app: alcanza con las pantallas del día 1 y los botones que va a usar. El resto queda en inglés y se traduce cuando haya tiempo (hoy `es.ts` tiene 730 de 2.530 claves, 29%).

### 3.2 El pack ya está adentro (y se actualiza sin pisar)

Al primer arranque, `comex-seed.mjs` copia:

```
pack/skills/*        →  ~/.config/opencode/skills/
pack/agents/*.md     →  ~/.config/opencode/agents/
```

Por qué global y no por proyecto: OpenWork lee `~/.config/opencode/skills` de forma nativa, así que el pack funciona en **cualquier** carpeta que ella abra, incluso las que ya tenía. No depende de "Settings › Library", que exige iniciar sesión.

Reglas del seed:
- Si el archivo no existe → lo copia.
- Si existe y es idéntico → no hace nada.
- Si existe y ella lo modificó → **no lo pisa**; guarda la versión nueva como `SKILL.md.nuevo` y muestra un aviso discreto ("hay una actualización del pack; tus cambios quedaron intactos").
- Un archivo `.comex-pack-version` permite saber qué versión sembró y migrar.
- Botón "Restaurar pack" en Ajustes para el caso "toqué algo y lo rompí".

Esto es lo que convierte "instalar un pack" en "la app ya sabe". Es también lo que permite que el pack siga viviendo como proyecto separado y se pueda usar con OpenCode a secas.

### 3.3 Sin Python y sin terminal

Hoy los entregables (Word/Excel) dependen de `python-docx`/`openpyxl` y de un `instalar.sh`. En la máquina de ella no hay Python ni ganas de abrir una terminal.

Salida por fases:

- **Fase 1 (MVP):** dejar los scripts Python como están para quien ya los tenga, y que el agente use las herramientas nativas de OpenWork (`spreadsheet_inspect`, `spreadsheet_read`, `spreadsheet_write`) para Excel simple. Word: el agente escribe Markdown y exporta a `.docx` con la herramienta de documentos si está disponible; si no, entrega `.md` + tabla. Es suficiente para probar el producto.
- **Fase 1.5 (atajo recomendado):** compilar `informe_docx.py` y `tabla_xlsx.py` a ejecutables standalone con PyInstaller en la matriz de CI (Windows/macOS/Linux). Se empaquetan en `extraResources` y la skill llama al `.exe` en vez de a `python3`. **~3 días**, agrega ~20 MB al instalador y elimina Python sin reescribir nada. Es la opción con mejor relación costo/beneficio.
- **Fase 2 (si el producto crece):** `packages/comex-tools`, un MCP server en Node con `docx` + `exceljs` que expone `word_informe`, `excel_cotizacion` y `excel_tabla`. Mismo contrato que los scripts Python, sin binarios por plataforma. **8 días** y deja el pipeline mantenible a largo plazo.

Recomendación: no bloquear el lanzamiento por la fase 2. El 80% de los trabajos son informe + tabla; con lo nativo y, si hace falta, PyInstaller, alcanza. El MCP en Node se justifica cuando haya que agregar gráficos y estilos que las herramientas nativas no dan.

---

## 4. Instalación para ella (lo que ve, paso a paso)

**Requisitos:** Windows 10/11 (o macOS), conexión, una clave de modelo o cuenta de ChatGPT. Nada más.

1. Entra a la página del proyecto y descarga `Comex-Desktop-Setup-0.1.0.exe` (~150–250 MB).
2. Windows muestra **"Windows protegió tu PC"** porque el instalador no tiene firma comercial. Click en **Más información → Ejecutar de todos modos**. (Esto se documenta con captura; pasa por no pagar un certificado de ~USD 300/año.)
3. Instala **solo para su usuario**, sin pedir administrador, en `%LOCALAPPDATA%\Programs\Comex Desktop`.
4. Abre la app. Primera pantalla en castellano: elegir modelo, pegar clave, elegir carpeta.
5. La app ya tiene las 9 skills y los 4 agentes. Escribe su primer pedido en el chat.
6. Los trabajos quedan en `Documentos\Comercio Exterior`; los puede abrir con Word/Excel como cualquier archivo.

**Actualizaciones:** la app consulta las releases del repo propio (no las de `different-ai/openwork`). Como no está firmada, cada actualización puede volver a pedir confirmación; se explica una vez.

**Desinstalar:** quita el programa; no borra sus documentos. El pack en `~/.config/opencode` se puede dejar (sirve si instala OpenCode suelto).

**Sin cuenta:** todo el flujo funciona sin OpenWork Cloud. La app no manda telemetría (PostHog/Sentry desactivados); solo habla con el proveedor de modelo que ella elija. Eso se dice en la pantalla de bienvenida, en una línea.

**Aviso académico:** en la misma pantalla, un texto corto: "La app te ayuda a investigar y redactar; las decisiones, la defensa y la responsabilidad del trabajo son tuyas. Citá siempre las fuentes." Es honesto y además protege el producto de un uso que después se vuelve un problema.

---

## 5. Cómo se construye y se publica (para vos)

### 5.1 Entorno

Verificado en upstream: **Node 24.22.1**, **pnpm 11.4.0**, **Bun 1.3.10**. La máquina local tiene Node 22 y pnpm 12: hay que instalar las versiones exactas o el build falla por `engines`.

```bash
# una vez
corepack enable
corepack prepare pnpm@11.4.0 --activate
# Node 24 vía nvm/fnm/volta

git clone https://github.com/<tu-usuario>/comex-desktop.git
cd comex-desktop
git remote add upstream https://github.com/different-ai/openwork.git
pnpm install
```

### 5.2 Desarrollo

```bash
pnpm dev                 # app de escritorio en modo desarrollo
pnpm --filter @openwork/desktop dev
pnpm --filter @openwork/desktop package:electron:dir   # build sin instalador (rápido)
pnpm --filter @openwork/desktop package:electron       # instalador completo
```

Advertencia real: el monorepo es grande (apps/app ~185k líneas, server ~56k, packages ~82k) y el build de Electron come RAM. Con 4 GB libres se puede developear, pero empaquetar conviene hacerlo en CI. El plan asume que **los instaladores los construye GitHub Actions**, no tu máquina.

### 5.3 Release

El workflow de upstream ya tiene la matriz `macos-latest / ubuntu-latest / windows-latest / windows-arm64`. El fork necesita:

1. Cambiar el trigger a `push: tags: ["v*"]` y `workflow_dispatch`.
2. `permissions: contents: write` y `electron-builder --publish always` contra el repo propio.
3. Secretos: `GITHUB_TOKEN` (automático). Firma macOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` + certificado (opcional al principio; sin firma, macOS muestra Gatekeeper). Firma Windows: `SIGN_WINDOWS=true` + certificado (opcional).
4. Borrar las claves de PostHog/Sentry del build (si no, el fork manda datos a la infraestructura de otro).
5. Tag → build → release con los artefactos + `latest.yml` (el updater propio los lee).

Costo de no firmar: SmartScreen en Windows y Gatekeeper en macOS. Se mitiga con documentación y capturas; para un producto que se comparte por link, alcanza. Firmar macOS cuesta USD 99/año; Windows, un certificado EV de USD 300–500/año. No es requisito del MVP.

### 5.4 Sincronizar con upstream

```bash
git fetch upstream
git rebase upstream/dev        # o merge, si preferís historial
pnpm install && pnpm -r build
# probar: abrir app, crear workspace, ver que las skills cargan, exportar un doc
git push --force-with-lease
```

Reglas para que el rebase duela poco:
- **Un commit por preocupación** (marca, seed, updater, telemetry, i18n). Así un conflicto se resuelve archivo por archivo.
- Los archivos de mayor conflicto (`electron-builder.base.yml`, `welcome-route.tsx`, `welcome-page.tsx`) se tocan **lo mínimo** y se aíslan en su propio commit.
- `git config rerere.enabled true` para que Git recuerde resoluciones.
- Un workflow semanal que hace el rebase en una rama y abre un PR; si falla, avisa. Mejor enterarse un lunes que el día que hay que publicar.
- Fijar la versión del binario de OpenCode que se empaqueta y correr el validador del pack (`scripts/validar.py`) en CI: si upstream cambia el loader de skills, el CI lo detecta antes que ella.

Frecuencia recomendada: **mensual** para el producto, semanal solo mirar el PR automático. No hace falta correr detrás de cada release.

---

## 6. Ecosistema de OpenCode: qué sumar y qué ignorar

Revisado `opencode.ai/docs/ecosystem/` (nov-2026). Filtro: ¿le sirve a una estudiante que no programa, sin agregar cuentas ni riesgo?

| Pieza | Qué aporta | Veredicto |
|---|---|---|
| **opencode-websearch-cited** | Búsqueda web con citas al estilo Google grounded | **Sumar** si el proveedor lo soporta: refuerza la regla "toda cifra con fuente" |
| **opencode-tavily** | Búsqueda, extracción, crawling y deep research | **Sumar como opcional**: requiere clave gratis de Tavily; sirve para páginas de INDEC/ALADI que no se dejan leer |
| **opencode-notifier** | Notificaciones de escritorio al terminar o pedir permiso | **Sumar**: los estudios tardan; ella puede hacer otra cosa |
| **opencode-dynamic-context-pruning** | Recorta salidas viejas de herramientas para ahorrar tokens | **Opcional**: útil en sesiones largas, pero puede borrar contexto de fuentes; off por defecto |
| **opencode-firecrawl** | Scraping/crawleo vía Firecrawl | **Opcional**: otra cuenta y costo; solo si aparece un sitio terco |
| **opencode-supermemory** | Memoria persistente entre sesiones | **No por defecto**: manda contenido a un tercero; para trabajos académicos, mejor memoria local en `AGENTS.md` del workspace |
| **opencode-md-table-formatter** | Ordena tablas Markdown | Cosmético; **opcional** |
| **oh-my-opencode** | Paquete grande de agentes, LSP/AST, tools | **No**: solapa con OpenWork y trae superficie de conflicto |
| **opencode-conductor / micode / octto** | Flujos spec → plan → implement, brainstorming | **No**: son para desarrollo; OpenWork ya tiene plan y Automations |
| **opencode-scheduler** | Cron con launchd/systemd | **No**: OpenWork ya trae Automations |
| **opencode-pty / shell-strategy / morph / codex-auth / gemini-auth** | Shell, edición de código, login de proveedores | **No** para este público |
| **opencode-wakatime / sentry-monitor / vibeguard / jfrog / supabase / daytona** | Telemetría, enterprise, infra | **No** |

### Lo que ya trae OpenWork y conviene explotar antes que sumar plugins

- **MCP Apps / dashboards**: se puede renderizar una calculadora de cotización o una ficha interactiva en el chat, sin que los datos vayan al modelo. Un widget "armá tu escalera EXW→CIF" sería un diferencial real.
- **Automations**: "cada lunes revisá si cambió el arancel de la NCM X y avisame". Es el reemplazo natural de `opencode-scheduler`.
- **Browser panel / computer-use**: para sitios que no tienen API (Trade Map, aduanas), sin pedirle a ella que copie y pegue.
- **Subagentes en paralelo**: `investigador-mercados` ya puede lanzar `explorador-fuentes` y el análisis de datos a la vez.
- **`spreadsheet_*` nativo**: lee y escribe `.xlsx` reales; suficiente para el MVP.

Conclusión de ecosistema: **dos plugins como mucho** (websearch-cited y notifier) y el resto se resuelve con lo nativo. Cada plugin extra es una dependencia que puede romper el arranque de una app que tiene que "simplemente funcionar".

---

## 7. Estimación por tarea

Días de un dev solo, con el repo ya clonado y build funcionando. "MVP" = instalable y usable; "v1" = sin Python y con acabado.

| # | Tarea | Días | Riesgo | Fase |
|---|---|---|---|---|
| 1 | Fork, remotes, build reproducible en CI, versiones exactas | 3 | Medio (entorno) | MVP |
| 2 | Marca: nombre, iconos, appId, productName, ventana | 2 | Bajo | MVP |
| 3 | Seed del pack + marcador de versión + "Restaurar pack" | 3 | Medio | MVP |
| 4 | Primera vez en castellano (modelo, carpeta, 3 tarjetas) | 4 | **Alto** (welcome-route) | MVP |
| 5 | Traducir pantallas del día 1 (`es.ts` selectivo) | 2 | Bajo | MVP |
| 6 | Apagar PostHog/Sentry; updater y publish propios | 1 | Bajo | MVP |
| 7 | Workflow de release + artefactos + probar instalador en Windows limpio | 3 | **Alto** (firma/SmartScreen) | MVP |
| 8 | QA: 3 flujos reales del pack (cotización, estudio, TFI) en la app | 4 | Medio | MVP |
| 9 | Guía de instalación con capturas + texto de honestidad académica | 1 | Bajo | MVP |
| **Subtotal MVP** | | **23 días** | | |
| 10 | `comex-tools` MCP en Node (Word/Excel con estilo y gráficos) | 8 | Medio | v1 |
| 11 | Widget MCP App de cotización | 4 | Medio | v1 |
| 12 | Traducción completa de `es.ts` (1.800 claves) | 6 | Bajo | v1 |
| 13 | Automations de ejemplo ("vigilá aranceles") | 2 | Bajo | v1 |
| **Subtotal v1** | | **+20 días** | | |

Si en lugar del MCP en Node se elige PyInstaller (fase 1.5, ~3 días), el subtotal v1 baja a **+15 días** y el producto ya no necesita Python. El MCP en Node se reserva para cuando hagan falta gráficos y estilos propios.

Lectura honesta: **MVP en ~4–5 semanas a medio tiempo** (23 días-dev), **v1 en ~7–9 semanas** según cómo se resuelvan los entregables. Si se recorta la primera vez a un solo paso (elegir modelo + carpeta, sin tarjetas), el MVP baja a ~15 días.

Mantenimiento: **1–2 días/mes** de rebase + release, y una tarde extra cuando upstream toque `welcome-route` o `electron-builder`. Con el fork profundo serían 4–5 días/mes.

---

## 8. Riesgos y cómo se manejan

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Upstream mueve `welcome-route` / builder y el rebase duele | Alta | Medio | Diff mínimo, commits por tema, PR semanal automático, `rerere` |
| SmartScreen asusta y no instala | Alta | **Alto** | Capturas paso a paso, video de 40 s, hash público; firmar cuando haya usuarios |
| macOS bloquea la app sin firmar | Media | Medio | Misma guía; firmar Apple (USD 99) si hay usuarios Mac |
| El pack se rompe con un cambio del loader de skills | Media | Alto | `validar.py` en CI + test que crea un workspace y lista skills |
| Costo de API del modelo | Media | Medio | Onboarding claro, opción ChatGPT sign-in, modelo local, medidor de gasto |
| Datos de la estudiante a un tercero | Baja | **Alto** | Sin telemetría, sin memoria en la nube por defecto, aviso explícito |
| Licencia/marca | Baja | Alto | Respetar MIT + `ee/`, no usar "OpenWork" como nombre, NOTICE con atribución |
| Soporte: "no me anda" | Alta | Medio | Logs exportables, botón "restaurar pack", guía de 5 problemas frecuentes |

---

## 9. Legal y licencias (leer antes de publicar)

- **MIT fuera de `ee/`**: se puede forkear, modificar y distribuir, conservando el aviso de copyright y la licencia. Agregar un `NOTICE` que diga "basado en OpenWork (different-ai), MIT" y link al repo original.
- **`ee/` tiene otra licencia** (enterprise). No se usa, no se copia, no se redistribuye. El fork no debe compilar esa carpeta.
- **Marca**: no llamar al producto "OpenWork" ni usar su logo. Nombre propio ("Comex Desk", "Mesa de Comercio Exterior") y aclarar que es un fork no oficial.
- **Pack**: licencia propia (MIT o CC BY-NC-SA). Los scripts son tuyos; las skills, también.
- **No redistribuir** las skills `docx`/`xlsx`/`pptx`/`pdf` de Anthropic ni sus scripts. El pack usa implementaciones propias (`informe_docx.py`, `tabla_xlsx.py`).
- **Fuentes y datos**: Trade Map/Comtrade tienen términos de uso; no embeber claves de API ni datos de pago. La app no incluye bases de datos: consulta en vivo con la cuenta de ella.
- **Tipografías e iconos**: usar OFL/system fonts y arte propio o CC0. Revisar los assets que trae upstream antes de reusar.
- **Privacidad**: política corta y visible: qué se manda al proveedor del modelo, qué se guarda local, cómo se borra. Sin PostHog/Sentry, es fácil de cumplir.

---

## 10. Qué haría esta semana (orden concreto)

1. **Congelar el pack**: correr `python3 scripts/validar.py`, `instalar.sh` con un `HOME` falso y el caso de cotización completo. Sin esto, el fork distribuye piezas que no cargan.
2. **Probar el flujo sin fork**: instalar OpenWork oficial, copiar el pack a `~/.config/opencode`, hacer los 3 flujos reales. Medir dónde se traba ella (eso define qué pantalla de primera vez hace falta).
3. **Crear el fork y el CI**: build vacío con la marca vieja, solo para confirmar que compila en Actions. Es el paso que descubre los problemas de entorno temprano.
4. **Hacer el seed** (sin UI): copiar el pack al arrancar y verificar que las skills aparecen en un workspace nuevo.
5. **Recién después** la primera vez en castellano y el instalador.

Si en el paso 2 el flujo oficial ya le resulta aceptable, **no hagas el fork todavía**: el pack standalone es más barato de mantener y el fork se justifica cuando haya que repartirlo a gente que no abre una terminal.

---

## 11. Resumen para decidir

- **Costo del fork fino:** ~23 días-dev de MVP, ~43 con v1. **Mantenimiento:** 1–2 días/mes.
- **Beneficio:** una app que se instala con dos clicks, ya en castellano, con el pack adentro, sin Python y sin cuenta obligatoria. Eso es lo que separa "un pack que le pasás a una amiga" de "un producto".
- **Costo de no hacerlo:** el pack sigue sirviendo, pero cada persona que lo recibe necesita terminal, Python y saber qué es un archivo `SKILL.md`. Para una sola usuaria, alcanza; para distribuirlo, no.
- **La decisión racional:** fork fino **solo si el objetivo es distribuirlo**. Si el objetivo es que ella lo use ya, instalá el pack en su OpenWork y dejá el fork para cuando haya 5–10 personas esperando.
