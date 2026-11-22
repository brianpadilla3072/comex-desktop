---
name: probe-cli
description: Probar capacidades de un CLI (lectura, escritura, cuota, modos de permiso) y registrar qué puede y qué no
---

Estás por **probar un CLI** (Devin, OpenCode, Codex, etc.) para entender qué puede hacer y qué no.
El probe se hace **solo cuando el usuario lo pide explícitamente** ("quiero configurar el CLI de X").
Cargá `.opencode/skills/herramientas-cli/SKILL.md` (sección "Probe de capacidades") y `.opencode/skills/cerebro-cli/SKILL.md`.

Pasos:
1. `which <cli>`, `<cli> --version`, `<cli> --help`.
2. `<cli> auth status` / `<cli> doctor` (autenticación + cuota).
3. Probe de lectura: pedirle que lea un archivo y reporte.
4. Probe de escritura: pedirle que cree `/tmp/opencode/probe.txt` con 'ok' y lo lea.
5. Registrar el resultado (qué puede, qué no, modos, cuota, límites) en `.opencode/cli-capabilities/<cli>.md` (y opcionalmente en `proyecto/estado.md`).

**Nunca asumir** que un CLI puede hacer algo: probarlo. Lo que vemos roto lo arreglamos / cambiamos de herramienta.

Argumentos: `$ARGUMENTS` (nombre del CLI a probar).