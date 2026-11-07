# Conexiones y packs especialistas

`specialistIntegrations` · self_hosted · brianpadilla3072 · desactivada por defecto. Requiere `specialistApplications`.

La implementación local existente permite configurar investigación Tavily por perfil, revisar actualizaciones del pack conservando ediciones y exportar definiciones portables OCX. Activar con `DEN_FEATURE_SPECIALIST_INTEGRATIONS=true`; los endpoints requieren autorización de host y las mutaciones respetan modo solo lectura. Los adaptadores rechazan proveedores desconocidos en lugar de sustituirlos silenciosamente.

La cuenta del proveedor se configura por sus acciones nativas y los secretos no se exportan en packs. La vista previa se identifica por fingerprint y la aplicación rechaza una actualización si cambió la fuente tras revisarla. Al desactivar se ocultan las conexiones, no se borran perfiles ni proyectos y se desactiva su conexión de investigación.

Este documento completa la referencia de cambios locales previos. `apps/server/test/specialist-integrations.test.ts` cubre fábricas, aislamiento, exportación y actualizaciones. La conexión externa real y captura de esta pantalla no se validaron en esta iteración; requieren su propio registro.
