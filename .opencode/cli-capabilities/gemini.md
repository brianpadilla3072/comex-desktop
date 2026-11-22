# Capacidades de Gemini CLI (probe)

Fecha: 2026-11-21
Binario: /home/brian/.npm-global/bin/gemini
Versión: 0.70.0

## Autenticación y cuota
- Autenticado: sí (Google account).
- Cuota: **EXCEDIDA** (429). Free tier: generate_content requests per day = 0, input tokens per day = 0. Retry en ~5h42m.
- Requiere `--skip-trust` en modo headless (directorio no confiado).

## Modos de permiso
- `--approval-mode yolo`: auto-aprueba todo.
- `--approval-mode auto_edit`: auto-aprueba ediciones.
- `--approval-mode plan`: solo lectura.
- `--approval-mode default`: pide aprobación.

## Capacidades
- ❌ No usable ahora: cuota excedida (429). Reintentar en ~6h.
- ⚠️ Requiere ripgrep (`rg`) en PATH (se agregó symlink a ~/.local/bin/rg).
- ✅ Responde texto (cuando hay cuota).
- ✅ Puede editar con `--approval-mode yolo` (no probado por cuota).

## Cuándo usar
- Solo cuando la cuota se renueve. Mientras tanto, usar OpenCode (gratis, sin cuota limitante).

## Límites
- Cuota diaria de free tier (429). Retry en ~6h.
- Requiere `--skip-trust` en headless.
- Requiere `rg` en PATH.