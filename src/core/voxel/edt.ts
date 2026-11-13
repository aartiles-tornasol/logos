import type { Grid } from './grid';

const INF = 1e20;

/**
 * Transformada de distancia euclídea exacta (Felzenszwalb y Huttenlocher, 2012).
 * Devuelve, para cada vóxel, el cuadrado de la distancia (en vóxeles) al vóxel marcado
 * más cercano de `mask`. Coste lineal en el número de vóxeles.
 */
export function squaredDistance(mask: Uint8Array, grid: Grid, out?: Float32Array): Float32Array {
  const { nx, ny, nz } = grid;
  const d = out ?? new Float32Array(nx * ny * nz);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const maxN = Math.max(nx, ny, nz);
  const f = new Float64Array(maxN);
  const r = new Float64Array(maxN);
  const v = new Int32Array(maxN);
  const z = new Float64Array(maxN + 1);

  const pass = (n: number, start: number, stride: number) => {
    for (let q = 0; q < n; q++) f[q] = d[start + q * stride];
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      r[q] = dq * dq + f[v[k]];
    }
    for (let q = 0; q < n; q++) d[start + q * stride] = r[q];
  };

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) pass(nx, nx * (j + ny * k), 1);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(ny, i + nx * ny * k, nx);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(nz, i + nx * j, nx * ny);
  return d;
}
