import type { ImportedObject, ImportResult, LengthUnit } from '../types';

interface Pair {
  code: number;
  value: string;
}

interface Entity {
  type: string;
  pairs: Pair[];
  /** Vértices de una POLYLINE (entidades VERTEX hasta SEQEND). */
  vertices?: Entity[];
}

type Triangle = [number, number, number, number, number, number, number, number, number];

interface LayerTris {
  [layer: string]: number[];
}

const INSUNITS: Record<number, LengthUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const SOLID_TYPES = new Set(['3DSOLID', 'BODY', 'REGION', 'SURFACE']);
const MAX_INSERT_DEPTH = 8;

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
}

function readEntities(pairs: Pair[], start: number, endMarker: string): [Entity[], number] {
  const entities: Entity[] = [];
  let i = start;
  let polyline: Entity | undefined;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code !== 0) {
      i++;
      continue;
    }
    if (p.value === endMarker) return [entities, i];
    const entity: Entity = { type: p.value, pairs: [] };
    i++;
    while (i < pairs.length && pairs[i].code !== 0) entity.pairs.push(pairs[i++]);
    if (entity.type === 'POLYLINE') {
      entity.vertices = [];
      polyline = entity;
      entities.push(entity);
    } else if (entity.type === 'VERTEX' && polyline) {
      polyline.vertices!.push(entity);
    } else if (entity.type === 'SEQEND') {
      polyline = undefined;
    } else {
      entities.push(entity);
    }
  }
  return [entities, i];
}

const num = (e: Entity, code: number, fallback = 0): number => {
  for (const p of e.pairs) if (p.code === code) return Number(p.value);
  return fallback;
};
const str = (e: Entity, code: number, fallback = ''): string => {
  for (const p of e.pairs) if (p.code === code) return p.value;
  return fallback;
};

type Emit = (layer: string, tri: Triangle) => void;
type Transform = (x: number, y: number, z: number) => [number, number, number];

/**
 * Lee la geometría con caras de un DXF ASCII: 3DFACE, mallas POLYLINE (polyface y polygon
 * mesh), MESH e INSERT de bloques. Conserva la capa (nivel de MicroStation) de cada entidad.
 * Los sólidos ACIS (3DSOLID) no se pueden leer: se avisa para que se exporten facetados.
 */
export function parseDxf(text: string): ImportResult {
  const pairs = tokenize(text);
  const blocks = new Map<string, { base: [number, number, number]; entities: Entity[] }>();
  let entities: Entity[] = [];
  let unitHint: LengthUnit | undefined;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 9 && p.value === '$INSUNITS' && pairs[i + 1]) {
      unitHint = INSUNITS[Number(pairs[i + 1].value)];
    }
    if (p.code !== 0 || p.value !== 'SECTION' || !pairs[i + 1]) continue;
    const section = pairs[i + 1].value;
    if (section === 'ENTITIES') {
      [entities, i] = readEntities(pairs, i + 2, 'ENDSEC');
    } else if (section === 'BLOCKS') {
      let j = i + 2;
      while (j < pairs.length && !(pairs[j].code === 0 && pairs[j].value === 'ENDSEC')) {
        if (pairs[j].code === 0 && pairs[j].value === 'BLOCK') {
          const header: Entity = { type: 'BLOCK', pairs: [] };
          j++;
          while (j < pairs.length && pairs[j].code !== 0) header.pairs.push(pairs[j++]);
          const [blockEntities, end] = readEntities(pairs, j, 'ENDBLK');
          blocks.set(str(header, 2), {
            base: [num(header, 10), num(header, 20), num(header, 30)],
            entities: blockEntities,
          });
          j = end + 1;
        } else {
          j++;
        }
      }
      i = j;
    }
  }

  const tris: LayerTris = {};
  const skipped = new Map<string, number>();
  const emit: Emit = (layer, tri) => {
    (tris[layer] ??= []).push(...tri);
  };

  const emitEntity = (e: Entity, tf: Transform, parentLayer: string | undefined, depth: number) => {
    const own = str(e, 8, '0');
    // En DXF, las entidades de un bloque en la capa "0" heredan la capa del INSERT.
    const layer = own === '0' && parentLayer !== undefined ? parentLayer : own;
    const tri = (a: number[], b: number[], c: number[]) => {
      const A = tf(a[0], a[1], a[2]);
      const B = tf(b[0], b[1], b[2]);
      const C = tf(c[0], c[1], c[2]);
      emit(layer, [...A, ...B, ...C]);
    };
    switch (e.type) {
      case '3DFACE': {
        const v = [0, 1, 2, 3].map((k) => [num(e, 10 + k), num(e, 20 + k), num(e, 30 + k)]);
        tri(v[0], v[1], v[2]);
        const same = v[2][0] === v[3][0] && v[2][1] === v[3][1] && v[2][2] === v[3][2];
        if (!same) tri(v[0], v[2], v[3]);
        break;
      }
      case 'POLYLINE': {
        const flags = num(e, 70);
        const vs = e.vertices ?? [];
        if (flags & 64) {
          const pts: number[][] = [];
          const faces: Entity[] = [];
          for (const v of vs) {
            const vf = num(v, 70);
            if (vf & 128 && !(vf & 64)) faces.push(v);
            else pts.push([num(v, 10), num(v, 20), num(v, 30)]);
          }
          for (const f of faces) {
            const ids = [71, 72, 73, 74]
              .map((c) => Math.abs(num(f, c)))
              .filter((id) => id > 0 && id <= pts.length)
              .map((id) => pts[id - 1]);
            for (let k = 1; k + 1 < ids.length; k++) tri(ids[0], ids[k], ids[k + 1]);
          }
        } else if (flags & 16) {
          const m = num(e, 71);
          const n = num(e, 72);
          const pts = vs.map((v) => [num(v, 10), num(v, 20), num(v, 30)]);
          if (pts.length >= m * n) {
            const mEnd = flags & 1 ? m : m - 1;
            const nEnd = flags & 32 ? n : n - 1;
            for (let a = 0; a < mEnd; a++) {
              for (let b = 0; b < nEnd; b++) {
                const p00 = pts[a * n + b];
                const p01 = pts[a * n + ((b + 1) % n)];
                const p10 = pts[((a + 1) % m) * n + b];
                const p11 = pts[((a + 1) % m) * n + ((b + 1) % n)];
                tri(p00, p10, p11);
                tri(p00, p11, p01);
              }
            }
          }
        } else {
          skipped.set('POLYLINE (línea)', (skipped.get('POLYLINE (línea)') ?? 0) + 1);
        }
        break;
      }
      case 'MESH': {
        const pts: number[][] = [];
        const faceList: number[] = [];
        let nVerts = -1;
        let nFace = -1;
        let cur: number[] | undefined;
        for (const p of e.pairs) {
          if (p.code === 92 && nVerts < 0) nVerts = Number(p.value);
          else if (p.code === 93 && nFace < 0) nFace = Number(p.value);
          else if (p.code === 10 && nVerts >= 0 && pts.length < nVerts) {
            cur = [Number(p.value), 0, 0];
            pts.push(cur);
          } else if (p.code === 20 && cur) cur[1] = Number(p.value);
          else if (p.code === 30 && cur) cur[2] = Number(p.value);
          else if (p.code === 90 && nFace >= 0 && faceList.length < nFace) {
            faceList.push(Number(p.value));
          }
        }
        for (let k = 0; k < faceList.length;) {
          const count = faceList[k++];
          const ids = faceList.slice(k, k + count).filter((id) => id >= 0 && id < pts.length);
          k += count;
          for (let j = 1; j + 1 < ids.length; j++) tri(pts[ids[0]], pts[ids[j]], pts[ids[j + 1]]);
        }
        break;
      }
      case 'INSERT': {
        const block = blocks.get(str(e, 2));
        if (!block || depth >= MAX_INSERT_DEPTH) break;
        const ix = num(e, 10);
        const iy = num(e, 20);
        const iz = num(e, 30);
        const sx = num(e, 41, 1);
        const sy = num(e, 42, 1);
        const sz = num(e, 43, 1);
        const rot = (num(e, 50) * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const [bx, by, bz] = block.base;
        const inner: Transform = (x, y, z) => {
          const lx = (x - bx) * sx;
          const ly = (y - by) * sy;
          const lz = (z - bz) * sz;
          return tf(lx * cos - ly * sin + ix, lx * sin + ly * cos + iy, lz + iz);
        };
        for (const child of block.entities) emitEntity(child, inner, layer, depth + 1);
        break;
      }
      default:
        if (SOLID_TYPES.has(e.type)) skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
        break;
    }
  };

  const identity: Transform = (x, y, z) => [x, y, z];
  for (const e of entities) emitEntity(e, identity, undefined, 0);

  const objects: ImportedObject[] = [];
  for (const [layer, soup] of Object.entries(tris)) {
    const positions = new Float32Array(soup);
    const indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    objects.push({ name: layer, layer, mesh: { positions, indices } });
  }

  const warnings: string[] = [];
  for (const [type, count] of skipped) {
    if (SOLID_TYPES.has(type)) {
      warnings.push(
        `${count} entidades ${type} (sólidos ACIS) no se pueden leer. ` +
          'Expórtalas desde MicroStation como malla facetada o usa OBJ/STL.',
      );
    }
  }
  if (objects.length === 0)
    warnings.push('El DXF no contiene caras 3D (3DFACE, mallas o bloques).');
  return { objects, warnings, unitHint };
}
