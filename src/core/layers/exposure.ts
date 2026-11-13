import { mergeMeshes, meshBBox } from '../geometry/mesh';
import type { Mesh } from '../types';
import { squaredDistance } from '../voxel/edt';
import { floodExterior } from '../voxel/flood';
import { gridForBounds } from '../voxel/grid';
import { voxelizeSurface } from '../voxel/voxelize';

/**
 * Calcula qué fracción de cada pieza es visible desde el exterior del edificio.
 * Se inunda el aire exterior sobre una rejilla gruesa (con la base sellada) y se mide,
 * para cada pieza, cuántos de sus puntos quedan pegados a ese aire. Las piezas con
 * exposición ~0 son interiores (mobiliario, tabiques, forjados intermedios).
 */
export function computeExposure(meshes: Mesh[], resolution = 160): number[] {
  if (meshes.length === 0) return [];
  const all = mergeMeshes(meshes);
  if (all.indices.length === 0) return meshes.map(() => 0);
  const bbox = meshBBox(all);
  const maxDim = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  );
  const h = maxDim / resolution || 1;
  const pad = 3;
  const grid = gridForBounds(bbox.min, bbox.max, h, pad);
  const { nx, ny, nz } = grid;
  const surface = voxelizeSurface(all, grid);
  const dist2 = squaredDistance(surface, grid);
  const blocked = surface;
  for (let i = 0; i < blocked.length; i++) blocked[i] = dist2[i] <= 1 ? 1 : 0;
  blocked.fill(1, 0, pad * nx * ny);
  const exterior = floodExterior(blocked, grid, pad);
  const toExterior2 = squaredDistance(exterior, grid, dist2);
  const limit2 = 2.6 * 2.6;

  const sample = (x: number, y: number, z: number): boolean => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - grid.origin[0]) / h)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - grid.origin[1]) / h)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - grid.origin[2]) / h)));
    return toExterior2[i + nx * (j + ny * k)] <= limit2;
  };

  return meshes.map((mesh) => {
    const { positions: p, indices } = mesh;
    let exposed = 0;
    let total = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3;
      const b = indices[t + 1] * 3;
      const c = indices[t + 2] * 3;
      total++;
      if (
        sample(
          (p[a] + p[b] + p[c]) / 3,
          (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
          (p[a + 2] + p[b + 2] + p[c + 2]) / 3,
        )
      ) {
        exposed++;
      }
    }
    return total ? exposed / total : 0;
  });
}
