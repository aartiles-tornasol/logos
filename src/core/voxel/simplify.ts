import { MeshoptSimplifier } from 'meshoptimizer';
import { checkManifold } from '../geometry/mesh';
import type { Mesh } from '../types';

/**
 * Reduce el número de triángulos manteniendo la topología (la malla sigue siendo estanca).
 * `maxError` es la desviación máxima permitida, en las mismas unidades que la malla.
 */
export async function simplifyMesh(mesh: Mesh, maxError: number): Promise<Mesh> {
  if (mesh.indices.length === 0 || maxError <= 0) return mesh;
  await MeshoptSimplifier.ready;
  const [simplified] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, 0, maxError, [
    'ErrorAbsolute',
  ]);
  const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
  const positions = new Float32Array(unique * 3);
  for (let v = 0; v < remap.length; v++) {
    const target = remap[v];
    if (target === 0xffffffff) continue;
    positions[target * 3] = mesh.positions[v * 3];
    positions[target * 3 + 1] = mesh.positions[v * 3 + 1];
    positions[target * 3 + 2] = mesh.positions[v * 3 + 2];
  }
  return { positions, indices: simplified };
}

/**
 * Simplifica sin romper la malla: si el resultado deja de ser estanco (puede ocurrir al
 * colapsar elementos muy finos), reintenta con menos tolerancia. Devuelve la malla original
 * si ningún intento conserva la estanqueidad.
 */
export async function simplifyWatertight(
  mesh: Mesh,
  maxError: number,
  attempts = 4,
): Promise<Mesh> {
  let error = maxError;
  for (let i = 0; i < attempts; i++) {
    const simplified = await simplifyMesh(mesh, error);
    if (checkManifold(simplified).watertight) return simplified;
    error /= 2.5;
  }
  return mesh;
}
