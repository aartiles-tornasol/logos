import type { ImportedObject, ImportResult } from '../types';

interface Builder {
  name: string;
  layer: string;
  material?: string;
  local: Map<number, number>;
  positions: number[];
  indices: number[];
}

/**
 * Lee Wavefront OBJ. Cada combinación de objeto/grupo (`o`/`g`) y material (`usemtl`) se
 * convierte en un objeto independiente; el grupo se usa como capa de origen, que es como
 * MicroStation y la mayoría de programas CAD exportan sus niveles.
 */
export function parseObj(text: string): ImportResult {
  const verts: number[] = [];
  const builders = new Map<string, Builder>();
  let group = 'default';
  let material: string | undefined;
  let current: Builder | undefined;
  let skipped = 0;

  const getBuilder = (): Builder => {
    if (current) return current;
    const key = `${group}\u0000${material ?? ''}`;
    let b = builders.get(key);
    if (!b) {
      b = { name: group, layer: group, material, local: new Map(), positions: [], indices: [] };
      builders.set(key, b);
    }
    return (current = b);
  };

  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash);
    const line = raw.trim();
    if (!line) continue;
    const sp = line.search(/\s/);
    const cmd = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    switch (cmd) {
      case 'v': {
        const c = rest.split(/\s+/);
        verts.push(Number(c[0]), Number(c[1]), Number(c[2]));
        break;
      }
      case 'o':
      case 'g':
        group = rest || 'default';
        current = undefined;
        break;
      case 'usemtl':
        material = rest || undefined;
        current = undefined;
        break;
      case 'f': {
        const tokens = rest.split(/\s+/);
        if (tokens.length < 3) {
          skipped++;
          break;
        }
        const b = getBuilder();
        const nv = verts.length / 3;
        const ids: number[] = [];
        for (const tok of tokens) {
          let vi = parseInt(tok, 10);
          if (Number.isNaN(vi)) continue;
          vi = vi < 0 ? nv + vi : vi - 1;
          if (vi < 0 || vi >= nv) continue;
          let id = b.local.get(vi);
          if (id === undefined) {
            id = b.positions.length / 3;
            b.local.set(vi, id);
            b.positions.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
          }
          ids.push(id);
        }
        // Triangulación en abanico (suficiente para polígonos convexos, lo habitual en CAD).
        for (let i = 1; i + 1 < ids.length; i++) b.indices.push(ids[0], ids[i], ids[i + 1]);
        break;
      }
      default:
        break;
    }
  }

  const objects: ImportedObject[] = [];
  for (const b of builders.values()) {
    if (b.indices.length === 0) continue;
    objects.push({
      name: b.material ? `${b.name} · ${b.material}` : b.name,
      layer: b.layer,
      material: b.material,
      mesh: { positions: new Float32Array(b.positions), indices: new Uint32Array(b.indices) },
    });
  }
  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} caras con menos de 3 vértices ignoradas.`);
  if (objects.length === 0) warnings.push('El OBJ no contiene caras.');
  return { objects, warnings };
}
