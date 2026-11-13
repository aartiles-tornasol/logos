# Logos · maquetas para impresión 3D

Aplicación web que convierte el modelo 3D de un edificio (exportado de MicroStation u otro CAD)
en un fichero STL listo para imprimir como maqueta. Todo el procesado ocurre en el navegador:
el modelo no sale del ordenador del usuario y no hace falta servidor.

## Qué hace (fase 1)

1. **Abrir el modelo**: OBJ, DXF (3DFACE, mallas y bloques), STL, glTF/GLB y FBX.
2. **Ver y ordenar**: visor 3D con capas, selección por clic y plano de corte para ver el interior.
3. **Ayudar cuando las capas no sirven**: la aplicación analiza la geometría y propone agrupar por
   - _Exterior / interior_: qué piezas se ven desde fuera (mobiliario y tabiques quedan aparte),
   - _Tipo sugerido_: muros, forjados, cubiertas, vidrios y detalles pequeños,
   - _Material_ o _capas del fichero_.

   Además: «seleccionar similares», mover piezas a capas nuevas y excluirlas de la impresión.

4. **Preparar para imprimir** a la escala elegida (por defecto 1:200, FDM):
   - engrosa todo lo que sea más fino que el grosor mínimo (paredes, petos, caras sueltas),
   - **Macizo**, **Cáscara hueca** o **Con interiores**,
   - cierra huecos (ventanas sin vidrio), deja la base plana y avisa si no cabe en la impresora.
5. **Descargar STL** con la malla comprobada (cerrada y orientada).

## Cómo exportar desde MicroStation

El formato DGN (V8) es propietario: no existe ninguna librería libre que lo lea, ni en navegador
ni en servidor (solo el antiguo V7 tiene lector abierto, y los SDK que leen V8 son de pago).
Por eso el flujo es **Archivo › Exportar** desde MicroStation:

| Formato | Cuándo usarlo                                                              |
| ------- | -------------------------------------------------------------------------- |
| **OBJ** | Recomendado. Conserva niveles/materiales como grupos, que aquí son capas.  |
| **DXF** | Conserva los niveles como capas. Los sólidos deben exportarse como mallas. |
| **STL** | Funciona, pero pierde las capas: habrá que usar la agrupación automática.  |
| **FBX** | Alternativa si el OBJ da problemas.                                        |

Si el modelo aparece tumbado (eje Y hacia arriba), usa «girar 90°» en el panel de escala.

## Cómo funciona el preparado

Los modelos de arquitectura no están pensados para imprimirse: caras sin grosor, volúmenes que
se solapan, normales invertidas, muros de 15 cm que a 1:200 miden 0,75 mm. En vez de intentar
reparar esa malla, se reconstruye sobre una **rejilla de vóxeles** (`src/core/voxel`):

1. se marca la superficie de las capas visibles y se calcula la distancia a ella;
2. se «inunda» el aire exterior desde el borde: lo que el aire no alcanza es edificio;
3. se localiza el eje de los elementos más finos que el mínimo y se engrosan desde ahí
   (los que ya cumplen no se tocan);
4. según el modo, se vacía el interior dejando una cáscara o se conservan las estancias;
5. se extrae la superficie con _marching cubes_ (siempre cerrada) y se simplifica.

La precisión es de ±medio vóxel (0,2 mm con el valor por defecto) y las aristas quedan
ligeramente redondeadas; un vóxel más pequeño da más detalle a costa de memoria y tiempo.

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run check      # tipos + lint + tests unitarios
npm run e2e        # tests end-to-end (Playwright, compila y sirve la app)
npm run build      # genera dist/ (web estática)
```

Estructura:

- `src/core/` — lógica pura y testeada, sin DOM: importadores, geometría, capas, vóxeles, STL.
- `src/worker/` — el preparado corre en un Web Worker para no bloquear la interfaz.
- `src/state/` — estado de la aplicación (zustand).
- `src/ui/` — React y el visor three.js.
- `tests/e2e/` — flujo completo en un navegador real.

Los tests unitarios viven junto al código (`*.test.ts`). CI (`.github/workflows/ci.yml`) ejecuta
formato, lint, tipos, tests unitarios y end-to-end.

## Investigación previa

- **Leer DGN**: [GDAL](https://gdal.org/en/stable/drivers/vector/dgn.html) solo lee V7 con código
  abierto; su [driver V8](https://www.gdal.org/drv_dgnv8.html) necesita el SDK de pago de Open
  Design Alliance. [Aspose.CAD](https://products.aspose.com/cad/javascript-net/conversion/dgn-to-obj/)
  es la alternativa comercial.
- **De BIM/CAD a maqueta**: el problema está bien documentado — a escalas pequeñas los muros
  quedan por debajo del mínimo imprimible y hay que simplificar y eliminar el interior
  ([guía de escalas](https://ritn3d-website.pages.dev/blog/prepare-stl-files-architectural-models),
  [guía de exportación](https://eolasprints.com/blogs/architectural-3d-printing/revit-to-3d-print-architectural-model-export-guide),
  [flujo automatizado de KIT](https://publikationen.bibliothek.kit.edu/1000165445/151832764)).
  No encontré ninguna herramienta abierta que lo automatice.
- **Engrosado y reparación**: las herramientas robustas (p. ej.
  [MeshLib](https://meshlib.io/feature/precision-mesh-offsetting-with-meshlib/)) trabajan con
  vóxeles y campos de distancia; es el enfoque que se sigue aquí.
- **Troceado (fase 2)**: referencias como el corte con conectores de
  [PrusaSlicer/Bambu](https://all3dp.com/1/print-big-parts-on-small-plates-how-to-split-your-stl-in-bambu-prusa-orca-cura-slicers/)
  y [Bed Fit Splitter](https://superhivemarket.com/products/bed-fit-splitter) (cortes planos con
  espigas y holgura configurable).

## Limitaciones conocidas y siguientes pasos

- **Sin probar con modelos reales**: todo está validado con geometría sintética. Con ficheros
  reales exportados de MicroStation habrá que ajustar importadores y heurísticas.
- IFC todavía no se lee (sería la mejor fuente de tipos de elemento).
- DXF: los sólidos ACIS (3DSOLID) no se pueden leer; la app avisa.
- Modelos muy grandes: el tamaño de vóxel se aumenta automáticamente para no agotar memoria.
- **Fase 2**: trocear el STL en piezas que quepan en la impresora, con espigas/encajes y
  holguras, y troceado por plantas para el modo «con interiores». Exportación 3MF.
