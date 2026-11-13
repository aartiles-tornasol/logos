import type { Mesh } from '../types';
import type { Grid } from './grid';

/**
 * Marca los vóxeles que toca la superficie de la malla, muestreando cada triángulo con una
 * separación de medio vóxel. No exige que la malla sea cerrada ni coherente: funciona con
 * la "sopa" de caras sueltas habitual en modelos de arquitectura.
 */
export function voxelizeSurface(mesh: Mesh, grid: Grid, out?: Uint8Array): Uint8Array {
  const { nx, ny, nz, h, origin } = grid;
  const mask = out ?? new Uint8Array(nx * ny * nz);
  const { positions: p, indices } = mesh;
  const inv = 1 / h;
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const k = Math.floor(z);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    mask[i + nx * (j + ny * k)] = 1;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = (p[a] - origin[0]) * inv;
    const ay = (p[a + 1] - origin[1]) * inv;
    const az = (p[a + 2] - origin[2]) * inv;
    const ux = (p[b] - origin[0]) * inv - ax;
    const uy = (p[b + 1] - origin[1]) * inv - ay;
    const uz = (p[b + 2] - origin[2]) * inv - az;
    const vx = (p[c] - origin[0]) * inv - ax;
    const vy = (p[c + 1] - origin[1]) * inv - ay;
    const vz = (p[c + 2] - origin[2]) * inv - az;
    const maxEdge = Math.max(
      Math.hypot(ux, uy, uz),
      Math.hypot(vx, vy, vz),
      Math.hypot(ux - vx, uy - vy, uz - vz),
    );
    const n = Math.max(1, Math.ceil(maxEdge * 2));
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      for (let j = 0; j <= n - i; j++) {
        const q = j / n;
        mark(ax + ux * s + vx * q, ay + uy * s + vy * q, az + uz * s + vz * q);
      }
    }
  }
  return mask;
}
