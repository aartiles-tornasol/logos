import type { Vec3 } from '../types';

/** Rejilla regular de vóxeles cúbicos de lado `h`. El vóxel (0,0,0) empieza en `origin`. */
export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  h: number;
  origin: Vec3;
}

export function voxelCount(g: Grid): number {
  return g.nx * g.ny * g.nz;
}

/** Crea una rejilla que cubre la caja dada con `pad` vóxeles de margen por cada lado. */
export function gridForBounds(min: Vec3, max: Vec3, h: number, pad: number): Grid {
  const n = (a: number, b: number) => Math.max(1, Math.ceil((b - a) / h - 1e-6)) + 2 * pad;
  return {
    nx: n(min[0], max[0]),
    ny: n(min[1], max[1]),
    nz: n(min[2], max[2]),
    h,
    origin: [min[0] - pad * h, min[1] - pad * h, min[2] - pad * h],
  };
}
