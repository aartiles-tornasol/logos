import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { Mesh } from '../types';
import type { Grid } from './grid';

class FloatBuffer {
  data = new Float32Array(1 << 16);
  length = 0;
  push3(x: number, y: number, z: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = x;
    this.data[this.length++] = y;
    this.data[this.length++] = z;
  }
}

class IndexBuffer {
  data = new Uint32Array(1 << 16);
  length = 0;
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
}

// Esquinas del cubo (convención de Paul Bourke) y aristas como pares de esquinas.
const CORNER = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const EDGE_CORNERS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
// Para cada arista: desplazamiento (di, dj, dk) de su vértice de origen y eje (0=x, 1=y, 2=z).
const EDGE_SLOT = [
  [0, 0, 0, 0],
  [1, 0, 0, 1],
  [0, 1, 0, 0],
  [0, 0, 0, 1],
  [0, 0, 1, 0],
  [1, 0, 1, 1],
  [0, 1, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 2],
  [1, 0, 0, 2],
  [1, 1, 0, 2],
  [0, 1, 0, 2],
];

/**
 * Extrae la isosuperficie `field = 0` (interior donde field > 0) con marching cubes.
 * Los valores del campo están en los centros de vóxel. Los vértices se comparten entre
 * celdas, de modo que la malla resultante es cerrada siempre que el campo sea negativo
 * en el borde de la rejilla. Las normales apuntan hacia fuera del sólido.
 */
export function marchingCubes(field: Float32Array, grid: Grid): Mesh {
  const { nx, ny, nz, h, origin } = grid;
  const slab = nx * ny;
  const positions = new FloatBuffer();
  const indices = new IndexBuffer();
  // Caché de vértices por arista: [eje x, eje y] de la capa k y k+1, y eje z entre ambas.
  let xyLow = new Int32Array(slab * 2).fill(-1);
  let xyHigh = new Int32Array(slab * 2).fill(-1);
  const zEdges = new Int32Array(slab).fill(-1);
  const val = new Float64Array(8);
  const edgeVertex = new Int32Array(12);
  const ox = origin[0] + h / 2;
  const oy = origin[1] + h / 2;
  const oz = origin[2] + h / 2;

  for (let k = 0; k < nz - 1; k++) {
    zEdges.fill(-1);
    xyHigh.fill(-1);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const base = i + nx * j + slab * k;
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c];
          const value = field[base + o[0] + nx * o[1] + slab * o[2]];
          val[c] = value;
          if (value > 0) cubeIndex |= 1 << c;
        }
        const bits = edgeTable[cubeIndex];
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const slot = EDGE_SLOT[e];
          const cell = i + slot[0] + nx * (j + slot[1]);
          const axis = slot[3];
          const cache = axis === 2 ? zEdges : slot[2] === 0 ? xyLow : xyHigh;
          const cacheIndex = axis === 2 ? cell : cell * 2 + axis;
          let vertex = cache[cacheIndex];
          if (vertex < 0) {
            const [c0, c1] = EDGE_CORNERS[e];
            const v0 = val[c0];
            const v1 = val[c1];
            let t = v0 / (v0 - v1);
            // Evita vértices coincidentes (triángulos degenerados) cuando el campo roza 0.
            if (!(t > 0.02)) t = 0.02;
            else if (t > 0.98) t = 0.98;
            const a = CORNER[c0];
            const b = CORNER[c1];
            vertex = positions.length / 3;
            positions.push3(
              ox + (i + a[0] + (b[0] - a[0]) * t) * h,
              oy + (j + a[1] + (b[1] - a[1]) * t) * h,
              oz + (k + a[2] + (b[2] - a[2]) * t) * h,
            );
            cache[cacheIndex] = vertex;
          }
          edgeVertex[e] = vertex;
        }
        const row = cubeIndex * 16;
        for (let t = 0; triTable[row + t] !== -1; t += 3) {
          indices.push3(
            edgeVertex[triTable[row + t]],
            edgeVertex[triTable[row + t + 2]],
            edgeVertex[triTable[row + t + 1]],
          );
        }
      }
    }
    const swap = xyLow;
    xyLow = xyHigh;
    xyHigh = swap;
  }
  return {
    positions: positions.data.slice(0, positions.length),
    indices: indices.data.slice(0, indices.length),
  };
}
