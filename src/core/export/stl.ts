import type { Mesh } from '../types';

/** Serializa una malla como STL binario (el formato que aceptan todos los laminadores). */
export function writeBinaryStl(mesh: Mesh, header = 'Logos maquetas'): ArrayBuffer {
  const { positions: p, indices } = mesh;
  const nTri = indices.length / 3;
  const buffer = new ArrayBuffer(84 + nTri * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < Math.min(80, header.length); i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, nTri, true);
  let o = 84;
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
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p[v], true);
      view.setFloat32(o + 4, p[v + 1], true);
      view.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return buffer;
}
