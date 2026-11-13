import {
  bboxSize,
  mergeMeshes,
  meshBBox,
  splitConnectedComponents,
  transformMesh,
  unionBBox,
  weldMesh,
} from './geometry/mesh';
import { classifyPart } from './layers/classify';
import { computeExposure } from './layers/exposure';
import { groupName, type GroupingStrategy } from './layers/grouping';
import type { BBox, ImportResult, Layer, LengthUnit, Mesh, Part } from './types';
import { UNIT_TO_MM } from './types';
import { printScaleFactor } from './units';

export const EXCLUDED_LAYER_ID = 'layer:__excluidos__';
export const EXCLUDED_LAYER_NAME = 'Excluidos de la impresión';

const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#59a14f',
  '#e15759',
  '#76b7b2',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#86bcb6',
  '#d37295',
  '#a0cbe8',
];

export const layerIdFor = (name: string): string => `layer:${name}`;

export interface BuildOptions {
  /** Separa cada objeto importado en sus piezas conectadas (recomendado). */
  split: boolean;
  /** Si al separar se superase este número de piezas, no se separa. */
  maxParts: number;
  /** El fichero usa Y como eje vertical (glTF, FBX y muchos OBJ): se gira a Z vertical. */
  yUp: boolean;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = { split: true, maxParts: 4000, yUp: false };

/** Gira una malla de Y vertical a Z vertical (convención de MicroStation y de impresión). */
export function yUpToZUp(mesh: Mesh): Mesh {
  const src = mesh.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = src[i];
    positions[i + 1] = -src[i + 2];
    positions[i + 2] = src[i + 1];
  }
  return { positions, indices: mesh.indices };
}

/** Convierte el resultado de un importador en piezas seleccionables. */
export function buildParts(result: ImportResult, options: Partial<BuildOptions> = {}): Part[] {
  const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };
  const welded = result.objects
    .map((o) => ({ ...o, mesh: weldMesh(opts.yUp ? yUpToZUp(o.mesh) : o.mesh) }))
    .filter((o) => o.mesh.indices.length > 0);
  let pieces = welded.map((o) => ({ object: o, meshes: [o.mesh] }));
  if (opts.split) {
    const split = welded.map((o) => ({ object: o, meshes: splitConnectedComponents(o.mesh) }));
    const total = split.reduce((n, s) => n + s.meshes.length, 0);
    if (total <= opts.maxParts) pieces = split;
  }
  const parts: Part[] = [];
  for (const { object, meshes } of pieces) {
    meshes.forEach((mesh, i) => {
      parts.push({
        id: `p${parts.length}`,
        name: meshes.length > 1 ? `${object.name} #${i + 1}` : object.name,
        sourceLayer: object.layer,
        material: object.material,
        layerId: layerIdFor(object.layer),
        mesh,
        bbox: meshBBox(mesh),
      });
    });
  }
  return parts;
}

export function modelBBox(parts: Part[]): BBox {
  return unionBBox(parts.map((p) => p.bbox));
}

/** Calcula el tipo sugerido y la exposición al exterior de cada pieza. */
export function analyzeParts(parts: Part[], unit: LengthUnit): Part[] {
  if (parts.length === 0) return parts;
  const bbox = modelBBox(parts);
  const toMeters = UNIT_TO_MM[unit] / 1000;
  const exposure = computeExposure(parts.map((p) => p.mesh));
  return parts.map((p, i) => ({
    ...p,
    kind: classifyPart(p, { modelBBox: bbox, toMeters }),
    exposure: exposure[i],
  }));
}

/**
 * Reasigna las piezas a capas según la estrategia. Las piezas excluidas siguen excluidas
 * y las capas que ya existían conservan su visibilidad.
 */
export function regroup(
  parts: Part[],
  strategy: GroupingStrategy,
  previous: Layer[] = [],
): { parts: Part[]; layers: Layer[] } {
  const wasVisible = new Map(previous.map((l) => [l.id, l.visible]));
  const names = new Set<string>();
  const next = parts.map((p) => {
    if (p.layerId === EXCLUDED_LAYER_ID) return p;
    const name = groupName(p, strategy);
    names.add(name);
    return { ...p, layerId: layerIdFor(name) };
  });
  const layers: Layer[] = [...names]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((name, i) => ({
      id: layerIdFor(name),
      name,
      color: PALETTE[i % PALETTE.length],
      visible: wasVisible.get(layerIdFor(name)) ?? true,
    }));
  if (next.some((p) => p.layerId === EXCLUDED_LAYER_ID)) layers.push(excludedLayer());
  return { parts: next, layers };
}

export function excludedLayer(): Layer {
  return { id: EXCLUDED_LAYER_ID, name: EXCLUDED_LAYER_NAME, color: '#6b7280', visible: false };
}

/** Mueve piezas a una capa (creándola si hace falta) y elimina las capas que queden vacías. */
export function moveParts(
  parts: Part[],
  layers: Layer[],
  ids: Iterable<string>,
  target: { id: string; name: string },
): { parts: Part[]; layers: Layer[] } {
  const set = new Set(ids);
  const nextParts = parts.map((p) => (set.has(p.id) ? { ...p, layerId: target.id } : p));
  let nextLayers = layers;
  if (!layers.some((l) => l.id === target.id)) {
    const layer: Layer =
      target.id === EXCLUDED_LAYER_ID
        ? excludedLayer()
        : {
            id: target.id,
            name: target.name,
            color: PALETTE[layers.length % PALETTE.length],
            visible: true,
          };
    nextLayers = [...layers, layer];
  }
  const used = new Set(nextParts.map((p) => p.layerId));
  return { parts: nextParts, layers: nextLayers.filter((l) => used.has(l.id)) };
}

export function visibleParts(parts: Part[], layers: Layer[]): Part[] {
  const visible = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  return parts.filter((p) => visible.has(p.layerId));
}

export interface PrintMesh {
  mesh: Mesh;
  /** Tamaño de la maqueta en mm. */
  size: [number, number, number];
}

/**
 * Une las piezas visibles y las pasa a milímetros de impresión, con el origen en la
 * esquina inferior del modelo completo (para que ocultar capas no desplace la maqueta).
 */
export function buildPrintMesh(
  parts: Part[],
  layers: Layer[],
  unit: LengthUnit,
  scale: number,
): PrintMesh {
  const shown = visibleParts(parts, layers);
  const factor = printScaleFactor(unit, scale);
  const origin = parts.length ? modelBBox(parts).min : ([0, 0, 0] as [number, number, number]);
  const mesh = transformMesh(mergeMeshes(shown.map((p) => p.mesh)), origin, factor);
  const size = shown.length
    ? (bboxSize(unionBBox(shown.map((p) => p.bbox))).map((v) => v * factor) as [
        number,
        number,
        number,
      ])
    : ([0, 0, 0] as [number, number, number]);
  return { mesh, size };
}
