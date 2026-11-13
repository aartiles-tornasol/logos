import { meshBBox } from '../geometry/mesh';
import type { Mesh } from '../types';
import { squaredDistance } from './edt';
import { floodExterior, openLargeCavities } from './flood';
import { gridForBounds, voxelCount, type Grid } from './grid';
import { marchingCubes } from './marchingCubes';
import { voxelizeSurface } from './voxelize';

/**
 * - `macizo`: el edificio se convierte en un volumen cerrado; el interior desaparece.
 * - `cascara`: solo la envolvente exterior con el grosor mínimo, hueca por dentro.
 * - `interiores`: se conservan las estancias interiores (forjados y tabiques engrosados).
 */
export type PrepareMode = 'macizo' | 'cascara' | 'interiores';

export interface PrepareOptions {
  mode: PrepareMode;
  /** Grosor mínimo imprimible, en mm. Todo lo más fino se engrosa hasta este valor. */
  minWall: number;
  /** Tamaño de vóxel deseado, en mm. Determina el detalle del resultado. */
  voxelSize: number;
  /** Cierra huecos (ventanas sin vidrio, rendijas) de hasta este ancho, en mm. */
  closeGaps: number;
  /** Trata el plano inferior como suelo: sella edificios abiertos por abajo y deja base plana. */
  sealBottom: boolean;
  /** Límite de vóxeles; si se supera se aumenta el tamaño de vóxel automáticamente. */
  maxVoxels: number;
}

export const DEFAULT_PREPARE_OPTIONS: PrepareOptions = {
  mode: 'macizo',
  minWall: 1.2,
  voxelSize: 0.4,
  closeGaps: 0,
  sealBottom: true,
  maxVoxels: 20_000_000,
};

export interface PrepareResult {
  mesh: Mesh;
  grid: Grid;
  /** Tamaño de vóxel realmente usado (mm). */
  voxelSize: number;
  warnings: string[];
}

export type ProgressFn = (stage: string, fraction: number) => void;

/** Ajusta el tamaño de vóxel para que la rejilla no supere `maxVoxels`. */
export function chooseVoxelSize(
  size: [number, number, number],
  desired: number,
  minWall: number,
  maxVoxels: number,
): number {
  let h = desired;
  for (let iter = 0; iter < 60; iter++) {
    const pad = Math.ceil(minWall / h) + 3;
    const n =
      (Math.ceil(size[0] / h) + 2 * pad) *
      (Math.ceil(size[1] / h) + 2 * pad) *
      (Math.ceil(size[2] / h) + 2 * pad);
    if (n <= maxVoxels) return h;
    h *= Math.max(1.03, Math.cbrt(n / maxVoxels));
  }
  return h;
}

/**
 * Convierte una malla arbitraria (en mm de impresión) en un sólido estanco e imprimible.
 *
 * El proceso trabaja sobre una rejilla de vóxeles, lo que lo hace inmune a los defectos
 * habituales de los modelos de arquitectura (caras sueltas, solapes, normales invertidas):
 *  1. Se marca la superficie y se calcula la distancia a ella.
 *  2. Se "inunda" el exterior desde el borde; lo que el aire no alcanza es edificio.
 *  3. Se localizan los elementos más finos que `minWall` y se engrosan desde su eje.
 *  4. Según el modo, se vacía el interior dejando una cáscara.
 *  5. Se extrae la superficie con marching cubes: siempre cerrada y orientada.
 */
export function prepareForPrint(
  mesh: Mesh,
  options: PrepareOptions,
  onProgress: ProgressFn = () => {},
): PrepareResult {
  const warnings: string[] = [];
  if (mesh.indices.length === 0) throw new Error('No hay geometría visible que preparar.');
  const bbox = meshBBox(mesh);
  const size: [number, number, number] = [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ];
  const h = chooseVoxelSize(size, options.voxelSize, options.minWall, options.maxVoxels);
  if (h > options.voxelSize * 1.001) {
    warnings.push(
      `El modelo es grande: se ha usado un vóxel de ${h.toFixed(2)} mm en lugar de ` +
        `${options.voxelSize.toFixed(2)} mm para no agotar la memoria.`,
    );
  }
  if (options.minWall < 2 * h) {
    warnings.push(
      `El grosor mínimo (${options.minWall} mm) es menor que dos vóxeles (${(2 * h).toFixed(2)} mm); ` +
        'el engrosado puede ser impreciso. Reduce el tamaño de vóxel si puedes.',
    );
  }

  const wall = options.minWall / h; // grosor mínimo en vóxeles
  const half = wall / 2;
  const pad = Math.ceil(wall) + 3;
  // La rejilla se desfasa una fracción de vóxel: así las caras alineadas con los ejes (lo
  // normal en un edificio) no caen justo en la frontera entre dos vóxeles, lo que dejaría
  // pequeños bultos en la superficie por errores de redondeo.
  const shift = 0.37 * h;
  const grid = gridForBounds(
    [bbox.min[0] - shift, bbox.min[1] - shift, bbox.min[2] - shift],
    bbox.max,
    h,
    pad,
  );
  const { nx, ny, nz } = grid;
  const slab = nx * ny;
  const n = voxelCount(grid);
  const kBase = options.sealBottom ? pad : 0;

  onProgress('Voxelizando superficie', 0.05);
  const surface = voxelizeSurface(mesh, grid);

  onProgress('Calculando distancias', 0.15);
  const bufA = squaredDistance(surface, grid);

  // Radio de cierre: al menos 1 vóxel para que la barrera sea estanca.
  const r = Math.max(1, options.closeGaps / (2 * h));
  const r2 = r * r;
  const blocked = surface; // se reutiliza el búfer
  for (let i = 0; i < n; i++) blocked[i] = bufA[i] <= r2 ? 1 : 0;
  if (kBase > 0) blocked.fill(1, 0, kBase * slab);

  onProgress('Detectando exterior', 0.3);
  const exterior = floodExterior(blocked, grid, kBase);
  if (options.mode === 'interiores') {
    const rooms = openLargeCavities(exterior, blocked, bufA, grid, r + Math.max(wall, 2), kBase);
    if (rooms === 0) {
      warnings.push('No se han encontrado estancias interiores cerradas: el resultado es macizo.');
    }
  }

  onProgress('Midiendo el sólido', 0.42);
  // a > 0 dentro del sólido; la superficie original queda en a ≈ 0.
  const a = squaredDistance(exterior, grid);
  for (let i = 0; i < n; i++) a[i] = Math.sqrt(a[i]) - (r + 0.5);

  // --- Engrosado de elementos finos -------------------------------------------------
  // Se analiza el cuerpo ligeramente inflado (INFLATE vóxeles) para incluir caras sueltas.
  const INFLATE = 1.5;
  onProgress('Buscando paredes finas', 0.55);
  const mask = blocked;
  for (let i = 0; i < n; i++) mask[i] = a[i] > -INFLATE ? 0 : 1;
  const inner2 = squaredDistance(mask, grid, bufA); // distancia al exterior del cuerpo inflado
  const coreLimit = half + 0.5 + INFLATE;
  const core2 = coreLimit * coreLimit;
  const mask2 = exterior;
  for (let i = 0; i < n; i++) mask2[i] = inner2[i] > core2 ? 1 : 0;
  const toCore2 = squaredDistance(mask2, grid);
  const openLimit = coreLimit + 1;
  const open2 = openLimit * openLimit;
  // Semillas: eje medio (máximos locales de la distancia interior) de las zonas finas.
  const seeds = mask;
  let seedCount = 0;
  const neighbors: number[] = [];
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) if (di || dj || dk) neighbors.push(di + nx * dj + slab * dk);
  seeds.fill(0);
  for (let k = Math.max(1, kBase); k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + nx * j + slab * k;
        const d = inner2[idx];
        if (d <= 0 || toCore2[idx] <= open2) continue;
        // Máximo local en los 26 vecinos: descarta las esquinas de cuerpos gruesos, donde
        // la distancia interior sigue creciendo hacia dentro.
        let isMax = true;
        for (let q = 0; q < 26; q++) {
          if (inner2[idx + neighbors[q]] > d) {
            isMax = false;
            break;
          }
        }
        if (isMax) {
          seeds[idx] = 1;
          seedCount++;
        }
      }
    }
  }

  onProgress('Engrosando', 0.7);
  const field = a;
  const carve = options.mode === 'cascara';
  if (seedCount > 0) {
    const toSeed2 = squaredDistance(seeds, grid, toCore2);
    for (let i = 0; i < n; i++) {
      const body = carve ? Math.min(a[i], wall - a[i]) : a[i];
      const thick = half - Math.sqrt(toSeed2[i]);
      field[i] = body > thick ? body : thick;
    }
  } else if (carve) {
    for (let i = 0; i < n; i++) field[i] = Math.min(a[i], wall - a[i]);
  }

  // Base plana: todo lo que queda por debajo del plano inferior se elimina.
  if (kBase > 0) {
    field.fill(-1, 0, (kBase - 1) * slab);
    const below = (kBase - 1) * slab;
    for (let i = 0; i < slab; i++) {
      const above = field[below + slab + i];
      field[below + i] = above > 0 ? -above : -1;
    }
  }
  // El borde de la rejilla debe quedar fuera para que la malla cierre.
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          const idx = i + nx * j + slab * k;
          if (field[idx] > 0) field[idx] = -1;
        }
      }
    }
  }

  onProgress('Generando malla', 0.85);
  const result = marchingCubes(field, grid);
  if (result.indices.length === 0) {
    warnings.push('El resultado está vacío. Revisa la escala, las unidades y las capas visibles.');
  }
  onProgress('Listo', 1);
  return { mesh: result, grid, voxelSize: h, warnings };
}
