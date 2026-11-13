import type { ManifoldReport } from '../core/geometry/mesh';
import type { PrepareOptions } from '../core/voxel/pipeline';

export interface PrepareRequest {
  positions: Float32Array;
  indices: Uint32Array;
  options: PrepareOptions;
  /** Desviación máxima (mm) al simplificar la malla; 0 para no simplificar. */
  simplifyError: number;
}

export interface PrepareSuccess {
  type: 'done';
  positions: Float32Array;
  indices: Uint32Array;
  warnings: string[];
  voxelSize: number;
  size: [number, number, number];
  volume: number;
  report: ManifoldReport;
}

export type WorkerMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | PrepareSuccess
  | { type: 'error'; message: string };
