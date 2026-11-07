# Entregables reproducibles Comex

El pack contiene un CLI multiplataforma que prepara dependencias privadas,
ejecuta los generadores y comprueba archivos Word/Excel. No requiere instalar
bibliotecas en el Python del usuario ni modificar el Python del sistema.

## Preparar y usar

Desde el repositorio:

```bash
node scripts/comex-documents.mjs doctor
node scripts/comex-documents.mjs setup
node scripts/comex-documents.mjs run word -- informe.md -o informe.docx --toc
node scripts/comex-documents.mjs run excel -- datos.csv -o datos.xlsx --fuente "Base y fecha real de consulta"
node scripts/comex-documents.mjs verify informe.docx datos.xlsx
node scripts/comex-documents.mjs smoke --out tmp/comex-entregables-prueba-nueva
```

En proyectos instalados, usar `python3 .opencode/scripts/documents.py` en lugar
de `node scripts/comex-documents.mjs`. Windows: `py -3` o `python`.
La instalación global del pack coloca el CLI en `~/.config/opencode/scripts/`.

`COMEX_DOCUMENTS_PYTHON` selecciona el sidecar incluido y tiene prioridad;
`COMEX_PYTHON` selecciona un intérprete de desarrollo. `COMEX_PACK_HOME`
selecciona la carpeta del entorno privado (por defecto `~/.comex-pack`). El
launcher Node admite `py -3` de Windows y rutas con espacios, sin ejecutar shell.
`doctor` devuelve estado JSON y código 1 cuando falta el entorno o sus versiones
no coinciden con `pack/scripts/requirements.lock.txt`. Detecta el renderer opcional
LibreOffice, sin afirmar que encontrarlo significa haber revisado los archivos.

La preparación usa Python 3.10+, venv y pip; instala solamente wheels y conserva
las versiones directas y transitivas del lock. No borra entornos anteriores.
Si el sistema no trae venv/ensurepip, hay que instalar ese componente de Python.
Una preparación interrumpida puede dejar un bloqueo: solo quitar
`documents-setup.lock` después de comprobar que no hay otro setup activo.

Para instalación sin red, preparar una carpeta de wheels **para el sistema,
arquitectura y versión Python del destino**:

```bash
python3 -m pip download --only-binary=:all: -r pack/scripts/requirements.lock.txt -d wheels
node scripts/comex-documents.mjs setup --wheelhouse wheels
```

El lock fija versiones; su hash se registra en `documents-runtime.json`. No es
un manifiesto de hashes de cada wheel. La distribución del wheelhouse debe
verificarse por el canal de publicación que lo entregue.

## Qué se verifica

`verify` valida el contenedor ZIP y XML de Office, reabre los archivos con
python-docx/openpyxl, rechaza documentos vacíos, cuenta tablas/hojas/celdas y
fórmulas, y calcula SHA-256. Limita archivos a 32 MiB, 2.000 partes, 128 MiB
descomprimidos, 16 MiB por parte y un millón de celdas; rechaza dimensiones
excesivas y limita el diagnóstico del intérprete a 15 segundos. No certifica exactitud de una investigación,
procedencia de datos, recálculo de fórmulas ni diseño visual.

`smoke` recorre cotización sintética → CSV → XLSX y Markdown → DOCX, comprueba
CIF de 112 para el fixture, conserva la declaración de encuestas pendientes y
produce `evidence.json`. Se ejecuta sin consultar fuentes externas y rechaza una
carpeta de salida existente para evitar mezclar evidencia. Su alcance es la
herramienta de archivos; no mide autonomía ni calidad de un modelo.

Para revisión visual, abrir los archivos en Word/Excel o renderizar con
LibreOffice y revisar todas las páginas. No marcar esa revisión aprobada sin
haberla hecho. El índice de Word requiere actualizar campos en Word.

## Evidencia de desarrollo y límites de instalación

Se comprobó en Linux la preparación de un entorno privado con Python 3.12,
la instalación de las cinco versiones fijadas y un smoke a través del launcher
Node. El Python 3.14 del host no tenía ensurepip; el error se informó sin
reemplazar ni alterar paquetes del sistema. Las pruebas automatizadas cubren
bloqueos de instalación, dependencia ausente, ZIP/XML inválido, documentos
vacíos, fórmulas, hashes y preservación de la evidencia pendiente.

## Sidecar Python portable

`scripts/release/comex-python-runtime.mjs` construye un runtime a partir de una
distribución **standalone Python 3.12** provista por CI; el script no descarga
intérpretes. Requiere ejecutar la compilación en el mismo sistema y arquitectura
del destino. Rechaza virtualenvs, enlaces fuera del árbol y destinos existentes;
excluye site-packages heredados antes de instalar las cinco dependencias fijadas.

```bash
node scripts/release/comex-python-runtime.mjs --python-root /ruta/python-standalone --out apps/desktop/vendor/comex-python
# Opcional: --wheelhouse /ruta/wheels para instalar sin red.
```

La preparación instala wheels en una copia, vuelve a copiar el resultado a otra
ruta y oculta temporalmente la ubicación original de instalación. Comprueba
imports, todos los sys.path y archivos de módulos cargados dentro de la nueva
ubicación, más `doctor` con `COMEX_DOCUMENTS_PYTHON`. Solo entonces publica el
árbol y su `comex-runtime.json` con versiones, plataforma, arquitectura, hash del
lock y `relocationVerified=true`. No modifica ni oculta la distribución fuente
del operador. La prueba no sustituye un instalador probado en otro equipo.

En una app con sidecar, `COMEX_DOCUMENTS_PYTHON` apunta a
`resources/comex-python/bin/python3` en Linux o
`resources/comex-python/python.exe` en Windows. `doctor` informa
`pythonBundled=true` únicamente cuando ese intérprete arranca, importa las
bibliotecas y coincide con el lock. `setup` conserva el runtime empaquetado
inmutable; si está roto, indica reparar la app en lugar de instalar paquetes en
ella. Sin sidecar configurado se mantiene el entorno privado de desarrollo.

Se construyó y reubicó realmente el sidecar Linux x64 con Python 3.12.12
standalone administrado por uv, además de una prueba previa con 3.12.14.
El marcador EXTERNALLY-MANAGED de uv se excluye solo de la copia de preparación
y se restaura como marcador Comex después de instalar las dependencias;
la distribución fuente permanece intacta. El smoke del sidecar 3.12.12 produjo
DOCX/XLSX y evidencia correcta con PATH sin ningún Python del sistema
(`tmp/comex-documents-uv-embedded-smoke/evidence.json` en el entorno de prueba). Windows limpio, carga de dependencias nativas en otro equipo,
Word/Excel reales y actualización entre versiones siguen pendientes de
validación; no se anuncian como comprobados por estas pruebas Linux.

## Revisión visual del fixture

Se renderizó `tmp/comex-documents-final-smoke/informe.docx` y se inspeccionaron sus tres páginas en `tmp/comex-documents-final-visual/`. Se corrigió el índice vacío: ahora incluye títulos en el resultado en caché del campo; Word puede recalcular los números de página. Portada, tabla, fuente y declaración de campo pendiente quedaron legibles. La revisión se limita a ese fixture sintético; el XLSX se verificó estructuralmente y no se declara inspección visual de Excel.

La preparación de CI usa [las distribuciones Python administradas de uv](https://docs.astral.sh/uv/concepts/python-versions/) con versiones fijadas de uv y Python. El intérprete se incorpora a recursos Windows/Linux; el arranque pasa su ruta al servidor y al contexto del asistente, incluso cuando el servicio OpenCode instalado ya estaba ejecutándose. La prueba de instalación empaquetada en otra máquina sigue pendiente.
