# Estado de implementación general

Actualizado el 11 de noviembre de 2026. Fuente de alcance: fork general de OpenWork para agentes, skills y herramientas. Los nombres históricos Comex no limitan el producto.

| Área | Implementación actual | Evidencia y pendiente |
|---|---|---|
| Alcance | Apertura general sin instalar un pack especializado ni imponer su temática | Instalación explícita y actualización de packs existentes conservadas; regresión de servidor aprobada. |
| Ejecución | OpenCode nativo; selección de modelo, permisos e historial existentes | Las herramientas de la app no constituyen otro motor. Verificar cada versión instalada antes de anunciar soporte de endpoints nuevos. |
| Chat | Correcciones seleccionadas de menciones, chips, fuentes web v2, scroll, preguntas y archivos | Regresiones locales; las imágenes tienen cancelación por contexto y reintentos acotados. |
| Motor | Identidad y conexión consultables desde el compositor | No deduce Go activo de un proveedor configurado ni capacidades de un número de versión. |
| Modelos | Lista con ficha, seis barras, fuentes, estimaciones separadas y precios r5 | 35 precios exactos actualizados; no se crean benchmarks propios ni se asegura costo de completar una tarea. |
| Catálogo | Snapshot incluido, caché SQLite, URL estática opcional y workflow de propuestas | El workflow requiere publicación en la rama predeterminada y permisos de GitHub; no se ejecutó aquí. |
| Tareas locales | Planificador existente conectado a Tareas programadas, modelos nativos, pausa e historial | No exige Den. Nuevas tareas de la UI omiten horarios perdidos salvo opción explícita. Requiere servidor local abierto. |
| Memoria y continuidad | Conversación/proyecto/aplicación; objetivos persistentes y traslado del mismo chat a worktrees | Las notas no equivalen a copiar el historial; el reinicio requiere retomar objetivos. |
| Recuperación | Cuarentena de journals incompatibles y herramienta de backup/verify/restore a carpeta nueva | Pruebas sintéticas con SQLite/WAL; restauración del perfil real pendiente. |
| Mantenimiento del fork | Inventario y propuesta semanal de revisión de releases upstream | No merge automático; la comparación API puede estar recortada y se señala. |
| Distribución | Circuito propio de Windows/Linux y actualizador existente | Instalación limpia y actualización A→B instaladas pendientes; leer política actual en el workflow antes de publicar. |
| Documentos | Runtime documental y vistas previas existentes | La edición avanzada de Office/Univer es una ampliación futura; no se importó un fork antiguo ni dependencias Pro. |

La evidencia de la consolidación está en [local-consolidation](features/local-consolidation/README.md). Los documentos de verificación anteriores conservan su fecha y alcance histórico; no describen necesariamente las funciones actuales. Un test de transporte no mide inteligencia; una captura con fixtures no acredita una instalación; un paquete compilado no acredita una actualización de perfiles reales.
