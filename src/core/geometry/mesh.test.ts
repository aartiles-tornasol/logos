import { describe, expect, it } from 'vitest';
import {
  bboxSize,
  checkManifold,
  mergeMeshes,
  meshBBox,
  meshStats,
  splitConnectedComponents,
  transformMesh,
  weldMesh,
} from './mesh';
import { boxMesh, quadMesh, sampleBuilding } from './primitives';

describe('meshBBox', () => {
  it('calcula la caja envolvente', () => {
    const b = meshBBox(boxMesh([1, 2, 3], [4, 6, 8]));
    expect(b.min).toEqual([1, 2, 3]);
    expect(b.max).toEqual([4, 6, 8]);
    expect(bboxSize(b)).toEqual([3, 4, 5]);
  });
});

describe('meshStats', () => {
  it('mide área, volumen y orientación de una caja', () => {
    const s = meshStats(boxMesh([0, 0, 0], [2, 3, 4]));
    expect(s.area).toBeCloseTo(2 * (6 + 8 + 12));
    expect(s.volume).toBeCloseTo(24);
    expect(s.horizontalFraction).toBeCloseTo(12 / 52);
    expect(s.verticalFraction).toBeCloseTo(40 / 52);
  });
});

describe('checkManifold', () => {
  it('reconoce una caja como estanca', () => {
    expect(checkManifold(boxMesh([0, 0, 0], [1, 1, 1])).watertight).toBe(true);
  });
  it('detecta bordes abiertos en una cara suelta', () => {
    const r = checkManifold(quadMesh([0, 0, 0], [1, 0, 0], [0, 1, 0]));
    expect(r.watertight).toBe(false);
    expect(r.boundaryEdges).toBe(4);
  });
  it('detecta aristas compartidas por más de dos caras', () => {
    const a = boxMesh([0, 0, 0], [1, 1, 1]);
    const doubled = weldMesh(mergeMeshes([a, a]));
    expect(checkManifold(doubled).watertight).toBe(false);
  });
});

describe('weldMesh', () => {
  it('fusiona vértices duplicados y descarta triángulos degenerados', () => {
    const soup = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 5, 5, 5]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 6, 6]),
    };
    const welded = weldMesh(soup);
    expect(welded.positions.length / 3).toBe(5);
    expect(welded.indices.length / 3).toBe(2);
  });
});

describe('splitConnectedComponents', () => {
  it('separa cajas que no se tocan', () => {
    const merged = mergeMeshes([boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([5, 0, 0], [6, 1, 1])]);
    const parts = splitConnectedComponents(merged);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(checkManifold(p).watertight).toBe(true);
    const xs = parts.map((p) => meshBBox(p).min[0]).sort();
    expect(xs).toEqual([0, 5]);
  });
  it('devuelve la misma malla si es una sola pieza', () => {
    const box = boxMesh([0, 0, 0], [1, 1, 1]);
    expect(splitConnectedComponents(box)).toEqual([box]);
  });
});

describe('transformMesh', () => {
  it('traslada y escala', () => {
    const m = transformMesh(boxMesh([10, 10, 10], [12, 12, 12]), [10, 10, 10], 5);
    expect(meshBBox(m)).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
  });
});

describe('sampleBuilding', () => {
  it('genera un edificio con capas variadas', () => {
    const parts = sampleBuilding();
    expect(new Set(parts.map((p) => p.layer)).size).toBeGreaterThanOrEqual(5);
    expect(parts.every((p) => p.mesh.indices.length > 0)).toBe(true);
  });
});
