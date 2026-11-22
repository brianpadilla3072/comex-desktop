---
name: modelos-3d-sketchup-revit
description: Generar modelos 3D compatibles con SketchUp y Revit usando Python
  (trimesh/ifcopenshell), validar archivos localmente y verificar importación
  en visores web open source (Babylon.js, glTF Viewer, IFC Navigator, Altiro,
  flinker) o en SketchUp Web/Autodesk Viewer. Usar cuando se pida crear,
  exportar o convertir modelos 3D para SketchUp/Revit, o cuando haya que
  producir geometría 3D en formatos estándar (OBJ, STL, DAE/Collada,
  glTF/GLB, PLY, IFC).
---

# Modelos 3D para SketchUp y Revit

## Objetivo
Generar modelos 3D en formatos que SketchUp y Revit importan bien, validarlos localmente y, cuando haga falta, verificar la importación en visores web open source (sin login ni upload) o en las versiones web propietarias (SketchUp Web, Autodesk Viewer).

## Formatos compatibles

| Formato | SketchUp | Revit | Notas |
|---|---|---|---|
| SKP (nativo SketchUp) | ✅ | ❌ | Solo SketchUp lo escribe/lee nativamente |
| OBJ | ✅ | ✅ (via import) | Muy estable, incluye materiales (.mtl) |
| STL (binario/ascii) | ✅ | ✅ | Solo geometría, sin materiales/UV |
| DAE / Collada | ✅ | ✅ | Buen soporte de materiales y jerarquía |
| glTF / GLB | ✅ (2021+) | ✅ (via APS) | Bueno para web/visualización |
| PLY | ✅ | ⚠️ | Más para nubes de puntos |
| IFC | ⚠️ (via extensión) | ✅ nativo | Estándar BIM, ideal para Revit |
| 3DS | ✅ | ⚠️ | Legado, límite de caras |
| FBX | ✅ (via extensión) | ✅ | Requiere plugin en SketchUp |

**Recomendación por caso:**
- SketchUp puro → DAE o OBJ (mejor preservación de materiales).
- Revit puro → IFC (BIM) o FBX.
- Intercambio entre ambos → OBJ o DAE.
- Visualización web → GLB.

## Herramientas locales (open source)

Librería principal: **trimesh** (Python, MIT). Se instala con:
```
pip3 install --break-system-packages trimesh pycollada numpy-stl scipy
```
Para IFC (Revit), sumar **ifcopenshell** (open source, LGPL):
```
pip3 install --break-system-packages ifcopenshell
```

Para validación GLB/GLTF por CLI (opcional): `@gltf-transform/core` (npm, MIT) o el validador de Khronos.

## Flujo estándar (SketchUp)

### 1. Generar geometría
```python
import trimesh
m = trimesh.creation.box(extents=[2.0, 1.0, 0.5])   # x,y,z en metros
# Otros primitivos: sphere, cylinder, cone, torus, icosphere
# Combinar: trimesh.util.concatenate([a, b])
# Transformar: m.apply_translation([1,0,0]); m.apply_scale(2)
```

### 2. Asignar materiales / color (opcional)
```python
m.visual.face_colors = [200, 100, 50, 255]   # RGBA
```

### 3. Exportar a los formatos pedidos
```python
for fmt in ['obj','stl','dae','glb','gltf','ply']:
    m.export(f'modelo.{fmt}')
```
Nota: DAE requiere `pycollada`. GLB/GLTF requieren `pygltflib`.

### 4. Validar localmente
```python
import trimesh, os
for f in ['modelo.obj','modelo.stl','modelo.dae','modelo.glb']:
    loaded = trimesh.load(f)
    if isinstance(loaded, trimesh.Scene):
        geoms = list(loaded.geometry.values())
        print(f, 'SCENE geoms=', len(geoms),
              'verts=', sum(len(g.vertices) for g in geoms),
              'faces=', sum(len(g.faces) for g in geoms))
    else:
        print(f, 'verts=', len(loaded.vertices), 'faces=', len(loaded.faces),
              'watertight=', loaded.is_watertight, 'size=', os.path.getsize(f))
```
Criterios de aceptación:
- El archivo se parsea sin error.
- `vertices > 0` y `faces > 0`.
- `is_watertight` true cuando sea una pieza sólida.
- Tamaño razonable (< 50 MB para web).

### 5. Verificar en visor web (integración web)

**Opción A — Visores open source (sin login, sin upload, 100% local):**
- GLB/GLTF/OBJ/STL/PLY → **glTF Viewer de Don McCurdy** (https://gltf-viewer.donmccurdy.com/, open source, Three.js). Arrastrar el archivo.
- GLB/GLTF/OBJ/STL/PLY → **Babylon.js Sandbox** (https://sandbox.babylonjs.com/, open source). Arrastrar o elegir archivo.
- GLB/GLTF → **model-viewer** (https://modelviewer.dev/, open source, Google). Acepta drag-and-drop.

**Opción B — Versión web propietaria (requiere login):**
- SketchUp Web (https://app.sketchup.com): File → Import → OBJ/STL/DAE/SKP. Cuidado con unidades (pulgadas por defecto).

**Procedimiento:**
1. Abrir el visor open source (sin login).
2. Arrastrar el archivo (.glb, .obj, .stl, etc.) a la página.
3. Comprobar geometría, escala y materiales.
4. Si algo falla, anotar el error y ajustar (triangulación, unidades, nombres de materiales).

## Flujo para Revit (IFC)

### 1. Generar geometría (igual que arriba con trimesh)

### 2. Convertir malla a IFC4 con ifcopenshell
```python
import ifcopenshell, ifcopenshell.api, os
import trimesh

m = trimesh.creation.box(extents=[1.0, 1.0, 1.0])  # tu geometría

ifc = ifcopenshell.file(schema="IFC4")
project = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcProject", name="Proyecto")
ifcopenshell.api.run("unit.assign_unit", ifc, length={"is_metric": True, "raw": "METRE"})

site = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcSite", name="Sitio")
building = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuilding", name="Edificio")
storey = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuildingStorey", name="Planta")
ifcopenshell.api.run("aggregate.assign_object", ifc, products=[site], relating_object=project)
ifcopenshell.api.run("aggregate.assign_object", ifc, products=[building], relating_object=site)
ifcopenshell.api.run("aggregate.assign_object", ifc, products=[storey], relating_object=building)

proxy = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuildingElementProxy", name="Pieza")

verts = m.vertices
faces = m.faces
coord_list = ifc.createIfcCartesianPointList3D([tuple(float(x) for x in v) for v in verts])
coord_indices = [[int(f[0])+1, int(f[1])+1, int(f[2])+1] for f in faces]
tfs = ifc.createIfcTriangulatedFaceSet(Coordinates=coord_list, CoordIndex=coord_indices)

ctx = ifc.createIfcGeometricRepresentationContext(ContextIdentifier="Model", ContextType="Model",
    CoordinateSpaceDimension=3, Precision=1e-5,
    WorldCoordinateSystem=ifc.createIfcAxis2Placement3D(ifc.createIfcCartesianPoint((0.0,0.0,0.0))))
rep = ifc.createIfcShapeRepresentation(ContextOfItems=ctx, RepresentationIdentifier="Body",
    RepresentationType="Tessellation", Items=[tfs])
proxy.Representation = ifc.createIfcProductDefinitionShape(Representations=[rep])

ifcopenshell.api.run("geometry.edit_object_placement", ifc, product=proxy)
ifcopenshell.api.run("spatial.assign_container", ifc, products=[proxy], relating_structure=storey)

ifc.write("modelo.ifc")
print("IFC escrito,", os.path.getsize("modelo.ifc"), "bytes")
```

### 3. Validar IFC localmente
```python
import ifcopenshell
f = ifcopenshell.open("modelo.ifc")
print("schema:", f.schema)
print("proxies:", f.by_type("IfcBuildingElementProxy"))
```

### 4. Verificar en visor web (integración web para Revit/IFC)

**Opción A — Visores IFC open source (sin login, sin upload, 100% local):**
- **IFC Navigator** (https://ifcnavigator.com/) — open source, web-ifc + Three.js, privado, sin signup. Arrastrar .ifc.
- **Altiro** (https://ifc.cl/) — open source, WebGPU, sin signup. Arrastrar .ifc.
- **flinker.app IFC Viewer** (https://viewer.flinker.app/) — open source, sin signup. Arrastrar .ifc.
- **davras5/ifc-viewer** (https://davras5.github.io/ifc-viewer/) — MIT, open source, con tabla de datos y export Excel. Arrastrar .ifc.
- **viewifc.com** (https://viewifc.com/) — open source (AGPL-3.0), web-ifc + Three.js, con BCF y secciones. Arrastrar .ifc.

**Opción B — Visor propietario (requiere login):**
- Autodesk Viewer (https://viewer.autodesk.com): subir IFC/OBJ. Requiere cuenta Autodesk.

**Procedimiento:**
1. Abrir un visor open source (sin login).
2. Arrastrar el archivo .ifc.
3. Comprobar geometría, escala, propiedades IFC.
4. Si algo falla, anotar el error y ajustar.

## Plantilla de script reutilizable (multi-formato)

Guardar como `gen_modelo.py`:

```python
import trimesh, os, sys

def build():
    # --- geometría (editar) ---
    base = trimesh.creation.box(extents=[2.0, 1.0, 0.3])
    pilar = trimesh.creation.cylinder(radius=0.1, height=1.0)
    pilar.apply_translation([0.8, 0.3, 0.65])
    m = trimesh.util.concatenate([base, pilar])
    # --------------------------
    m.visual.face_colors = [180, 180, 190, 255]
    return m

def main(outdir='.', formats=('obj','stl','dae','glb')):
    m = build()
    for fmt in formats:
        path = os.path.join(outdir, f'modelo.{fmt}')
        m.export(path)
        print('exportado', path, os.path.getsize(path), 'bytes')
    for fmt in formats:
        path = os.path.join(outdir, f'modelo.{fmt}')
        L = trimesh.load(path)
        if isinstance(L, trimesh.Scene):
            geoms = list(L.geometry.values())
            print('validado', path, 'SCENE geoms=', len(geoms),
                  'verts=', sum(len(g.vertices) for g in geoms),
                  'faces=', sum(len(g.faces) for g in geoms))
        else:
            print('validado', path, 'verts=', len(L.vertices), 'faces=', len(L.faces),
                  'watertight=', L.is_watertight)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
```

Para IFC, usar el bloque de ifcopenshell de la sección "Flujo para Revit".

## Escala y unidades (punto crítico)
- trimesh trabaja en unidades abstractas; convención: **metros**.
- SketchUp por defecto importa en pulgadas → un cubo de 2 m se ve como 2 pulgadas.
  Soluciones: (a) exportar escalado ×39.3701 (m→in), (b) al importar en SketchUp elegir "Meters", (c) documentar el factor.
- Revit importa en metros si el archivo declara unidades (Collada/IFC lo hacen; OBJ no).
- IFC declara metros por defecto (unit.assign_unit con METRE).

## Limitaciones honestas
- No puedo abrir ni controlar SketchUp/Revit de escritorio; solo visores web (open source o propietarios).
- IFC completo con propiedades BIM (IfcWall, IfcDoor, etc. con atributos) requiere modelar entidades específicas; aquí se generan IfcBuildingElementProxy con geometría de malla.
- Para geometría compleja (NURBS, superficies curvas exactas) trimesh triangula; SketchUp/Revit aceptan mallas trianguladas pero pierden la parametrización.

## Cuándo usar este skill
- "Haceme un modelo 3D de X para SketchUp/Revit"
- "Exportá esta geometría a OBJ/STL/DAE/GLB/IFC"
- "Verificá que este modelo se importe bien"
- "Convertí un modelo a formato compatible"