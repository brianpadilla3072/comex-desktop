# Cápsula de escritorio

Feature `desktopCompanion`, self-hosted, autor `brianpadilla3072`, apagada por
defecto. Activar con el control de operador existente
`DEN_FEATURE_DESKTOP_COMPANION=true` al lanzar el escritorio. No se activa en
las distribuciones cloud/enterprise. Un `false` conserva el cierre habitual.

La mascota queda arriba al centro, sin texto propio. Al abrirla comparte fila
con el chat. Usa una ventana React pequeña, componentes Button/Textarea del
producto y un personaje original en Canvas 2D; no incluye arte, nombre ni
sonidos de Coucou. Referencia de interacción: Louis-CFM/coucou,
commit `b1bc09de7f7c24a80bd8eca5729b8bee60f66402` (MIT para el código).

## Funciones

- Cerrar la ventana principal la oculta conservando su renderer y el servidor.
  Bandeja → Salir conserva el cierre ordenado. Si falla el arranque de la
  cápsula, el cierre normal sigue funcionando.
- Clic o `Ctrl+Alt+Espacio` (`Cmd+Alt+Espacio` en macOS) abre el chat. La bandeja
  permite abrir la app, abrir el chat, ocultar la cápsula y salir.
- Mantener abierto, plegado con Escape, cierre a los 5/15/30 segundos al salir,
  apertura opcional tras 500 ms de hover. Un borrador, adjuntos, una operación
  o una pregunta pendiente impiden el plegado automático.
- Texto y adjuntos hacia la conversación enfocada, actividad reciente, detener,
  permisos una vez/rechazar y preguntas. Se reutiliza la admisión nativa, el
  proveedor/modelo y los permisos de esa conversación. No hay otro motor.
- Hasta ocho adjuntos y 8 MB en total desde la cápsula. Archivos más grandes se
  adjuntan desde el chat completo. Soltar un archivo lo agrega al borrador;
  enviarlo requiere una acción aparte.
- Mascotas Brote/Brasa y carga de PNG/WebP/JPG propios. La imagen se normaliza
  hasta 256 px y se guarda con las preferencias locales. La animación se limita
  a 24 fps durante trabajo, respeta movimiento reducido y se pausa fuera de
  vista. En reposo solo hay parpadeos espaciados.

## Identidad, permisos y fallos

Solo el frame principal publica estado y recibe comandos. La cápsula tiene un
preload separado sin tokens, acceso a shell, fetch nativo ni lectura del disco.
Cada superficie enfocada tiene un destino efímero: cambiar de conversación o
desmontarla invalida los comandos anteriores. Las respuestas de permisos se
comprueban de nuevo contra la solicitud vigente.

Los comandos se deduplican y los permisos no se responden dos veces con ids de
comando distintos. Un envío incierto se conserva, bloquea el reenvío desde esa
cápsula y requiere revisar el chat completo. No hay reintentos automáticos.
Una pérdida de heartbeat conserva el último estado visible y desactiva acciones.

La primera versión conserva el renderer principal porque actualmente participa
en dispatch y sincronización. No afirma una reducción de RAM por ocultarlo.
La selección sigue la conversación enfocada; no es todavía un monitor de todos
los chats ni un registro de agentes externos de otras herramientas.

## Apagar y limitaciones

Desmarcar «Cápsula visible» en la bandeja restaura la ventana principal y deja
de interceptar su cierre. Apagar la feature al reiniciar conserva preferencias,
historial, archivos y tareas. La salida real detiene los servicios existentes;
cerrar la ventana no equivale a salir.

La geometría se recalcula al cambiar pantallas y usa el área de trabajo. Linux
Wayland puede ignorar el posicionamiento de Electron; no se promete paridad con
el layer-shell GTK de Coucou. Se requiere validación en el compositor real.
No incluye dictado universal, grabación de reuniones, cliente móvil, vestuario
ni mascota libre por el escritorio.

## Evidencia

Las capturas usan el componente real y un puente controlado con datos de
prueba; no son inferencias ni acciones sobre archivos del usuario.

![Cápsula plegada](plegada.png)
![Chat y mascota en la misma fila](chat.png)
![Solicitud real de la interfaz con datos de prueba](permiso.png)

Verificar: pruebas de ciclo de vida/IPC, pruebas del host React, typecheck de
app y Electron, registro de features y la prueba nativa bajo Xvfb. La evidencia
nativa no certifica Windows, macOS ni Wayland.
