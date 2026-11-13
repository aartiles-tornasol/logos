import type { ImportResult } from '../types';
import { weldMesh } from '../geometry/mesh';

function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const n = new DataView(buffer).getUint32(80, true);
  if (84 + n * 50 === buffer.byteLength) return true;
  const head = new TextDecoder().decode(
    new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)),
  );
  return !/^\s*solid\b/.test(head);
}

/** Lee STL binario o ASCII. El STL no tiene capas: todo llega como un único objeto. */
export function parseStl(buffer: ArrayBuffer, name = 'modelo'): ImportResult {
  let soup: Float32Array;
  if (isBinaryStl(buffer)) {
    const view = new DataView(buffer);
    const n = Math.min(view.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50));
    soup = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) soup[t * 9 + k] = view.getFloat32(o + k * 4, true);
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const values: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
    values.length -= values.length % 9;
    soup = new Float32Array(values);
  }
  const indices = new Uint32Array(soup.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  const mesh = weldMesh({ positions: soup, indices });
  const warnings: string[] = [];
  if (mesh.indices.length === 0) warnings.push('El STL no contiene triángulos válidos.');
  return {
    objects: mesh.indices.length ? [{ name, layer: name, mesh }] : [],
    warnings,
  };
}
