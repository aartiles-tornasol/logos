import type { Grid } from './grid';

/**
 * Inunda desde el borde de la rejilla todos los vóxeles no bloqueados (conectividad 6).
 * El resultado es el "exterior": todo lo que el aire alcanza desde fuera del edificio.
 * Las capas con k < `kMin` se tratan como suelo impermeable (base sellada).
 */
export function floodExterior(blocked: Uint8Array, grid: Grid, kMin = 0): Uint8Array {
  const { nx, ny, nz } = grid;
  const slab = nx * ny;
  const exterior = new Uint8Array(nx * ny * nz);
  const stack = new Int32Array(nx * ny * nz);
  let top = 0;
  const push = (idx: number) => {
    if (!blocked[idx] && !exterior[idx]) {
      exterior[idx] = 1;
      stack[top++] = idx;
    }
  };
  for (let k = kMin; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const border =
          i === 0 ||
          j === 0 ||
          i === nx - 1 ||
          j === ny - 1 ||
          k === nz - 1 ||
          (kMin === 0 && k === 0);
        if (border) push(i + nx * j + slab * k);
      }
    }
  }
  floodFrom(stack, top, blocked, exterior, grid, kMin);
  return exterior;
}

function floodFrom(
  stack: Int32Array,
  top: number,
  blocked: Uint8Array,
  visited: Uint8Array,
  grid: Grid,
  kMin: number,
): number {
  const { nx, ny, nz } = grid;
  const slab = nx * ny;
  let visitedCount = top;
  const visit = (idx: number) => {
    if (!blocked[idx] && !visited[idx]) {
      visited[idx] = 1;
      stack[top++] = idx;
      visitedCount++;
    }
  };
  while (top > 0) {
    const idx = stack[--top];
    const k = Math.floor(idx / slab);
    const rem = idx - k * slab;
    const j = Math.floor(rem / nx);
    const i = rem - j * nx;
    if (i > 0) visit(idx - 1);
    if (i < nx - 1) visit(idx + 1);
    if (j > 0) visit(idx - nx);
    if (j < ny - 1) visit(idx + nx);
    if (k > kMin) visit(idx - slab);
    if (k < nz - 1) visit(idx + slab);
  }
  return visitedCount;
}

/**
 * Añade a `exterior` las cavidades cerradas (zonas libres que el aire exterior no alcanza)
 * cuyo radio inscrito supera `minRadius` vóxeles: son las estancias interiores. Las cavidades
 * pequeñas (cámaras dentro de muros, huecos de modelado) se dejan para que queden macizas.
 * Devuelve el número de cavidades conservadas.
 */
export function openLargeCavities(
  exterior: Uint8Array,
  blocked: Uint8Array,
  dist2: Float32Array,
  grid: Grid,
  minRadius: number,
  kMin = 0,
): number {
  const { nx, ny, nz } = grid;
  const slab = nx * ny;
  const n = nx * ny * nz;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  const min2 = minRadius * minRadius;
  let kept = 0;
  for (let start = kMin * slab; start < n; start++) {
    if (blocked[start] || exterior[start] || seen[start]) continue;
    // Recorre la componente guardando sus miembros.
    let top = 0;
    let count = 0;
    let maxD2 = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const idx = stack[--top];
      members[count++] = idx;
      if (dist2[idx] > maxD2) maxD2 = dist2[idx];
      const k = Math.floor(idx / slab);
      const rem = idx - k * slab;
      const j = Math.floor(rem / nx);
      const i = rem - j * nx;
      const tryVisit = (q: number) => {
        if (!blocked[q] && !exterior[q] && !seen[q]) {
          seen[q] = 1;
          stack[top++] = q;
        }
      };
      if (i > 0) tryVisit(idx - 1);
      if (i < nx - 1) tryVisit(idx + 1);
      if (j > 0) tryVisit(idx - nx);
      if (j < ny - 1) tryVisit(idx + nx);
      if (k > kMin) tryVisit(idx - slab);
      if (k < nz - 1) tryVisit(idx + slab);
    }
    if (maxD2 >= min2) {
      kept++;
      for (let m = 0; m < count; m++) exterior[members[m]] = 1;
    }
  }
  return kept;
}
