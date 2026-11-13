import { bboxSize } from '../geometry/mesh';
import type { Part } from '../types';
import { KIND_LABEL } from './classify';

export type GroupingStrategy = 'origen' | 'material' | 'tipo' | 'exposicion';

export const GROUPING_LABEL: Record<GroupingStrategy, string> = {
  origen: 'Capas del fichero',
  material: 'Material / color',
  tipo: 'Tipo sugerido (muros, forjados…)',
  exposicion: 'Exterior / interior',
};

/** Umbral de exposición por debajo del cual una pieza se considera interior. */
export const INTERIOR_THRESHOLD = 0.04;

/** Nombre de la capa que le corresponde a una pieza según la estrategia de agrupación. */
export function groupName(part: Part, strategy: GroupingStrategy): string {
  switch (strategy) {
    case 'origen':
      return part.sourceLayer || 'Sin capa';
    case 'material':
      return part.material || 'Sin material';
    case 'tipo':
      return KIND_LABEL[part.kind ?? 'otros'];
    case 'exposicion':
      if (part.exposure === undefined) return 'Sin analizar';
      return part.exposure < INTERIOR_THRESHOLD ? 'Interior (no visible)' : 'Exterior (visible)';
  }
}

/**
 * Piezas "parecidas" a la de referencia: mismo tipo sugerido y dimensiones similares
 * (ordenadas, para que no dependa de la orientación). Sirve para "seleccionar similares".
 */
export function findSimilar(reference: Part, parts: Part[], tolerance = 0.15): string[] {
  const dims = (p: Part) => bboxSize(p.bbox).sort((a, b) => a - b);
  const ref = dims(reference);
  const scale = Math.max(ref[2], 1e-9);
  return parts
    .filter((p) => {
      if (p.kind !== reference.kind) return false;
      const d = dims(p);
      return d.every((v, i) => Math.abs(v - ref[i]) <= tolerance * scale);
    })
    .map((p) => p.id);
}
