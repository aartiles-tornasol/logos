import type { Mesh, Vec3 } from '../types';
import { mergeMeshes } from './mesh';

/** Caja estanca alineada con los ejes, con normales hacia fuera. Útil para tests y ejemplos. */
export function boxMesh(min: Vec3, max: Vec3): Mesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // prettier-ignore
  const positions = new Float32Array([
    x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0,
    x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1,
  ]);
  // prettier-ignore
  const indices = new Uint32Array([
    0, 2, 1,  0, 3, 2, // abajo
    4, 5, 6,  4, 6, 7, // arriba
    0, 1, 5,  0, 5, 4, // frente
    1, 2, 6,  1, 6, 5, // derecha
    2, 3, 7,  2, 7, 6, // fondo
    3, 0, 4,  3, 4, 7, // izquierda
  ]);
  return { positions, indices };
}

/** Rectángulo plano (una sola cara, sin grosor) definido por un origen y dos lados. */
export function quadMesh(origin: Vec3, u: Vec3, v: Vec3): Mesh {
  const [ox, oy, oz] = origin;
  // prettier-ignore
  const positions = new Float32Array([
    ox, oy, oz,
    ox + u[0], oy + u[1], oz + u[2],
    ox + u[0] + v[0], oy + u[1] + v[1], oz + u[2] + v[2],
    ox + v[0], oy + v[1], oz + v[2],
  ]);
  return { positions, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}

export interface SampleBuildingPart {
  name: string;
  layer: string;
  mesh: Mesh;
}

/**
 * Edificio sintético de ejemplo, en metros: dos plantas, muros de 20 cm, forjado intermedio,
 * cubierta, vidrios de una sola cara, mobiliario interior y un peto fino. Reproduce los
 * problemas típicos de un modelo de arquitectura que no está pensado para imprimirse.
 */
export function sampleBuilding(): SampleBuildingPart[] {
  const W = 12;
  const D = 8;
  const H = 6;
  const t = 0.2;
  const parts: SampleBuildingPart[] = [];
  const add = (name: string, layer: string, ...meshes: Mesh[]) =>
    parts.push({ name, layer, mesh: mergeMeshes(meshes) });

  // Muro sur con dos huecos de ventana (por tramos alrededor de los huecos).
  add(
    'Muro sur',
    'Muros',
    boxMesh([0, 0, 0], [2, t, H]),
    boxMesh([4, 0, 0], [8, t, H]),
    boxMesh([10, 0, 0], [W, t, H]),
    boxMesh([2, 0, 0], [4, t, 1]),
    boxMesh([2, 0, 2.5], [4, t, H]),
    boxMesh([8, 0, 0], [10, t, 1]),
    boxMesh([8, 0, 2.5], [10, t, H]),
  );
  add('Muro norte', 'Muros', boxMesh([0, D - t, 0], [W, D, H]));
  add('Muro oeste', 'Muros', boxMesh([0, t, 0], [t, D - t, H]));
  add('Muro este', 'Muros', boxMesh([W - t, t, 0], [W, D - t, H]));
  add('Solera', 'Forjados', boxMesh([0, 0, -0.3], [W, D, 0]));
  add('Forjado P1', 'Forjados', boxMesh([t, t, 2.8], [W - t, D - t, 3.1]));
  add('Cubierta', 'Cubierta', boxMesh([-0.4, -0.4, H], [W + 0.4, D + 0.4, H + 0.3]));
  // Peto: una sola cara sin grosor (caso típico de superficie suelta).
  add('Peto', 'Cubierta', quadMesh([0, 0, H + 0.3], [W, 0, 0], [0, 0, 0.6]));
  add('Vidrio 1', 'Carpinteria', quadMesh([2, t / 2, 1], [2, 0, 0], [0, 0, 1.5]));
  add('Vidrio 2', 'Carpinteria', quadMesh([8, t / 2, 1], [2, 0, 0], [0, 0, 1.5]));
  add('Tabique', 'Interior', boxMesh([6, t, 0], [6.1, D - t, 2.8]));
  add('Mesa', 'Mobiliario', boxMesh([2, 3, 0], [3.6, 4, 0.75]));
  add('Armario', 'Mobiliario', boxMesh([9, 6, 0], [10.5, 6.6, 2]));
  add('Silla', 'Mobiliario', boxMesh([3.8, 3.2, 0], [4.3, 3.7, 0.9]));
  return parts;
}
