import { describe, expect, it } from 'vitest';
import { boxMesh } from '../geometry/primitives';
import { checkManifold, meshStats } from '../geometry/mesh';
import { squaredDistance } from './edt';
import { floodExterior, openLargeCavities } from './flood';
import { gridForBounds, type Grid } from './grid';
import { marchingCubes } from './marchingCubes';
import { voxelizeSurface } from './voxelize';

const cube = (n: number): Grid => ({ nx: n, ny: n, nz: n, h: 1, origin: [0, 0, 0] });

describe('squaredDistance', () => {
  it('coincide con la fuerza bruta', () => {
    const grid: Grid = { nx: 9, ny: 7, nz: 5, h: 1, origin: [0, 0, 0] };
    const mask = new Uint8Array(9 * 7 * 5);
    const seeds = [
      [1, 1, 1],
      [7, 5, 3],
      [4, 0, 4],
    ];
    for (const [i, j, k] of seeds) mask[i + 9 * (j + 7 * k)] = 1;
    const d = squaredDistance(mask, grid);
    for (let k = 0; k < 5; k++)
      for (let j = 0; j < 7; j++)
        for (let i = 0; i < 9; i++) {
          const expected = Math.min(
            ...seeds.map(([a, b, c]) => (a - i) ** 2 + (b - j) ** 2 + (c - k) ** 2),
          );
          expect(d[i + 9 * (j + 7 * k)]).toBe(expected);
        }
  });
});

describe('voxelizeSurface + floodExterior', () => {
  it('una caja cerrada no deja entrar la inundación', () => {
    const grid = gridForBounds([0, 0, 0], [10, 10, 10], 1, 2);
    const blocked = voxelizeSurface(boxMesh([0.5, 0.5, 0.5], [9.5, 9.5, 9.5]), grid);
    const exterior = floodExterior(blocked, grid);
    const center = 7 + grid.nx * (7 + grid.ny * 7);
    expect(blocked[center]).toBe(0);
    expect(exterior[center]).toBe(0);
    expect(exterior[0]).toBe(1);
  });

  it('con la base sellada no entra por debajo', () => {
    const grid = cube(8);
    const blocked = new Uint8Array(8 ** 3);
    // Paredes y techo de una caja abierta por abajo, apoyada en k = 2.
    for (let k = 2; k <= 5; k++)
      for (let j = 2; j <= 5; j++)
        for (let i = 2; i <= 5; i++) {
          const shell = i === 2 || i === 5 || j === 2 || j === 5 || k === 5;
          if (shell) blocked[i + 8 * (j + 8 * k)] = 1;
        }
    const inside = 3 + 8 * (3 + 8 * 3);
    expect(floodExterior(blocked, grid, 0)[inside]).toBe(1);
    blocked.fill(1, 0, 2 * 64);
    expect(floodExterior(blocked, grid, 2)[inside]).toBe(0);
  });
});

describe('openLargeCavities', () => {
  it('conserva estancias grandes y rellena cavidades pequeñas', () => {
    const grid = gridForBounds([0, 0, 0], [30, 12, 12], 1, 2);
    const mesh = {
      // Estancia de 10 y cavidad de 2, separadas.
      ...boxMesh([1, 1, 1], [11, 11, 11]),
    };
    const small = boxMesh([20, 4, 4], [23, 7, 7]);
    const blocked = voxelizeSurface(mesh, grid);
    voxelizeSurface(small, grid, blocked);
    const dist2 = squaredDistance(blocked, grid);
    const exterior = floodExterior(blocked, grid);
    const kept = openLargeCavities(exterior, blocked, dist2, grid, 3);
    expect(kept).toBe(1);
    const at = (x: number, y: number, z: number) =>
      exterior[x + 2 + grid.nx * (y + 2 + grid.ny * (z + 2))];
    expect(at(6, 6, 6)).toBe(1);
    expect(at(21, 5, 5)).toBe(0);
  });
});

describe('marchingCubes', () => {
  it('extrae una esfera estanca, orientada hacia fuera y con el volumen correcto', () => {
    const n = 32;
    const grid = cube(n);
    const field = new Float32Array(n ** 3);
    const c = n / 2 - 0.5;
    const radius = 10;
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++)
          field[i + n * (j + n * k)] = radius - Math.hypot(i - c, j - c, k - c);
    const mesh = marchingCubes(field, grid);
    expect(checkManifold(mesh).watertight).toBe(true);
    const volume = meshStats(mesh).volume;
    const expected = (4 / 3) * Math.PI * radius ** 3;
    expect(volume).toBeGreaterThan(0);
    expect(Math.abs(volume - expected) / expected).toBeLessThan(0.02);
  });

  it('devuelve una malla vacía si no hay superficie', () => {
    const mesh = marchingCubes(new Float32Array(64).fill(-1), cube(4));
    expect(mesh.indices.length).toBe(0);
  });
});
