import { describe, expect, it } from 'vitest';
import { writeBinaryStl } from '../export/stl';
import { checkManifold, meshBBox, meshStats } from '../geometry/mesh';
import { boxMesh } from '../geometry/primitives';
import { parseDxf } from './dxf';
import { importModel } from './index';
import { parseObj } from './obj';
import { parseStl } from './stl';

const encode = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('STL', () => {
  it('escribe y vuelve a leer un STL binario sin perder geometría', () => {
    const box = boxMesh([0, 0, 0], [10, 20, 30]);
    const buffer = writeBinaryStl(box);
    expect(buffer.byteLength).toBe(84 + 12 * 50);
    const { objects, warnings } = parseStl(buffer, 'caja');
    expect(warnings).toEqual([]);
    expect(objects).toHaveLength(1);
    const mesh = objects[0].mesh;
    expect(mesh.positions.length / 3).toBe(8);
    expect(checkManifold(mesh).watertight).toBe(true);
    expect(meshStats(mesh).volume).toBeCloseTo(6000, 3);
  });

  it('lee STL ASCII', () => {
    const ascii = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const { objects } = parseStl(encode(ascii));
    expect(objects[0].mesh.indices.length).toBe(3);
  });

  it('avisa si el STL está vacío', () => {
    const { objects, warnings } = parseStl(encode('solid vacio\nendsolid vacio'));
    expect(objects).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});

describe('OBJ', () => {
  const obj = `# ejemplo
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 3
v 1 0 3
g Muros
usemtl Hormigon
f 1 2 6 5
g Forjados
usemtl Hormigon
f 1/1/1 2/2/1 3/3/1 4/4/1
g Muros
usemtl Vidrio
f -4 -3 -2
`;
  it('separa objetos por grupo y material y triangula polígonos', () => {
    const { objects, warnings } = parseObj(obj);
    expect(warnings).toEqual([]);
    expect(objects.map((o) => [o.layer, o.material])).toEqual([
      ['Muros', 'Hormigon'],
      ['Forjados', 'Hormigon'],
      ['Muros', 'Vidrio'],
    ]);
    expect(objects[0].mesh.indices.length).toBe(6);
    expect(objects[1].mesh.indices.length).toBe(6);
    expect(objects[2].mesh.indices.length).toBe(3);
    expect(meshBBox(objects[0].mesh).max[2]).toBe(3);
  });

  it('avisa si no hay caras', () => {
    expect(parseObj('v 0 0 0\n').warnings).toHaveLength(1);
  });
});

describe('DXF', () => {
  const pairs = (...values: (string | number)[]) => values.join('\n') + '\n';
  const face = (layer: string, pts: number[][]) =>
    pairs(
      0,
      '3DFACE',
      8,
      layer,
      ...pts.flatMap((p, i) => [10 + i, p[0], 20 + i, p[1], 30 + i, p[2]]),
    );

  it('lee 3DFACE con su capa y las unidades', () => {
    const dxf =
      pairs(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC') +
      pairs(0, 'SECTION', 2, 'ENTITIES') +
      face('MUROS', [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
        [0, 0, 3],
      ]) +
      face('CUBIERTA', [
        [0, 0, 3],
        [4, 0, 3],
        [4, 4, 3],
        [4, 4, 3],
      ]) +
      pairs(0, 'ENDSEC', 0, 'EOF');
    const { objects, unitHint, warnings } = parseDxf(dxf);
    expect(warnings).toEqual([]);
    expect(unitHint).toBe('m');
    expect(objects.map((o) => o.layer).sort()).toEqual(['CUBIERTA', 'MUROS']);
    const muros = objects.find((o) => o.layer === 'MUROS')!;
    expect(muros.mesh.indices.length / 3).toBe(2);
    const cubierta = objects.find((o) => o.layer === 'CUBIERTA')!;
    expect(cubierta.mesh.indices.length / 3).toBe(1);
  });

  it('lee mallas polyface', () => {
    const vertex = (x: number, y: number, z: number) =>
      pairs(0, 'VERTEX', 8, 'M', 10, x, 20, y, 30, z, 70, 192);
    const dxf =
      pairs(0, 'SECTION', 2, 'ENTITIES', 0, 'POLYLINE', 8, 'M', 70, 64) +
      vertex(0, 0, 0) +
      vertex(1, 0, 0) +
      vertex(1, 1, 0) +
      vertex(0, 1, 0) +
      pairs(0, 'VERTEX', 8, 'M', 10, 0, 20, 0, 30, 0, 70, 128, 71, 1, 72, 2, 73, -3, 74, 4) +
      pairs(0, 'SEQEND', 0, 'ENDSEC', 0, 'EOF');
    const { objects } = parseDxf(dxf);
    expect(objects).toHaveLength(1);
    expect(objects[0].mesh.indices.length / 3).toBe(2);
  });

  it('expande bloques con INSERT (traslación, escala, giro y herencia de capa)', () => {
    const dxf =
      pairs(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'SILLA', 10, 0, 20, 0, 30, 0) +
      face('0', [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ]) +
      pairs(0, 'ENDBLK', 0, 'ENDSEC') +
      pairs(0, 'SECTION', 2, 'ENTITIES') +
      pairs(
        0,
        'INSERT',
        8,
        'MOBILIARIO',
        2,
        'SILLA',
        10,
        10,
        20,
        0,
        30,
        0,
        41,
        2,
        42,
        2,
        43,
        2,
        50,
        90,
      ) +
      pairs(0, 'ENDSEC', 0, 'EOF');
    const { objects } = parseDxf(dxf);
    expect(objects).toHaveLength(1);
    expect(objects[0].layer).toBe('MOBILIARIO');
    const b = meshBBox(objects[0].mesh);
    expect(b.min[0]).toBeCloseTo(10);
    expect(b.max[0]).toBeCloseTo(10);
    expect(b.max[1]).toBeCloseTo(2);
    expect(b.max[2]).toBeCloseTo(2);
  });

  it('avisa de los sólidos ACIS que no puede leer', () => {
    const dxf = pairs(0, 'SECTION', 2, 'ENTITIES', 0, '3DSOLID', 8, 'X', 0, 'ENDSEC', 0, 'EOF');
    const { objects, warnings } = parseDxf(dxf);
    expect(objects).toHaveLength(0);
    expect(warnings.some((w) => w.includes('3DSOLID'))).toBe(true);
  });
});

describe('importModel', () => {
  it('elige el lector por extensión', () => {
    const result = importModel('Edificio.OBJ', encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'));
    expect(result.objects).toHaveLength(1);
  });
  it('explica cómo exportar cuando se intenta abrir un DGN', () => {
    expect(() => importModel('torre.dgn', new ArrayBuffer(8))).toThrow(/Exportar/);
  });
  it('rechaza formatos desconocidos', () => {
    expect(() => importModel('plano.pdf', new ArrayBuffer(8))).toThrow(/no soportado/);
  });
});
