/// <reference lib="webworker" />
import { bboxSize, checkManifold, meshBBox, meshStats } from '../core/geometry/mesh';
import { prepareForPrint } from '../core/voxel/pipeline';
import { simplifyWatertight } from '../core/voxel/simplify';
import type { PrepareRequest, WorkerMessage } from './protocol';

const post = (message: WorkerMessage, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<PrepareRequest>) => {
  const { positions, indices, options, simplifyError } = event.data;
  try {
    const result = prepareForPrint({ positions, indices }, options, (stage, fraction) =>
      post({ type: 'progress', stage, fraction: fraction * 0.9 }),
    );
    let mesh = result.mesh;
    const warnings = result.warnings;
    if (simplifyError > 0 && mesh.indices.length > 0) {
      post({ type: 'progress', stage: 'Simplificando malla', fraction: 0.92 });
      mesh = await simplifyWatertight(mesh, simplifyError);
    }
    post({ type: 'progress', stage: 'Comprobando malla', fraction: 0.97 });
    const report = checkManifold(mesh);
    const size = mesh.indices.length
      ? bboxSize(meshBBox(mesh))
      : ([0, 0, 0] as [number, number, number]);
    post(
      {
        type: 'done',
        positions: mesh.positions,
        indices: mesh.indices,
        warnings,
        voxelSize: result.voxelSize,
        size,
        volume: meshStats(mesh).volume,
        report,
      },
      [mesh.positions.buffer, mesh.indices.buffer],
    );
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
