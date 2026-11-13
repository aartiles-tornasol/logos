import { describe, expect, it } from 'vitest';
import {
  bboxSize,
  checkManifold,
  mergeMeshes,
  meshBBox,
  meshStats,
  transformMesh,
} from '../geometry/mesh';
import { boxMesh, quadMesh, sampleBuilding } from '../geometry/primitives';
import type { Mesh } from '../types';
import {
  chooseVoxelSize,
  DEFAULT_PREPARE_OPTIONS,
  prepareForPrint,
  type PrepareOptions,
} from './pipeline';
import { simplifyMesh, simplifyWatertight } from './simplify';

const opts = (o: Partial<PrepareOptions> = {}): PrepareOptions => ({
  ...DEFAULT_PREPARE_OPTIONS,
  voxelSize: 0.3,
  ...o,
});

/** Caja hueca de paredes finas (dos caras por pared), abierta o no por abajo. */
function hollowBox(size: [number, number, number], wall: number): Mesh {
  const [x, y, z] = size;
  return mergeMeshes([
    boxMesh([0, 0, 0], [x, wall, z]),
    boxMesh([0, y - wall, 0], [x, y, z]),
    boxMesh([0, 0, 0], [wall, y, z]),
    boxMesh([x - wall, 0, 0], [x, y, z]),
    boxMesh([0, 0, z - wall], [x, y, z]),
  ]);
}

describe('chooseVoxelSize', () => {
  it('respeta el tamaño pedido si cabe', () => {
    expect(chooseVoxelSize([20, 20, 20], 0.4, 1.2, 20e6)).toBe(0.4);
  });
  it('aumenta el vóxel para no superar el límite', () => {
    const h = chooseVoxelSize([400, 300, 200], 0.2, 1.2, 5e6);
    expect(h).toBeGreaterThan(0.2);
    const n = Math.ceil(400 / h) * Math.ceil(300 / h) * Math.ceil(200 / h);
    expect(n).toBeLessThan(5e6);
  });
});

describe('prepareForPrint', () => {
  it('reproduce un bloque macizo con dimensiones y volumen correctos', () => {
    const result = prepareForPrint(boxMesh([0, 0, 0], [20, 12, 8]), opts());
    expect(checkManifold(result.mesh).watertight).toBe(true);
    const size = bboxSize(meshBBox(result.mesh));
    expect(size[0]).toBeGreaterThan(19.4);
    expect(size[0]).toBeLessThan(20.7);
    expect(size[1]).toBeGreaterThan(11.4);
    expect(size[1]).toBeLessThan(12.7);
    expect(size[2]).toBeGreaterThan(7.4);
    expect(size[2]).toBeLessThan(8.5);
    const volume = meshStats(result.mesh).volume;
    expect(Math.abs(volume - 1920) / 1920).toBeLessThan(0.1);
    expect(result.warnings).toEqual([]);
  });

  it('macizo: rellena un edificio hueco y abierto por abajo', () => {
    const result = prepareForPrint(hollowBox([20, 16, 10], 0.5), opts({ mode: 'macizo' }));
    expect(checkManifold(result.mesh).watertight).toBe(true);
    const volume = meshStats(result.mesh).volume;
    expect(Math.abs(volume - 3200) / 3200).toBeLessThan(0.1);
  });

  it('cáscara: deja solo la envolvente con el grosor mínimo', () => {
    const wall = 1.2;
    const result = prepareForPrint(
      hollowBox([20, 16, 10], 0.5),
      opts({ mode: 'cascara', minWall: wall }),
    );
    expect(checkManifold(result.mesh).watertight).toBe(true);
    const volume = meshStats(result.mesh).volume;
    const expected = 20 * 16 * 10 - (20 - 2 * wall) * (16 - 2 * wall) * (10 - wall);
    expect(volume).toBeGreaterThan(expected * 0.75);
    expect(volume).toBeLessThan(expected * 1.3);
  });

  it('engrosa una cara suelta hasta el grosor mínimo', () => {
    // Pantalla vertical de 20 x 10 mm sin grosor.
    const sheet = quadMesh([0, 0, 0], [20, 0, 0], [0, 0, 10]);
    const result = prepareForPrint(sheet, opts({ minWall: 1.2 }));
    expect(checkManifold(result.mesh).watertight).toBe(true);
    const size = bboxSize(meshBBox(result.mesh));
    expect(size[1]).toBeGreaterThan(0.9);
    expect(size[1]).toBeLessThan(1.9);
    expect(size[0]).toBeGreaterThan(19.5);
    expect(size[2]).toBeGreaterThan(9.5);
  });

  it('engrosa una pared demasiado fina sin pasarse', () => {
    const thin = boxMesh([0, 0, 0], [20, 0.6, 10]);
    const result = prepareForPrint(thin, opts({ minWall: 1.5 }));
    const size = bboxSize(meshBBox(result.mesh));
    expect(size[1]).toBeGreaterThan(1.2);
    expect(size[1]).toBeLessThan(2.2);
  });

  it('no engorda las paredes que ya cumplen el mínimo', () => {
    const thick = boxMesh([0, 0, 0], [20, 3, 10]);
    const result = prepareForPrint(thick, opts({ minWall: 1.2 }));
    const size = bboxSize(meshBBox(result.mesh));
    expect(size[1]).toBeGreaterThan(2.5);
    expect(size[1]).toBeLessThan(3.6);
  });

  it('interiores: conserva la estancia cerrada como hueco', () => {
    const closed = mergeMeshes([hollowBox([20, 16, 10], 1.5), boxMesh([0, 0, 0], [20, 16, 1.5])]);
    const solid = prepareForPrint(closed, opts({ mode: 'macizo' }));
    const rooms = prepareForPrint(closed, opts({ mode: 'interiores' }));
    expect(checkManifold(rooms.mesh).watertight).toBe(true);
    const vSolid = meshStats(solid.mesh).volume;
    const vRooms = meshStats(rooms.mesh).volume;
    const cavity = 17 * 13 * 7;
    expect(Math.abs(vSolid - vRooms - cavity) / cavity).toBeLessThan(0.2);
  });

  it('cierra huecos de ventana más estrechos que closeGaps', () => {
    // Caja con un hueco de 3 mm en una pared.
    const withHole = mergeMeshes([
      boxMesh([0, 0, 0], [8.5, 0.6, 10]),
      boxMesh([11.5, 0, 0], [20, 0.6, 10]),
      boxMesh([0, 15.4, 0], [20, 16, 10]),
      boxMesh([0, 0, 0], [0.6, 16, 10]),
      boxMesh([19.4, 0, 0], [20, 16, 10]),
      boxMesh([0, 0, 9.4], [20, 16, 10]),
    ]);
    const leaky = prepareForPrint(withHole, opts({ closeGaps: 0 }));
    const closed = prepareForPrint(withHole, opts({ closeGaps: 4 }));
    const vLeaky = meshStats(leaky.mesh).volume;
    const vClosed = meshStats(closed.mesh).volume;
    expect(vLeaky).toBeLessThan(1500);
    expect(Math.abs(vClosed - 3200) / 3200).toBeLessThan(0.12);
  });

  it('avisa cuando tiene que reducir la resolución', () => {
    const result = prepareForPrint(boxMesh([0, 0, 0], [50, 50, 50]), opts({ maxVoxels: 200_000 }));
    expect(result.voxelSize).toBeGreaterThan(0.3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('falla con un mensaje claro si no hay geometría', () => {
    const empty = { positions: new Float32Array(), indices: new Uint32Array() };
    expect(() => prepareForPrint(empty, opts())).toThrow(/geometría/);
  });

  it('prepara el edificio de ejemplo a 1:200 en los tres modos', () => {
    const building = mergeMeshes(sampleBuilding().map((p) => p.mesh));
    const scaled = transformMesh(building, meshBBox(building).min, 1000 / 200);
    for (const mode of ['macizo', 'cascara', 'interiores'] as const) {
      const result = prepareForPrint(scaled, opts({ mode, voxelSize: 0.4 }));
      expect(checkManifold(result.mesh).watertight, mode).toBe(true);
      expect(meshStats(result.mesh).volume, mode).toBeGreaterThan(0);
      const size = bboxSize(meshBBox(result.mesh));
      expect(size[0], mode).toBeGreaterThan(60);
      expect(size[0], mode).toBeLessThan(66);
    }
  });
});

describe('simplifyMesh', () => {
  it('reduce triángulos manteniendo la malla estanca y el volumen', async () => {
    const result = prepareForPrint(boxMesh([0, 0, 0], [20, 12, 8]), opts());
    const simplified = await simplifyMesh(result.mesh, 0.05);
    expect(simplified.indices.length).toBeLessThan(result.mesh.indices.length * 0.5);
    expect(checkManifold(simplified).watertight).toBe(true);
    const v0 = meshStats(result.mesh).volume;
    const v1 = meshStats(simplified).volume;
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(0.02);
  });

  it('simplifyWatertight nunca devuelve una malla abierta', async () => {
    const building = mergeMeshes(sampleBuilding().map((p) => p.mesh));
    const scaled = transformMesh(building, meshBBox(building).min, 5);
    const result = prepareForPrint(scaled, opts({ voxelSize: 0.4 }));
    const simplified = await simplifyWatertight(result.mesh, 0.03);
    expect(checkManifold(simplified).watertight).toBe(true);
    expect(simplified.indices.length).toBeLessThan(result.mesh.indices.length);
  });
});
