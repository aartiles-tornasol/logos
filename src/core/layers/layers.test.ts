import { describe, expect, it } from 'vitest';
import { meshBBox, unionBBox } from '../geometry/mesh';
import { boxMesh, quadMesh, sampleBuilding } from '../geometry/primitives';
import type { Part } from '../types';
import { guessUnit, printScaleFactor } from '../units';
import { classifyPart } from './classify';
import { computeExposure } from './exposure';
import { findSimilar, groupName } from './grouping';

const building = sampleBuilding();
const modelBBox = unionBBox(building.map((p) => meshBBox(p.mesh)));
const ctx = { modelBBox, toMeters: 1 };
const kindOf = (name: string) => {
  const p = building.find((b) => b.name === name)!;
  return classifyPart({ name: p.name, mesh: p.mesh, bbox: meshBBox(p.mesh) }, ctx);
};

describe('classifyPart', () => {
  it('distingue muros, forjados, cubierta, vidrios y mobiliario', () => {
    expect(kindOf('Muro norte')).toBe('muro');
    expect(kindOf('Muro sur')).toBe('muro');
    expect(kindOf('Forjado P1')).toBe('forjado');
    expect(kindOf('Solera')).toBe('forjado');
    expect(kindOf('Cubierta')).toBe('cubierta');
    expect(kindOf('Vidrio 1')).toBe('vidrio');
    expect(kindOf('Mesa')).toBe('detalle');
    expect(kindOf('Silla')).toBe('detalle');
  });

  it('usa el material para reconocer vidrios', () => {
    const mesh = quadMesh([0, 0, 0], [5, 0, 0], [0, 0, 5]);
    const kind = classifyPart(
      { name: 'x', material: 'Glass_Clear', mesh, bbox: meshBBox(mesh) },
      ctx,
    );
    expect(kind).toBe('vidrio');
  });

  it('tiene en cuenta las unidades del modelo', () => {
    const mesh = boxMesh([0, 0, 0], [12000, 200, 6000]);
    const bbox = meshBBox(mesh);
    const kind = classifyPart({ name: 'm', mesh, bbox }, { modelBBox: bbox, toMeters: 0.001 });
    expect(kind).toBe('muro');
  });
});

describe('computeExposure', () => {
  it('separa lo visible desde fuera de lo interior', () => {
    const exposure = computeExposure(building.map((p) => p.mesh));
    const of = (name: string) => exposure[building.findIndex((b) => b.name === name)];
    expect(of('Muro norte')).toBeGreaterThan(0.3);
    expect(of('Cubierta')).toBeGreaterThan(0.3);
    expect(of('Mesa')).toBe(0);
    expect(of('Armario')).toBe(0);
    expect(of('Silla')).toBe(0);
    expect(of('Tabique')).toBeLessThan(0.04);
  });

  it('devuelve vacío sin piezas', () => {
    expect(computeExposure([])).toEqual([]);
  });
});

describe('agrupación', () => {
  const part = (
    id: string,
    mesh = boxMesh([0, 0, 0], [1, 1, 1]),
    extra: Partial<Part> = {},
  ): Part => ({
    id,
    name: id,
    sourceLayer: 'L1',
    layerId: 'x',
    mesh,
    bbox: meshBBox(mesh),
    ...extra,
  });

  it('nombra la capa según la estrategia', () => {
    const p = part('a', undefined, { material: 'Ladrillo', kind: 'muro', exposure: 0 });
    expect(groupName(p, 'origen')).toBe('L1');
    expect(groupName(p, 'material')).toBe('Ladrillo');
    expect(groupName(p, 'tipo')).toBe('Muros');
    expect(groupName(p, 'exposicion')).toMatch(/Interior/);
    expect(groupName(part('b', undefined, { exposure: 0.5 }), 'exposicion')).toMatch(/Exterior/);
    expect(groupName(part('c'), 'exposicion')).toBe('Sin analizar');
  });

  it('encuentra piezas similares aunque estén giradas', () => {
    const chair = part('s1', boxMesh([0, 0, 0], [0.5, 0.6, 0.9]), { kind: 'detalle' });
    const rotated = part('s2', boxMesh([5, 5, 0], [5.6, 5.5, 0.9]), { kind: 'detalle' });
    const table = part('t', boxMesh([0, 0, 0], [1.6, 1, 0.75]), { kind: 'detalle' });
    const wall = part('w', boxMesh([0, 0, 0], [0.5, 0.6, 0.9]), { kind: 'muro' });
    expect(findSimilar(chair, [chair, rotated, table, wall])).toEqual(['s1', 's2']);
  });
});

describe('unidades', () => {
  it('adivina la unidad por el tamaño de un edificio', () => {
    expect(guessUnit([12, 8, 6])).toBe('m');
    expect(guessUnit([12000, 8000, 6000])).toBe('mm');
    expect(guessUnit([1200, 800, 600])).toBe('cm');
  });
  it('calcula el factor de escala a mm impresos', () => {
    expect(printScaleFactor('m', 200)).toBe(5);
    expect(printScaleFactor('mm', 100)).toBe(0.01);
  });
});
