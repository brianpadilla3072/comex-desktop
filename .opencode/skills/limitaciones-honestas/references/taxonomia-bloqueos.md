# Taxonomía de bloqueos

Clasificar cada promesa con **un bloqueo principal** (y mencionar los secundarios) es lo que
convierte un análisis de un caso en una herramienta reutilizable. La categoría va en la columna
"Bloqueo principal" de la tabla resumen, en mayúsculas.

Elegir la categoría por **lo que impide que la IA lo haga sola**, no por el tema de la promesa.
"Gestionar anuncios" no es un bloqueo: es una funcionalidad. El bloqueo es **DINERO + PERMISO**.

## Las ocho categorías

### ACCESO
Datos o plataformas cerrados: login, anti-bots, captchas, API de pago, licencia de uso,
scraper que se rompe cuando cambia la interfaz.
- **Señales:** "requiere login", "no hay API pública", "proveedor con licencia", "sesión que se cae".
- **Qué necesitaría la IA:** acceso autenticado y estable, o proveedor de datos con API y licencia; sesión persistente; mantenimiento humano del scraper.

### PERMISO
Credenciales, scopes, autorización para ejecutar acciones y, sobre todo, para gastar.
- **Señales:** "con API keys del usuario", "permisos explícitos", "autorización de gasto", "guardrails".
- **Qué necesitaría la IA:** cuentas creadas y autenticadas, permisos limitados y explícitos, reglas de apagado automático. **Nunca** asumir permisos que la persona no dio.

### DINERO
Presupuesto, métodos de pago, comisiones, compras de prueba. La IA no puede gastar por su cuenta.
- **Señales:** "método de pago", "presupuesto diario", "compra de prueba", "pasarela aprobada".
- **Qué necesitaría la IA:** presupuesto definido por la persona y una compra de prueba hecha por una persona.

### TIEMPO
Esperas de plataforma que ningún prompt acelera: propagación DNS, aprobación de cuentas,
revisión de anuncios, fase de aprendizaje del píxel, maduración de datos.
- **Señales:** "24–48 hs", "1–3 días hábiles", "~50 conversiones por semana", "semanas hasta significancia".
- **Qué necesitaría la IA:** no puede eliminarlas; puede preparar todo para que la espera empiece antes. Decirlo explícitamente.

### LEY / LEGAL
Falta de personalidad jurídica, impuestos, términos que alguien debe aceptar, políticas de
plataforma, privacidad de datos, responsabilidad por devoluciones o publicidad.
- **Señales:** "aceptar términos", "titular de la cuenta", "datos fiscales", "política de reembolsos", "responsable ante una demanda".
- **Qué necesitaría la IA:** una persona que firme, pague y responda. Una IA no es persona jurídica.

### DATOS
Volumen insuficiente, rastreo roto, ruido estadístico, ausencia de tendencia histórica,
eventos mal disparados.
- **Señales:** "con pocas visitas", "significancia", "eventos del píxel", "dato espejo", "no sabemos si vende".
- **Qué necesitaría la IA:** datos limpios y suficientes, ventana de tiempo, modelo que distinga señal de ruido. Sin volumen, cualquier conclusión es ruido.

### JUICIO HUMANO
Tareas que requieren criterio, validación, lenguaje del nicho, gancho creativo o revisión
de calidad. Un dato no se convierte en decisión solo porque la IA lo liste.
- **Señales:** "validada", "que vende", "el gancho correcto", "test A/B", "revisión humana", "aprobación".
- **Qué necesitaría la IA:** modelo entrenado con ejemplos reales, investigación del avatar, ciclo de revisión humana. La decisión final es de la persona.

### TECNOLOGÍA / INTEGRACIÓN
Herramientas externas que la IA no contiene (generadores de imagen/vídeo, editores, diseño),
consistencia entre piezas, generación masiva sin medición.
- **Señales:** "se hace en otras herramientas", "integración vía API con credenciales", "misma persona y mismo estilo", "generar 25 piezas sin medir".
- **Qué necesitaría la IA:** integración real con esas herramientas y un mecanismo de medición. Sin medir, generar es ruido.

## Cómo redactar el bloqueo en el documento

Malar el bloqueo es arruinar el análisis:

- ❌ "La IA no puede hacerlo porque es muy complejo."
- ✅ "Bloqueo principal: **PERMISO**. Requiere una cuenta publicitaria con un token de la
  Marketing API y autorización de gasto de la persona; la IA no puede crear la cuenta ni
  aceptar los términos por ella. Secundario: **TIEMPO** (revisión de anuncios 24–48 hs)."

## Regla de honestidad

Si el bloqueo no encaja en ninguna categoría, agregar una nueva con nombre en mayúsculas,
definición y señales —y documentarla acá para que la próxima vez no haya que inventarla otra vez.
