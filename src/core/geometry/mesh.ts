import type { BBox, Mesh, Vec3 } from '../types';

export function emptyBBox(): BBox {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function expandBBox(b: BBox, x: number, y: number, z: number): void {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}

export function meshBBox(mesh: Mesh): BBox {
  const b = emptyBBox();
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) expandBBox(b, p[i], p[i + 1], p[i + 2]);
  return b;
}

export function unionBBox(boxes: Iterable<BBox>): BBox {
  const b = emptyBBox();
  for (const o of boxes) {
    expandBBox(b, o.min[0], o.min[1], o.min[2]);
    expandBBox(b, o.max[0], o.max[1], o.max[2]);
  }
  return b;
}

export function bboxSize(b: BBox): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function isEmptyBBox(b: BBox): boolean {
  return b.min[0] > b.max[0];
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/**
 * Suelda vértices coincidentes (dentro de `tolerance`) y elimina triángulos degenerados.
 * Imprescindible para STL (sopa de triángulos) y para detectar piezas conectadas.
 */
export function weldMesh(mesh: Mesh, tolerance = 1e-5): Mesh {
  const { positions, indices } = mesh;
  const inv = 1 / tolerance;
  const map = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const out: number[] = [];
  for (let v = 0; v < remap.length; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = out.length / 3;
      map.set(key, id);
      out.push(x, y, z);
    }
    remap[v] = id;
  }
  const idx: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]];
    const b = remap[indices[i + 1]];
    const c = remap[indices[i + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(idx) };
}

/** Separa una malla en sus piezas conectadas (comparten vértices). Conviene soldar antes. */
export function splitConnectedComponents(mesh: Mesh): Mesh[] {
  const nv = mesh.positions.length / 3;
  const parent = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const { indices, positions } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const a = find(indices[i]);
    const b = find(indices[i + 1]);
    const c = find(indices[i + 2]);
    parent[b] = a;
    parent[c] = a;
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(i);
  }
  if (groups.size <= 1) return groups.size === 1 ? [mesh] : [];
  const result: Mesh[] = [];
  for (const tris of groups.values()) {
    const local = new Map<number, number>();
    const pos: number[] = [];
    const idx = new Uint32Array(tris.length * 3);
    let k = 0;
    for (const t of tris) {
      for (let j = 0; j < 3; j++) {
        const v = indices[t + j];
        let id = local.get(v);
        if (id === undefined) {
          id = pos.length / 3;
          local.set(v, id);
          pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        }
        idx[k++] = id;
      }
    }
    result.push({ positions: new Float32Array(pos), indices: idx });
  }
  return result;
}

/** Une varias mallas en una sola (sin soldar). */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let po = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, po);
    const base = po / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    po += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

/** Devuelve una copia de la malla con `p' = (p - origin) * scale`. */
export function transformMesh(mesh: Mesh, origin: Vec3, scale: number): Mesh {
  const src = mesh.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = (src[i] - origin[0]) * scale;
    positions[i + 1] = (src[i + 1] - origin[1]) * scale;
    positions[i + 2] = (src[i + 2] - origin[2]) * scale;
  }
  return { positions, indices: mesh.indices };
}

export interface MeshStats {
  area: number;
  /** Volumen con signo (positivo si las normales apuntan hacia fuera). Solo fiable si es estanca. */
  volume: number;
  /** Fracción del área cuya normal es casi vertical (|nz| > 0,9). */
  horizontalFraction: number;
  /** Fracción del área cuya normal es casi horizontal (|nz| < 0,1). */
  verticalFraction: number;
}

export function meshStats(mesh: Mesh): MeshStats {
  const { positions: p, indices } = mesh;
  let area = 0;
  let volume = 0;
  let horiz = 0;
  let vert = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const triArea = len / 2;
    area += triArea;
    volume += (p[a] * nx + p[a + 1] * ny + p[a + 2] * nz) / 6;
    if (len > 0) {
      const anz = Math.abs(nz) / len;
      if (anz > 0.9) horiz += triArea;
      else if (anz < 0.1) vert += triArea;
    }
  }
  return {
    area,
    volume,
    horizontalFraction: area > 0 ? horiz / area : 0,
    verticalFraction: area > 0 ? vert / area : 0,
  };
}

export interface ManifoldReport {
  /** Cada arista la comparten exactamente dos triángulos con orientación opuesta. */
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
}

/** Comprueba si la malla es una superficie cerrada y orientable (imprimible). */
export function checkManifold(mesh: Mesh): ManifoldReport {
  const nv = mesh.positions.length / 3;
  // clave de arista dirigida -> recuento
  const edges = new Map<number, number>();
  const { indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j];
      const b = indices[i + ((j + 1) % 3)];
      const key = a * nv + b;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  for (const [key, count] of edges) {
    const a = Math.floor(key / nv);
    const b = key - a * nv;
    const opposite = edges.get(b * nv + a) ?? 0;
    if (count > 1) inconsistent++;
    if (opposite === 0) boundary++;
    else if (count + opposite > 2 && a < b) nonManifold++;
  }
  return {
    watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
  };
}
