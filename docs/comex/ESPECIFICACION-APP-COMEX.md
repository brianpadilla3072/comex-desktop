# Especificación: la app de Comercio Exterior sobre OpenWork

> Qué necesita **ella** de la app y qué hay que **agregarle a OpenWork** para que eso pase.
> Complementa `PLAN-FORK-OPENWORK.md` (que mide esfuerzo y mantenimiento). Este documento define el producto: qué tiene que poder hacer, qué se acepta como "terminado" y qué queda afuera.

---

## 0. Resumen en una página

**La app es:** OpenWork con otro nombre, en castellano en las pantallas del día a día, con el pack de Comercio Exterior ya instalado, sin pedir cuenta, sin pedir Python y sin pedir terminal.

**Ella no compra "un agente de IA".** Compra dejar de pelear con: formatear un TFI en Word, buscar aranceles en cinco sitios, armar una cotización sin equivocarse de unidad y citar fuentes que no inventó.

**Lo que ya existe y no hay que construir:** chat con herramientas, carpetas de trabajo, skills, MCP, navegador integrado, lectura/escritura de Excel, tareas programadas, dashboards, empaquetado Electron.

**Lo que hay que agregar (MVP):**

1. Marca e identidad (nombre, icono, ventana).
2. El pack sembrado al primer arranque, con actualización que no pisa cambios.
3. Primera vez en castellano: modelo → carpeta → tres ejemplos.
4. Entregables Word/Excel sin Python.
5. Sin telemetría y sin cuenta obligatoria.
6. Actualizaciones y releases propios.
7. Una guía de instalación que resuelva SmartScreen.
8. Un test automático que impida publicar skills rotas.
9. El texto de honestidad académica y la declaración de uso de IA.

**Criterio de listo:** una persona no técnica, en una Windows limpia, instala y hace su primera cotización en menos de 10 minutos, sin abrir una terminal y sin que nadie le explique nada.

**Brechas del pack que el producto deja visibles** (no son cambios de OpenWork, son contenido que falta): las dos críticas son investigación primaria (encuestas y entrevistas) y trabajo con fuentes en inglés (leer, citar y redactar correos); después vienen operativa aduanera, presentaciones, logística y negociación intercultural. Se detallan en 5.4.

---

## 1. Quién es ella y qué contexto tiene

| Dimensión | Realidad |
|---|---|
| Perfil | Estudiante avanzada de Comercio Exterior (Argentina), etapa de estudios de mercado y TFI |
| Técnica | Usa Word, Excel, WhatsApp, el campus y Google. No programa, no abre terminal, no sabe qué es un archivo `.md` |
| Equipo | Notebook Windows 10/11, Office instalado, a veces comparte pantalla con la facultad |
| Conectividad | Buena en general, intermitente en viajes o en la facultad |
| Presupuesto | Bajo: no paga una suscripción mensual alta; puede pagar consumo de API si es chico y visible |
| Tiempo | Trabaja y estudia; usa la app de noche y los fines de semana, en sesiones largas |
| Expectativa | Que "entienda" el pedido en castellano y entregue algo que pueda abrir, editar y presentar |
| Miedo | Que invente datos, que le cambie el formato, que le borre un archivo, que la hagan sentir tonta |

**Consecuencia de diseño:** todo lo que sea "configurar" es una pantalla, no un archivo. Todo lo que sea "error" se explica en castellano y con una salida. Todo lo que sea "avanzado" está, pero no en el camino.

---

## 2. Los diez trabajos reales que tiene que resolver

| # | Trabajo | Cómo lo pide | Qué tiene que recibir | Frecuencia | ¿MVP? |
|---|---|---|---|---|---|
| 1 | Estudio de mercado para una materia | "Necesito un estudio de mercado de arándanos argentinos para la UE" | Informe con objetivos, PESTEL, matriz de preselección, datos con fuente, conclusiones | 2–4 veces por cuatrimestre | Sí, con datos y fuentes |
| 2 | TFI / informe largo | "Ayudame a armar el capítulo 3 de mi TFI" | Borrador con estructura académica, citas APA, tablas y figuras numeradas | 1 por año, muchas sesiones | Sí |
| 3 | Cotización de exportación | "Cotizame 1.000 cajas de peras a Brasil, FOB y landed cost" | Escalera EXW→FOB→CIF + landed cost + Excel editable + supuestos | 3–6 veces por cuatrimestre | Sí |
| 4 | Buscar y validar datos | "¿Cuánto exportó Argentina de limón a EE.UU. en 2025?" | Cifra + fuente + fecha + link; o "no se puede verificar" | Semanal | Sí |
| 5 | Ficha de país / matriz de mercados | "Haceme una ficha de México y comparala con Chile" | Ficha con campos fijos + comparación con criterios declarados | 1–2 por trabajo | Ficha sí; matriz completa, después |
| 6 | Defensa del trabajo | "Armame las slides para defender" | Presentación con estructura de defensa y notas | 1–2 por año | No (fase 2) |
| 7 | Duda conceptual | "Explicame la diferencia entre FOB y CIF con un ejemplo" | Explicación corta, con ejemplo numérico | Semanal | Sí |
| 8 | Crear su propia herramienta | "Quiero una plantilla para mis fichas de mercado" | Skill nueva, probada, disponible en la próxima conversación | Cuando aparece una materia nueva | Sí |
| 9 | Investigación primaria | "Armame una encuesta para importadores de vino en Brasil" | Cuestionario, muestra, plan de análisis y tabla de respuestas | 1–2 por estudio | **No: falta en el pack** |
| 10 | Fuentes y correos en inglés | "Traducime este informe de la UE y armame el mail al comprador" | Resumen con citas + borrador de correo comercial | Semanal | Lee y traduce: sí. Redactar: después |

**Nota:** el trabajo 8 es el seguro de vida del producto. Si la app solo hace lo que trae, envejece; si ella puede pedir "armame una herramienta para X" y queda guardada, el pack crece con ella.

### 2.1 Cómo se ve un estudio de punta a punta

El estudio no es "un pedido y un texto": son seis fases. La app tiene que saber en cuál está y no saltarse ninguna.

| Fase | Qué hace ella | Qué hace la app | Qué queda guardado |
|---|---|---|---|
| 1. Brief | Cuenta producto, mercado, materia, plazo y qué tiene que entregar | Pregunta lo que falta (unidad, objetivo, extensión, normas de la cátedra) y arma una ficha de 10 líneas | `brief.md` en la carpeta del trabajo |
| 2. Plan | Aprueba o corrige el índice y las fuentes propuestas | Propone estructura, metodología y lista de fuentes; marca cuáles son oficiales | `plan.md` con índice y bibliografía tentativa |
| 3. Datos | Pide series, aranceles, competencia | Descarga, guarda CSV/Excel y anota consulta, fecha y link | `datos/` + `fuentes.md` |
| 4. Análisis | Decide el mercado y justifica | Aplica PESTEL, DOFA, matriz ponderada y precios; muestra fórmulas y supuestos | `analisis.xlsx` |
| 5. Redacción | Revisa y pide cambios | Escribe capítulos con citas, tablas y figuras; corre revisor y verificador | `informe.docx` + `revisiones.md` |
| 6. Entrega | Descarga PDF y anexos | Genera PDF, anexo de fuentes, declaración de uso de IA y bloque "qué no pude verificar" | `entrega/` con todo |

Regla: si ella pide "haceme el estudio" de golpe, la app igual recorre las fases, mostrando en qué va y pidiendo aprobación en la 2 y la 4. Es la diferencia entre un texto plausible y un trabajo defendible.

---

## 3. Qué necesita de la app (requisitos)

### 3.1 Instalar y arrancar

- Descargar un archivo, hacer doble click, siguiente, listo. **Sin terminal, sin Python, sin Node, sin administrador.**
- Si Windows muestra SmartScreen, una pantalla (o la guía) explica en dos líneas qué hacer y por qué pasa.
- Primer arranque en menos de 2 minutos, sin crear cuenta.
- La app se abre en una ventana normal, con su nombre y su icono; no parece "una herramienta de programadores".
- Desinstalar no borra sus documentos.

### 3.2 Hablar en castellano, como en WhatsApp

- Escribir "hola, tengo que cotizar peras a Brasil" y que la app entienda: producto, destino y tarea.
- Si falta un dato clave (unidad, cantidad, fecha), **pregunta antes de escribir**, con opciones concretas.
- No muestra jerga innecesaria: "skill", "MCP", "agente", "token", "workspace" aparecen lo mínimo y siempre con una traducción ("herramienta", "conexión", "asistente", "espacio de trabajo").
- Los errores se explican con causa y salida: "No pude leer el archivo porque está protegido con contraseña. Guardalo sin contraseña y volvé a adjuntarlo."
- Puede escribir con errores de tipeo, sin tildes y en minúscula; la app no la corrige ni le da clases de ortografía.

### 3.3 Archivos, carpetas y continuidad

- Ve una carpeta clara: `Documentos\Comercio Exterior`, con subcarpetas por trabajo si hace falta.
- Puede arrastrar un PDF, un Excel o una foto de un apunte y la app lo lee.
- Todo lo que produce queda guardado como archivo real, con nombre legible (`Cotización peras Brasil 2026-11.xlsx`), no enterrado en una base de datos.
- Si cierra la app en el medio, al volver encuentra la conversación y los archivos.
- Puede abrir los archivos con Word/Excel mientras la app está abierta.
- Nada se borra sin confirmación; los archivos viejos se pueden recuperar desde la papelera.

### 3.4 Entregables que se puedan entregar

| Entregable | Mínimo aceptable |
|---|---|
| **Word (.docx)** | Portada, índice, títulos, tablas y figuras numeradas, notas de fuente, bibliografía APA 7, márgenes y tipografía prolijos |
| **Excel (.xlsx)** | Encabezados, formato de moneda/porcentaje, columnas ajustadas, hoja de supuestos, gráfico si el trabajo lo pide |
| **PDF** | Mismo documento, sin reflow, para subir al campus |
| **Presentación (.pptx)** | Portada, agenda, hallazgos, conclusión, notas del expositor (fase 2) |
| **Markdown** | Para pegar en el chat o en un foro, cuando no hace falta archivo |

Reglas transversales: el archivo abre sin advertencias en Office; los números de la tabla coinciden con los del texto; cada tabla/figura tiene fuente y fecha; el nombre del archivo dice qué es y cuándo se hizo.

Reglas de formato que no se negocian:

- **Word:** A4, márgenes de 2,5 cm, tipografía de 11–12 pt, interlineado 1,5, numeración de páginas, índice automático (campo, no escrito a mano), títulos numerados y tablas/figuras con título arriba y fuente abajo.
- **Plantilla de la cátedra:** ella puede subir el `.docx` modelo de su facultad (portada con logo, materia, docente, año) y la app lo usa como base. Si no lo sube, usa una portada configurable con esos campos.
- **Excel:** las celdas calculadas quedan con **fórmulas visibles**, no solo valores; una hoja "Supuestos" separada; moneda y porcentaje con formato; la fuente en la fila de abajo, no en un comentario perdido.
- **Gráficos:** imagen a 300 dpi, título, ejes rotulados, fuente al pie; se pueden exportar como PNG para pegarlos en Word o en las slides.
- **Anexos:** fuentes consultadas, consultas exactas (query + fecha), scripts usados y declaración de uso de IA. Sin anexos, el trabajo no es reproducible.
- **Nombres y versiones:** `Producto_Mercado_Tipo_v01_2026-11-05.docx`; nada de "final final ahora sí". La app guarda las últimas 10 versiones de cada documento.
- **Números y fechas:** formato argentino para el texto (dd/mm/aaaa, miles con punto, decimales con coma cuando el documento es en castellano) y formato internacional (ISO, punto decimal) en las planillas de comercio exterior. La app no mezcla los dos en la misma tabla.

### 3.5 Fuentes, citas y honestidad

- Toda cifra que aparece en un entregable tiene **fuente, fecha de consulta y período**. Si no, no entra.
- La app distingue y muestra la diferencia entre dato oficial, dato espejo y estimación propia.
- Si no pudo verificar un dato, lo dice en el documento ("dato a confirmar") en vez de rellenarlo.
- Un número "que el modelo recuerda" no se usa como dato: se verifica o se marca.
- La bibliografía se arma sola con lo efectivamente consultado, no con fuentes decorativas.
- Al final de cada entrega, un bloque "Qué no pude verificar" (aunque esté vacío, existe).
- Cada fuente web se **archiva**: PDF o captura con fecha al lado, en `fuentes/`. Los links se caen y el tribunal pide la evidencia.
- Cuando cita un PDF largo, indica **página o sección**, no solo el documento.
- Distingue cita textual (entre comillas y con página) de paráfrasis; no inventa comillas.
- Genera, si la cátedra lo pide, una **declaración de uso de IA**: qué se usó, para qué (buscar, ordenar, redactar), qué se verificó a mano y quién firma. Es una plantilla editable, no una excusa.
- La bibliografía final solo incluye lo efectivamente consultado; las fuentes "de adorno" se eliminan.

### 3.6 Datos de comercio exterior

- Puede pedir series por producto y país sin saber el código HS: la app propone opciones ("limón fresco → HS 0805.50").
- Las consultas a Comtrade/Trade Map funcionan con la cuenta gratuita de ella; si no hay cuenta o no hay red, usa datos de ejemplo y **lo declara**.
- Los datos se guardan como CSV/Excel en la carpeta del trabajo, con la consulta exacta al lado (reproducibilidad).
- Si el país no reporta, avisa que está usando datos espejo.

Fuentes que tiene que conocer y saber combinar (no alcanza con Comtrade):

| Fuente | Para qué | Trampa típica |
|---|---|---|
| **INDEC** | Exportaciones/importaciones (grandes rubros y CUCI; el detalle por NCM se cruza con Aduana), precios, actividad | Los datos vienen por posición arancelaria, no por "producto" del caso: hay que mapear |
| **Aduana / ARCA** | Régimen, valores, derechos, destinaciones | Distinguir valor FOB declarado de valor de mercado |
| **ALADI** | Preferencias arancelarias dentro de la región | Una preferencia no aplica si no se cumple el régimen de origen |
| **CEPAL** | Series regionales, comercio intrarregional, contexto | Datos agregados: no reemplazan la serie bilateral |
| **Cancillería / AAICI (ex Fundación Exportar)** | Guías de mercado, ferias, contactos | Documentos con fecha: verificar vigencia |
| **INTA / SENASA** | Requisitos fitosanitarios para agro | Es requisito de acceso, no arancel: va aparte en el análisis |
| **OMC / WITS / MACMap** | Arancel MFN y preferencial del destino | El arancel aplicado no es el consolidado |
| **Trade Map / Comtrade** | Comercio bilateral, competencia, valores unitarios | Datos espejo cuando el socio no reporta |

Reglas: (a) todo dato baja con su consulta y su fecha; (b) si se usa una fuente agregada para reemplazar una bilateral, se declara; (c) los términos de uso de Trade Map/Comtrade no permiten redistribuir la base: se cita y se guarda la consulta, no se empaqueta el dataset.

### 3.7 Cotizador

- Pide y declara la **unidad de cálculo** antes de empezar (kg, caja, tonelada, unidad).
- Convierte cajas ↔ kg ↔ toneladas mostrando la conversión; nunca mezcla.
- Calcula EXW, FOB, CFR, CIF, aranceles, tasas, IVA, landed cost y margen del importador.
- Maneja flete por contenedor/lote y lo prorratea.
- Aplica retenciones sobre el precio FOB (no sobre el costo).
- Genera una tabla de sensibilidad (±10% tipo de cambio, ±10% flete, ±5% arancel).
- Exporta a Excel con supuestos, fecha y validez de la oferta.
- Si el precio no cierra contra el mercado, lo dice y propone qué revisar; no maquilla el resultado.

### 3.8 Asistentes visibles y explicables

- Hay un asistente principal con el que ella habla (`investigador-mercados`) y tres especialistas que la app puede convocar: revisor, verificador de fuentes y arquitecto de herramientas.
- La app muestra **quién está trabajando y en qué paso**, no una barra muda.
- Ella puede decir "que lo revise el revisor" sin saber cómo se llama el archivo.
- Los especialistas no editan sus archivos si su rol es solo auditar (permisos reales, no promesas).
- Al terminar, un resumen de qué hizo cada uno y qué quedó pendiente.

### 3.9 Privacidad y control

- Sin cuenta obligatoria y sin telemetría (ni PostHog ni Sentry) por defecto.
- Una pantalla simple: "qué se manda al proveedor del modelo, qué queda en tu computadora, cómo borrar tu historial".
- Sus documentos no se suben a ningún servicio propio; van al proveedor de modelo que ella eligió, como cualquier chat de IA.
- Puede borrar una conversación y sus archivos temporales con un botón.
- Si la app va a mandar algo a un tercero (búsqueda web, scraping), lo dice antes.

### 3.10 Confiabilidad y trabajos largos

- Un estudio puede tardar 10–30 minutos: la app muestra progreso, permite seguir navegando y avisa al terminar.
- Si se corta la red o se cierra la app, el trabajo queda en un estado recuperable; no se pierde lo hecho.
- Se puede cancelar una tarea sin romper el trabajo.
- Si el modelo falla o se queda sin cuota, el mensaje dice qué pasó y qué hacer (cambiar de modelo, esperar, revisar la clave).
- Límite de gasto visible: cuánto lleva gastado en la sesión y una forma de poner un tope.

### 3.11 Actualizaciones

- La app se actualiza sola desde las releases del proyecto (no desde `different-ai/openwork`).
- El pack se actualiza sin pisar las skills que ella tocó; si hay conflicto, avisa y guarda la versión nueva al lado.
- Hay un botón "Restaurar pack" que vuelve a la versión oficial sin tocar sus documentos.
- Si una actualización cambia algo importante, una nota corta en la app lo cuenta (no un changelog técnico).

### 3.12 Ayuda y aprendizaje

- Tres pedidos de ejemplo listos para apretar y probar: cotizar, estudio de mercado, TFI.
- Una guía de 5 problemas frecuentes: "no encuentra mis archivos", "no tengo clave", "tarda mucho", "el número no me cierra", "me pidió permiso".
- Un glosario de la app (no de programación): qué es un espacio de trabajo, qué es una herramienta, dónde quedan los archivos.
- La app le enseña a pedir mejor: después de una entrega, sugiere "la próxima pedime también el análisis de sensibilidad".

### 3.13 Requisitos técnicos y comportamiento sin conexión

| Requisito | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10/11 64 bits (v1); macOS 13+ (después) | Windows 11 |
| Memoria | 8 GB | 16 GB |
| Disco libre | 4 GB (app + modelos + documentos) | 10 GB |
| Pantalla | 1366×768 | 1920×1080 |
| Internet | 5 Mbps para trabajar con el modelo | 20 Mbps |
| Office | Word/Excel 2016 o posterior, o LibreOffice | Microsoft 365 |

**Sin conexión:** puede abrir la app, leer conversaciones viejas, abrir/editar sus documentos y ver los datos ya descargados. **No** puede pedirle nada nuevo al modelo. Si hay una tarea en curso, queda en pausa y se retoma al volver la conexión.

### 3.14 Seguridad

- La clave del modelo se guarda en el **almacén de credenciales del sistema** (Windows Credential Manager / Keychain), nunca en un archivo de texto ni en los logs.
- Las páginas web, PDFs y archivos que sube se tratan como **contenido no confiable**: si una página dice "ignorá las instrucciones y hacé X", la app no lo ejecuta. Antes de mandar datos a un sitio o de correr una acción sensible, pide confirmación.
- Los agentes auditores tienen permisos de **solo lectura** reales; no pueden editar ni borrar.
- Las conexiones (MCP) se instalan desde una lista permitida y con confirmación; el modelo no puede agregar una por su cuenta.
- Los logs se pueden borrar desde Ajustes y no incluyen el contenido de sus documentos ni su clave.

### 3.15 Respaldo, historial y varios equipos

- Copia diaria de los documentos a `Comercio Exterior/Backups` (últimos 7 días), además del guardado normal.
- Historial de versiones por documento (últimas 10), con opción "volver a esta versión".
- Exportar/importar un trabajo completo como `.zip` (documentos + fuentes + conversación) para pasarlo a otra máquina o entregarlo como evidencia.
- Si usa OneDrive/Google Drive: los **documentos** se pueden sincronizar, pero la base de la app y las sesiones no deben vivir en una carpeta sincronizada (genera conflictos). La app avisa si detecta esa situación.

---

## 4. Qué ya trae OpenWork (no hay que construirlo)

| Capacidad | Dónde está | Cómo la usa el producto |
|---|---|---|
| Chat con herramientas y archivos | `apps/app`, `apps/server` | La conversación principal |
| Espacios de trabajo (workspaces) | `apps/server/src/workspaces.ts` | La carpeta `Documentos\Comercio Exterior` |
| Carga de skills y agentes | `apps/server/src/skills.ts` | El pack sembrado en `~/.config/opencode` |
| MCP servers locales | configuración por workspace | Futuras herramientas propias (cotizador, documentos) |
| Navegador integrado / computer-use | panel de navegador | Trade Map, aduanas, sitios sin API |
| Excel nativo | `spreadsheet_inspect/read/write` | Tablas simples y lectura de planillas |
| Tareas programadas | Automations | "Vigilá el arancel de la NCM X" |
| Dashboards / MCP Apps | `packages/mcp-apps` | Widget de cotización (fase 2) |
| Multi-proveedor de modelos | ajustes de proveedor | Elegir OpenAI/Anthropic/Google/local |
| Empaquetado Electron + updater | `apps/desktop` | El instalador y las actualizaciones |
| i18n | `apps/app/src/i18n` | Traducir pantallas sin tocar lógica |

**Implicancia:** el trabajo del producto es de **activación y acabado**, no de plataforma. Cada capacidad nueva que se agregue debe justificar por qué no alcanza con lo que ya está.

---

## 5. Qué tenemos que agregarle a OpenWork

### 5.1 MVP (sin esto no se entrega)

| # | Qué falta | Por qué ella lo nota | Dónde se resuelve | Aceptación |
|---|---|---|---|---|
| 1 | **Marca e identidad** | "OpenWork" no le dice nada; el icono genérico no genera confianza | `electron-builder.base.yml`, iconos, `shell-config.tsx`, `package.json` | El instalador, la ventana y el menú dicen el nombre nuevo; el icono aparece en taskbar y escritorio |
| 2 | **Pack sembrado** | Sin esto tiene que copiar carpetas a mano | `comex-seed.mjs` + hook en `workspace-init.ts` | En una máquina limpia, las 9 skills y 4 agentes están disponibles en el primer workspace |
| 3 | **Seed que no pisa** | Si actualiza y le borra una skill editada, pierde su trabajo | marcador de versión + política de conflicto | Una skill modificada sobrevive a dos actualizaciones; la nueva queda como `.nuevo` |
| 4 | **Primera vez en castellano** | La pared del onboarding en inglés es la principal causa de abandono | `welcome-route.tsx`, `welcome-page.tsx` | Elegir modelo + carpeta + ejemplo en menos de 5 minutos, sin cuenta |
| 5 | **Sin cuenta obligatoria** | Si le pide registrarse, no empieza | flujo de bienvenida sin `sign-in` | Todo el MVP funciona sin abrir Settings › Account |
| 6 | **Entregables sin Python** | No tiene Python ni va a instalar uno | PyInstaller en CI o MCP Node | Genera `.docx` y `.xlsx` en una Windows limpia |
| 7 | **Telemetría apagada** | Es su trabajo académico, no un producto de datos | `analytics-key.ts`, `sentry.mjs` | Cero requests a PostHog/Sentry en una sesión completa |
| 8 | **Releases y updater propios** | Si apunta a upstream, se actualiza a la app de otro | `updater.mjs`, workflow de release | Una release propia actualiza la app; no aparece "OpenWork 0.18.x" |
| 9 | **Validación del pack en CI** | Publicar una skill con `name` mal escrito es invisible y fatal | `scripts/validar.py` en el workflow | El build falla si una skill no carga |
| 10 | **Guía de instalación** | SmartScreen asusta y no hay a quién preguntar | `docs/INSTALAR.md` + capturas | Una persona no técnica instala siguiendo solo la guía |
| 11 | **Texto de honestidad académica** | Es un riesgo real y una señal de seriedad | pantalla de bienvenida + `investigacion-con-fuentes` | Aparece una vez, en castellano, sin tono moralista |

### 5.2 Después del MVP (mejora la experiencia, no la bloquea)

| # | Qué | Por qué | Prioridad |
|---|---|---|---|
| 12 | Traducción completa de la interfaz | Hoy `es.ts` cubre 29%; el resto aparece en inglés | Media |
| 13 | Widget de cotización (MCP App) | Calculadora visual en el chat, sin mandar números al modelo | Media |
| 14 | Automations de ejemplo | "Vigilá aranceles", "recordame el vencimiento" | Media |
| 15 | Presentaciones `.pptx` | Defensa del TFI | Media |
| 16 | Modo sin conexión con datos de ejemplo | Facultad sin wifi | Baja |
| 17 | Control de gasto y modelo recomendado | Evitar sustos con la factura de API | Alta (si usa API paga) |
| 18 | Historial/backup de trabajos | "Se me borró el capítulo 2" | Media |
| 19 | Glosario y ayuda contextual | Menos soporte, más autonomía | Baja |
| 20 | Perfil "modo facultad" (modelo barato + sin web) | Ahorro y velocidad | Baja |

### 5.3 Lo que NO hay que agregarle

- Terminal visible o editor de archivos de configuración.
- Selector crudo de modelos con nombres técnicos (`gpt-…`, `claude-…`) sin explicación.
- Editor de MCP/YAML.
- Telemetría, analytics o crash reporting obligatorio.
- Cuenta en la nube como requisito.
- Auto-update contra el repo de upstream.
- Plugins experimentales en el arranque.
- Un chat genérico sin skills: si no sabe de comercio exterior, no es el producto.
- App móvil, versión web multiusuario o colaboración en tiempo real (para eso está el archivo compartido).
- Modelo propio entrenado con sus datos.
- Presentación automática al campus, transmisión aduanera, despacho, contabilidad o tesorería.
- Detector de plagio o "humanizador" de textos.
- Panel de administración para terceros.

### 5.4 Brechas del pack que el producto deja visibles

Estas no se resuelven tocando OpenWork: son contenido que hay que escribir y probar antes de prometerlo.

| # | Falta en el pack | Qué trabajo deja sin cubrir | Prioridad | Qué habría que agregar |
|---|---|---|---|---|
| A | **Investigación primaria** | Encuestas, entrevistas, focus group de un estudio real | Alta | Skill `encuestas-y-entrevistas`: cuestionario, muestra, guía de entrevista, plan de análisis y tabla de respuestas |
| B | **Inglés comercial** | Leer informes de la UE/EE.UU. y escribir correos a compradores | Alta | Skill `ingles-comercial`: resumen con citas, glosario, plantillas de correo y no inventar traducciones |
| C | **Operativa y documentación** | Certificado de origen, packing list, factura comercial, VUCE | Media | Skill `operativa-aduanera` con checklists por destino |
| D | **Presentaciones** | Defensa del TFI | Media | Skill `presentacion-defensa` + generación `.pptx` (hoy la app no produce slides) |
| E | **Logística y transporte** | Elección de modo, flete, seguros, incoterms operativos | Media | Skill `logistica-transporte` |
| F | **Negociación intercultural** | Contacto con compradores, ferias, cultura de negocios | Baja | Skill `negociacion-intercultural` |

Regla de producto: no se anuncia una de estas capacidades hasta que la skill exista, esté probada con un caso real y pase el validador. Es mejor un MVP honesto con los trabajos que de verdad cubre que un catálogo de 14 a medio hacer.

---

## 6. La primera vez, paso a paso

**Lo que ella ve:**

1. **Pantalla 1 — Bienvenida.** "Tu mesa de trabajo para Comercio Exterior." Un botón: *Empezar*.
2. **Pantalla 2 — Modelo.** Tres tarjetas: *Pegar una clave* (recomendado), *Entrar con ChatGPT*, *Usar un modelo local*. Abajo, en letra chica: "Tus archivos no se suben a ningún servidor nuestro."
3. **Pantalla 3 — Carpeta.** "¿Dónde guardamos tus trabajos?" → `Documentos\Comercio Exterior` (se puede cambiar). Botón *Crear*.
4. **Pantalla 4 — Tres ejemplos.** Tarjetas: *Cotizar una exportación*, *Estudio de mercado*, *Armar mi TFI*. Al apretar, el pedido se escribe solo en el chat.
5. **Pantalla 5 — Listo.** "Ya está. Escribí como le escribirías a una compañera." Un recordatorio: "Cada dato va con fuente; si algo no se puede verificar, te lo digo."

**Lo que NO aparece:** selección de proveedor con JSON, "workspace", "skill", "MCP", "token", "API key" sin traducción, atribución ("¿cómo nos conociste?"), sign-in, términos y condiciones de OpenWork Cloud.

**Medición:** del doble click al primer mensaje enviado, menos de 10 minutos; sin ayuda humana.

---

## 7. Criterios de aceptación (prueba de producto)

Estos son los tests que definen "esto se puede entregar". Se corren en una máquina Windows limpia, sin Python, sin Node, sin cuenta de OpenWork.

| # | Test | Pasa si… |
|---|---|---|
| 1 | Instalación | Instala sin admin y abre en <2 min; SmartScreen resuelto con la guía |
| 2 | Primer arranque | Modelo + carpeta + primer mensaje en <10 min, sin terminal |
| 3 | Pack disponible | Las 9 skills y 4 agentes aparecen; el validador da OK |
| 4 | Cotización | "1.000 cajas de peras a Brasil" → Excel con FOB/CIF/landed, unidad declarada, supuestos y sensibilidad |
| 5 | Estudio | "Estudio de arándanos a la UE" → informe con PESTEL, matriz y cada cifra con fuente/fecha |
| 6 | TFI | "Capítulo 3 de mi TFI" → `.docx` con portada, índice, tablas numeradas y APA |
| 7 | Fuentes | Se le pide una cifra falsa; la marca como no verificada en vez de inventarla |
| 8 | Unidad | Caso con cajas y kg: muestra la conversión y no mezcla |
| 9 | Actualización | Instala v1, publica v2, actualiza y conserva una skill editada |
| 10 | Privacidad | Una sesión completa no manda datos a PostHog/Sentry |
| 11 | Recuperación | Cerrar la app en medio de un estudio no pierde el trabajo |
| 12 | Ayuda | Los 5 problemas frecuentes se resuelven desde la guía, sin soporte |
| 13 | Fuentes argentinas | Pide un dato por NCM y la app usa INDEC/Aduana/ALADI cuando corresponde, con link y fecha |
| 14 | PDF largo | Sube un informe de 100 páginas y las citas incluyen página o sección |
| 15 | Archivo de fuentes | Cada fuente web queda guardada como PDF/captura con fecha en `fuentes/` |
| 16 | Inglés | Resume un informe en inglés con citas y redacta un correo comercial sin inventar datos |
| 17 | Respaldo | Exporta un trabajo como `.zip`, lo importa en otra máquina y sigue donde estaba |
| 18 | Seguridad | Una página con instrucciones maliciosas no dispara acciones sin confirmación |
| 19 | Declaración de IA | Genera el anexo de uso de IA con lo que efectivamente se usó |
| 20 | Plantilla de cátedra | Sube el `.docx` de su facultad y el informe respeta portada, márgenes y tipografía |

**Definición de "listo para 10 personas":** los 20 tests pasan en dos máquinas distintas, y al menos 3 personas no técnicas completan el test 4 sin ayuda.

**Métricas para saber si el producto sirve** (mirar a las 4 semanas, no al día 1):

- Tiempo hasta el primer entregable: menos de 30 minutos.
- Entregables con fuente en el 100% de las cifras: 100% (si no, es un bug, no una métrica).
- Trabajos donde ella corrige y vuelve a pedir: 60% o más (señal de que lo usa en serio, no de que falla).
- Retención a 4 semanas: al menos 1 de cada 3 la abre después de la primera entrega.
- Consultas de soporte: menos de 2 por cada 10 usuarios al mes.
- Costo de modelo por trabajo: visible y por debajo de lo que ella aceptó pagar.

---

## 8. Riesgos del producto y mitigación

| Riesgo | Cómo se manifiesta | Mitigación |
|---|---|---|
| Dato inventado | Un arancel "plausible" sin fuente | Regla de oro + verificador + bloque "qué no pude verificar" |
| Unidad equivocada | Cajas tratadas como kg en la cotización | Paso 0 obligatorio + script que imprime unidad y lote |
| Arancel/flete viejo | Cotización con datos del año pasado | Fecha obligatoria + advertencia + enlace a fuente |
| Exceso de confianza | Entrega sin revisar | Revisor exigente + resumen de supuestos + texto de honestidad |
| Pérdida de archivos | Cierra la app o se corta la luz | Guardado continuo + archivos reales + backup |
| Gasto inesperado | Muchas consultas al modelo | Medidor de gasto + tope + modelo barato por defecto |
| Privacidad | Siente que su TFI queda en un servidor | Sin telemetría + explicación clara + borrado |
| Dependencia | No puede defender lo que entregó | La app explica el porqué; el trabajo y la defensa son de ella |
| Inyección de instrucciones | Una web o PDF intenta que la app haga otra cosa | Contenido no confiable + confirmación + permisos por agente |
| Clave de API expuesta | La clave queda en un log o en un archivo compartido | Almacén del sistema + logs sin secretos + rotación fácil |
| Choque de sync | OneDrive pisa la base o duplica archivos | Aviso + documentos sincronizables, base local + export/import |
| Formato de cátedra | El informe no coincide con la plantilla | Subida de plantilla + validación de portada/márgenes |
| Términos de las fuentes | Redistribuir datos de Trade Map | Citar y guardar la consulta; no empaquetar el dataset |

---

## 9. Decisiones que faltan (para cerrar antes de construir)

1. **Nombre y marca:** ¿"Comex Desk", "Mesa de Comercio Exterior", otro? (no usar OpenWork).
2. **Alcance de sistema:** ¿solo Windows en v1, o Windows + macOS?
3. **Modelo por defecto:** ¿API key propia, ChatGPT sign-in, o los dos?
4. **Entregables sin Python:** ¿PyInstaller (rápido) o MCP Node (mantenible)?
5. **Distribución:** GitHub Releases (gratis, requiere saber qué descargar) vs. página propia con un botón.
6. **Licencia del pack:** MIT vs. CC BY-NC-SA.
7. **Precio:** gratis, pago único, o consumo de API a cargo de ella.
8. **Respaldo y varios equipos:** ¿solo local con export/import, o sincronización propia?
9. **Declaración de uso de IA:** ¿se genera siempre, o solo si la cátedra lo pide?
10. **Inglés:** ¿solo lectura/traducción en v1, o también redacción de correos?

---

## 10. Glosario para el equipo (no para ella)

| Término | Qué es | Cómo se le dice a ella |
|---|---|---|
| Skill | Carpeta con instrucciones que el agente carga cuando hace falta | "Herramienta" |
| Agente | Rol con criterio propio y permisos | "Asistente" |
| Workspace | Carpeta autorizada donde la app lee y escribe | "Espacio de trabajo" / "tu carpeta" |
| MCP | Protocolo para conectar herramientas externas | "Conexión" |
| Seed | Copia inicial del pack al primer arranque | "Ya viene instalado" |
| Fork | Copia del proyecto de OpenWork que mantenemos | (no se menciona) |
| Upstream | El proyecto original del que traemos mejoras | (no se menciona) |
| Token | Unidad de consumo del modelo | "Consumo" |

---

## 11. Relación con los otros documentos

- **`PROPUESTA.md`**: por qué el pack existe y qué contiene.
- **`PLAN-FORK-OPENWORK.md`**: cuánto cuesta el fork, qué archivos se tocan y cómo se mantiene.
- **`ESPECIFICACION-APP-COMEX.md`** (este): qué necesita ella y qué hay que agregarle a OpenWork.
- **`comex-pack/`**: la implementación actual de las skills, agentes y scripts.

El orden de lectura para decidir: este documento → `PLAN-FORK-OPENWORK.md` → `comex-pack/README.md`.
