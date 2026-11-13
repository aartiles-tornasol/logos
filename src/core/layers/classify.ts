import { bboxSize, meshStats } from '../geometry/mesh';
import type { BBox, Mesh, PartKind } from '../types';

export interface ClassifyInput {
  name: string;
  material?: string;
  mesh: Mesh;
  bbox: BBox;
}

export interface ClassifyContext {
  /** Caja del modelo completo, en unidades del modelo. */
  modelBBox: BBox;
  /** Factor para pasar de unidades del modelo a metros reales. */
  toMeters: number;
  /** Diagonal (m) por debajo de la cual una pieza se considera detalle/mobiliario. */
  detailSize?: number;
}

const GLASS = /vidri|glass|crist|glaz|ventana|window/i;

/**
 * Sugiere el tipo constructivo de una pieza a partir de su nombre, tamaño y orientación.
 * Es una heurística para ayudar a ordenar modelos sin capas fiables, no una clasificación
 * exacta: el usuario siempre puede corregirla.
 */
export function classifyPart(part: ClassifyInput, ctx: ClassifyContext): PartKind {
  if (GLASS.test(part.name) || (part.material && GLASS.test(part.material))) return 'vidrio';
  const size = bboxSize(part.bbox).map((v) => v * ctx.toMeters);
  const diagonal = Math.hypot(size[0], size[1], size[2]);
  if (diagonal < (ctx.detailSize ?? 2.5)) return 'detalle';
  const stats = meshStats(part.mesh);
  const horizontalExtent = Math.max(size[0], size[1]);
  const flat = size[2] < 0.25 * horizontalExtent;
  if (flat && stats.horizontalFraction > 0.5) {
    const modelHeight = ctx.modelBBox.max[2] - ctx.modelBBox.min[2];
    const nearTop = part.bbox.max[2] >= ctx.modelBBox.max[2] - 0.15 * modelHeight;
    return nearTop ? 'cubierta' : 'forjado';
  }
  if (stats.verticalFraction > 0.5) return 'muro';
  return 'otros';
}

export const KIND_LABEL: Record<PartKind, string> = {
  muro: 'Muros',
  forjado: 'Forjados',
  cubierta: 'Cubiertas',
  detalle: 'Detalles y mobiliario',
  vidrio: 'Vidrios',
  otros: 'Otros',
};
