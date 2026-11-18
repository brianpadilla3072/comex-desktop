# Referencia de UI: la suite de oficina de Claude aplicada a Comex

Investigación sobre la suite de productividad que Anthropic mostró (Docs, Slides, Sheets,
Whiteboard, Data y Design) y su traducción a las superficies de Comex. **No se modificó código
de la aplicación**: este paquete es solo investigación y plan.

| Documento | Qué contiene |
|---|---|
| **[investigacion.md](investigacion.md)** | El informe completo: metodología, anatomía de los cinco productos, 14 patrones, estado actual de Comex, brechas, reglas, plan por fases, anti-patrones y anexos |
| **[investigacion-web-funcionalidades.md](investigacion-web-funcionalidades.md)** | Funcionalidades y diseño/UI por producto con fuentes web oficiales, contraste video vs. docs y guía de replicación |
| **[analisis-repos-tecnologias.md](analisis-repos-tecnologias.md)** | Repos/librerías integrables (licencias, esfuerzo), cómo darle la capacidad a Comex y roadmap |
| **[matriz-decisiones.md](matriz-decisiones.md)** | Contexto concreto para elegir en los bloqueos de los issues #4, #5 y #7 (precios, licencias, riesgos) |
| **[diseno-artefactos.md](diseno-artefactos.md)** | Diseño técnico del épico #1: modelo de datos, shell, split/foco, flag, plan por archivos y tests |
| **[spikes/](spikes/)** | Validaciones reales de Univer core y Excalidraw (versiones, snippets, build,Electron) |
| **[issues/](issues/README.md)** | 7 issues de GitHub ya publicados (épico + 6 funcionalidades) con alcance, criterios de aceptación y referencias |
| `frames/` | 29 capturas (1920×1080) de los momentos en que el video explica cada interfaz |
| [`transcripciones/claude-office-edteam.md`](../../../transcripciones/claude-office-edteam.md) | Transcripción completa con timestamps |

## La fuente

- Video: “Claude lanzó su propio office. ¿Adiós Microsoft?”, EDteam, 21:01.
- <https://www.youtube.com/watch?v=5w9SS8DMr1Y>
- 1080p descargado con `yt-dlp`; frames extraídos con `ffmpeg`; transcripción automática en
  español.

## Los cinco hallazgos que resumen todo

1. **El resultado es un artefacto, no un mensaje.** Docs, Slides, Sheets, Whiteboard y Data
   comparten un shell: header con título y acciones, cuerpo, dock flotante. El chat queda al
   lado. En Comex, las salidas se leen en una caja de 320 px dentro de un diálogo de ajustes.
2. **El cromo desaparece; la acción aparece donde está la selección.** No hay cintas. Hay un
   dock inferior y una barra contextual sobre el objeto tocado. En Sheets, la misma barra cambia
   según la celda: vacía ofrece chips; con número ofrece moneda, decimales y porcentaje.
3. **Leer y conversar conviven.** Split 42/58 o canvas completo con `Mostrar chat`. El usuario
   lee mientras el agente sigue trabajando.
4. **Los datos tienen jerarquía editorial.** KPI grande + etiqueta chica + párrafo narrativo +
   nota metodológica al pie. El dashboard de Sheets se construye sobre la grilla, con líneas
   ocultas y fórmulas vivas (`=SUM(Ventas!$G$2:$G$201)`).
5. **Lo verificable se muestra en el lugar.** Barra `fx`, fuentes de datos, estado `Draft` y
   auditoría como chip. En Comex la auditoría de citas ya existe, pero está escondida como
   párrafo.

## Traducción a Comex en una tabla

| Superficie actual | Qué tiene hoy | Qué toma del video | Fase |
|---|---|---|---|
| Visor de salidas (informe, mapa, flashcards, quiz, tabla) | Se expande inline en el diálogo; `max-h-80`; auditoría como párrafo | Shell de artefacto, columna de lectura, chips de estado, dock, exportar | 1 |
| Paneles (stat, line, bar, table, markdown, changes) | Tarjetas chicas, tabla cruda, SVG de 80 px, hex hardcodeados | KPI editorial, gráficos con ejes y etiquetas directas, formatos, tokens | 2 |
| Panel lateral de sesión | Tabs de artefactos, browser, apps, threads | Abrir una salida como tab y alternar split/canvas | 3 |
| Home del diálogo de gestión | Seis secciones apiladas con “Gestionar” | Hub de estado con tarjetas y filas compactas | 4 |

Detalle completo, criterios de aceptación y riesgos en
[investigacion.md §10](investigacion.md#10-plan-por-fases).

## Qué no se copia

La paleta oscura cálida, el editor de texto rico, el canvas infinito, el panel de diseño
completo, los cuatro formatos de Data y el sistema de permisos por link. El razonamiento está en
[investigacion.md §11](investigacion.md#11-anti-patrones).

## Estado

- Investigación cerrada.
- Sin cambios de código de la app.
- Backlog publicado como issues: [épico #1](https://github.com/brianpadilla3072/comex-desktop/issues/1) y funcionalidades [#2–#7](issues/README.md).
- Los archivos `tmp/ref-claude-office/spec-*.md` son las especificaciones crudas por producto
  (locales, `tmp/` no se versiona); `investigacion.md` las sintetiza.
