import { describe, expect, it } from 'vitest';
import { meshBBox, mergeMeshes } from './geometry/mesh';
import { boxMesh, sampleBuilding } from './geometry/primitives';
import {
  analyzeParts,
  buildParts,
  buildPrintMesh,
  EXCLUDED_LAYER_ID,
  EXCLUDED_LAYER_NAME,
  moveParts,
  regroup,
  visibleParts,
  yUpToZUp,
} from './model';
import type { ImportResult } from './types';

const sample = (): ImportResult => ({
  objects: sampleBuilding().map((p) => ({ name: p.name, layer: p.layer, mesh: p.mesh })),
  warnings: [],
});

describe('buildParts', () => {
  it('separa cada objeto en piezas conectadas', () => {
    const parts = buildParts(sample());
    // El muro sur son 7 tramos que se tocan: tras soldar, forman una sola pieza.
    expect(parts.filter((p) => p.sourceLayer === 'Mobiliario')).toHaveLength(3);
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
  });

  it('separa objetos con varias piezas sueltas y las numera', () => {
    const mesh = mergeMeshes([boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([3, 0, 0], [4, 1, 1])]);
    const parts = buildParts({ objects: [{ name: 'Sillas', layer: 'L', mesh }], warnings: [] });
    expect(parts.map((p) => p.name)).toEqual(['Sillas #1', 'Sillas #2']);
  });

  it('no separa si se supera el máximo de piezas', () => {
    const mesh = mergeMeshes([boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([3, 0, 0], [4, 1, 1])]);
    const parts = buildParts(
      { objects: [{ name: 'Sillas', layer: 'L', mesh }], warnings: [] },
      { maxParts: 1 },
    );
    expect(parts).toHaveLength(1);
  });

  it('gira los modelos con Y vertical', () => {
    const tall = boxMesh([0, 0, 0], [1, 10, 2]);
    expect(meshBBox(yUpToZUp(tall)).max[2]).toBe(10);
    const parts = buildParts(
      { objects: [{ name: 't', layer: 'L', mesh: tall }], warnings: [] },
      { yUp: true },
    );
    expect(parts[0].bbox.max[2]).toBe(10);
  });
});

describe('capas', () => {
  const parts = analyzeParts(buildParts(sample()), 'm');

  it('agrupa por capas del fichero', () => {
    const { layers } = regroup(parts, 'origen');
    expect(layers.map((l) => l.name)).toEqual([
      'Carpinteria',
      'Cubierta',
      'Forjados',
      'Interior',
      'Mobiliario',
      'Muros',
    ]);
    expect(layers.every((l) => l.visible)).toBe(true);
  });

  it('agrupa por exposición: el mobiliario queda como interior', () => {
    const grouped = regroup(parts, 'exposicion');
    const interior = grouped.layers.find((l) => l.name.startsWith('Interior'))!;
    const inside = grouped.parts.filter((p) => p.layerId === interior.id).map((p) => p.sourceLayer);
    expect(inside).toContain('Mobiliario');
    expect(inside).not.toContain('Muros');
    expect(inside).not.toContain('Cubierta');
  });

  it('conserva visibilidad y piezas excluidas al reagrupar', () => {
    const first = regroup(parts, 'origen');
    const hidden = first.layers.map((l) => (l.name === 'Muros' ? { ...l, visible: false } : l));
    const furniture = first.parts.filter((p) => p.sourceLayer === 'Mobiliario').map((p) => p.id);
    const moved = moveParts(first.parts, hidden, furniture, {
      id: EXCLUDED_LAYER_ID,
      name: EXCLUDED_LAYER_NAME,
    });
    expect(moved.layers.some((l) => l.name === 'Mobiliario')).toBe(false);
    const again = regroup(moved.parts, 'origen', moved.layers);
    expect(again.layers.find((l) => l.name === 'Muros')!.visible).toBe(false);
    const excluded = again.layers.find((l) => l.id === EXCLUDED_LAYER_ID)!;
    expect(excluded.visible).toBe(false);
    expect(again.parts.filter((p) => p.layerId === EXCLUDED_LAYER_ID)).toHaveLength(3);
    expect(visibleParts(again.parts, again.layers).some((p) => p.sourceLayer === 'Muros')).toBe(
      false,
    );
  });

  it('crea capas nuevas al mover piezas', () => {
    const first = regroup(parts, 'origen');
    const moved = moveParts(first.parts, first.layers, [first.parts[0].id], {
      id: 'layer:Nueva',
      name: 'Nueva',
    });
    expect(moved.layers.some((l) => l.name === 'Nueva')).toBe(true);
    expect(moved.parts[0].layerId).toBe('layer:Nueva');
  });
});

describe('buildPrintMesh', () => {
  it('escala a mm de impresión y coloca el origen en la esquina del modelo', () => {
    const { parts, layers } = regroup(buildParts(sample()), 'origen');
    const { mesh, size } = buildPrintMesh(parts, layers, 'm', 200);
    const bbox = meshBBox(mesh);
    expect(bbox.min[0]).toBeCloseTo(0);
    expect(bbox.min[2]).toBeCloseTo(0);
    // 12,8 m de ancho (con vuelo de cubierta) a 1:200 = 64 mm.
    expect(size[0]).toBeCloseTo(64);
    expect(bbox.max[0]).toBeCloseTo(64);
  });

  it('solo incluye capas visibles', () => {
    const { parts, layers } = regroup(buildParts(sample()), 'origen');
    const onlyWalls = layers.map((l) => ({ ...l, visible: l.name === 'Muros' }));
    const all = buildPrintMesh(parts, layers, 'm', 200).mesh.indices.length;
    const walls = buildPrintMesh(parts, onlyWalls, 'm', 200).mesh.indices.length;
    expect(walls).toBeGreaterThan(0);
    expect(walls).toBeLessThan(all);
    const none = buildPrintMesh(
      parts,
      layers.map((l) => ({ ...l, visible: false })),
      'm',
      200,
    );
    expect(none.mesh.indices.length).toBe(0);
    expect(none.size).toEqual([0, 0, 0]);
  });
});
