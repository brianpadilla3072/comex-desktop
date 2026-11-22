# Catálogo local de skills (repos clonables)

Este documento resume los repositorios de skills que se pueden importar automáticamente
con el botón **“Instalar”** del catálogo sugerido (o manualmente con `git clone`).
No requiere acceder a sitios externos.

## Cómo instalar (manual)

```bash
# 1. Clonar el repo
git clone --depth 1 <URL>

# 2. Copiar las carpetas que contienen SKILL.md al skill root del proyecto
#    (normalmente <proyecto>/.opencode/skills/ o la carpeta elegida en la app)
cp -r <repo>/<ruta-con-SKILL.md>/* <proyecto>/.opencode/skills/
```

En la app de escritorio, el botón **“Instalar”** del catálogo hace esto automáticamente
(clone + detección de `SKILL.md` + copia), saltando las skills ya existentes.

## Repos verificados (con SKILL.md)

| Repo | Skills aprox. | URL |
|------|---------------|-----|
| Impeccable | diseño UI/UX | https://github.com/pbakaus/impeccable |
| Anthropic Skills | colección oficial | https://github.com/anthropics/skills |
| Superpowers | flujos de ingeniería | https://github.com/obra/superpowers |
| Vercel Agent Skills | React/Next.js | https://github.com/vercel-labs/agent-skills |
| Claude Skills (Alirezarezvani) | colección amplia (~483) | https://github.com/alirezarezvani/claude-skills |
| Microsoft Skills | Azure SDK/Foundry (~211) | https://github.com/microsoft/skills |
| Azure Skills | escenarios Azure (~89) | https://github.com/microsoft/azure-skills |
| Power Platform Skills | Power Platform (~134) | https://github.com/microsoft/power-platform-skills |

## Directorios de skills individuales (no clonables como repo)

- https://mcpservers.org/es/agent-skills — directorio de skills por organización (Anthropic, OpenAI, GitHub, Microsoft, Cloudflare, Figma, Vercel, Google, Notion, etc.). Cada skill enlaza a su repo/autor; no es un repo único para clonar.
- https://mcpservers.org/es/webmcp — directorio de servidores MCP/WebMCP (no skills).

## Notas

- La importación automática valida la URL contra una allowlist (los repos de la tabla).
- Los repos muy grandes (ej. `alirezarezvani/claude-skills`) pueden tardar varios minutos.
- Si una skill ya existe en el proyecto, se salta (no se sobrescribe).
- Requiere `git` disponible en el PATH del proceso de la app de escritorio.
