import { create } from 'zustand';
import { writeBinaryStl } from '../core/export/stl';
import { bboxSize } from '../core/geometry/mesh';
import { findSimilar, type GroupingStrategy } from '../core/layers/grouping';
import {
  analyzeParts,
  buildParts,
  buildPrintMesh,
  EXCLUDED_LAYER_ID,
  EXCLUDED_LAYER_NAME,
  layerIdFor,
  modelBBox,
  moveParts,
  regroup,
  yUpToZUp,
} from '../core/model';
import type { ImportResult, Layer, LengthUnit, Mesh, Part } from '../core/types';
import { guessUnit } from '../core/units';
import { DEFAULT_PREPARE_OPTIONS, type PrepareOptions } from '../core/voxel/pipeline';
import type { PrepareRequest, PrepareSuccess, WorkerMessage } from '../worker/protocol';

export type ClipAxis = 'none' | 'x' | 'y' | 'z';

export interface PrepareOutcome extends Omit<PrepareSuccess, 'type' | 'positions' | 'indices'> {
  mesh: Mesh;
}

export interface Printer {
  x: number;
  y: number;
  z: number;
}

interface State {
  fileName: string | null;
  parts: Part[];
  layers: Layer[];
  selection: string[];
  grouping: GroupingStrategy;
  unit: LengthUnit;
  scale: number;
  warnings: string[];
  error: string | null;
  clipAxis: ClipAxis;
  clipPosition: number;
  options: PrepareOptions;
  simplify: boolean;
  printer: Printer;
  busy: { stage: string; fraction: number } | null;
  result: PrepareOutcome | null;
  view: 'modelo' | 'resultado';

  loadImport: (fileName: string, result: ImportResult, yUp?: boolean) => void;
  setError: (message: string | null) => void;
  setGrouping: (strategy: GroupingStrategy) => void;
  toggleLayer: (id: string) => void;
  setAllVisible: (visible: boolean) => void;
  soloLayer: (id: string) => void;
  select: (ids: string[], additive?: boolean) => void;
  selectLayer: (id: string) => void;
  selectSimilar: () => void;
  excludeSelection: () => void;
  moveSelectionTo: (layerName: string) => void;
  rotateUp: () => void;
  setUnit: (unit: LengthUnit) => void;
  setScale: (scale: number) => void;
  setClip: (axis: ClipAxis, position?: number) => void;
  setOptions: (patch: Partial<PrepareOptions>) => void;
  setSimplify: (value: boolean) => void;
  setPrinter: (patch: Partial<Printer>) => void;
  setView: (view: 'modelo' | 'resultado') => void;
  prepare: () => void;
  downloadStl: () => void;
}

let worker: Worker | null = null;

export const useStore = create<State>((set, get) => ({
  fileName: null,
  parts: [],
  layers: [],
  selection: [],
  grouping: 'origen',
  unit: 'm',
  scale: 200,
  warnings: [],
  error: null,
  clipAxis: 'none',
  clipPosition: 0.5,
  options: DEFAULT_PREPARE_OPTIONS,
  simplify: true,
  printer: { x: 256, y: 256, z: 256 },
  busy: null,
  result: null,
  view: 'modelo',

  loadImport: (fileName, result, yUp = false) => {
    const built = buildParts(result, { yUp });
    if (built.length === 0) {
      set({ error: result.warnings.join(' ') || 'El fichero no contiene geometría 3D.' });
      return;
    }
    const unit = result.unitHint ?? guessUnit(bboxSize(modelBBox(built)));
    const analyzed = analyzeParts(built, unit);
    const { parts, layers } = regroup(analyzed, 'origen');
    set({
      fileName,
      parts,
      layers,
      unit,
      grouping: 'origen',
      selection: [],
      warnings: result.warnings,
      error: null,
      result: null,
      view: 'modelo',
      clipAxis: 'none',
    });
  },

  setError: (error) => set({ error }),

  setGrouping: (grouping) => {
    const { parts, layers } = regroup(get().parts, grouping, get().layers);
    set({ grouping, parts, layers });
  },

  toggleLayer: (id) =>
    set({ layers: get().layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) }),

  setAllVisible: (visible) =>
    set({
      layers: get().layers.map((l) => ({
        ...l,
        visible: l.id === EXCLUDED_LAYER_ID ? false : visible,
      })),
    }),

  soloLayer: (id) => set({ layers: get().layers.map((l) => ({ ...l, visible: l.id === id })) }),

  select: (ids, additive = false) => {
    if (!additive) return set({ selection: ids });
    const current = new Set(get().selection);
    for (const id of ids) {
      if (current.has(id)) current.delete(id);
      else current.add(id);
    }
    set({ selection: [...current] });
  },

  selectLayer: (id) =>
    set({
      selection: get()
        .parts.filter((p) => p.layerId === id)
        .map((p) => p.id),
    }),

  selectSimilar: () => {
    const { parts, selection } = get();
    const found = new Set(selection);
    for (const id of selection) {
      const reference = parts.find((p) => p.id === id);
      if (reference) for (const similar of findSimilar(reference, parts)) found.add(similar);
    }
    set({ selection: [...found] });
  },

  excludeSelection: () => {
    const { parts, layers, selection } = get();
    set({
      ...moveParts(parts, layers, selection, { id: EXCLUDED_LAYER_ID, name: EXCLUDED_LAYER_NAME }),
      selection: [],
    });
  },

  moveSelectionTo: (layerName) => {
    const name = layerName.trim();
    if (!name) return;
    const { parts, layers, selection } = get();
    set(moveParts(parts, layers, selection, { id: layerIdFor(name), name }));
  },

  rotateUp: () => {
    const { parts, unit, grouping, layers } = get();
    const rotated = buildPartsRotated(parts);
    const analyzed = analyzeParts(rotated, unit);
    set({ ...regroup(analyzed, grouping, layers), result: null, view: 'modelo' });
  },

  setUnit: (unit) => {
    const { parts, grouping, layers } = get();
    set({ unit, ...regroup(analyzeParts(parts, unit), grouping, layers) });
  },

  setScale: (scale) => {
    if (scale > 0) set({ scale });
  },

  setClip: (clipAxis, clipPosition) =>
    set({ clipAxis, clipPosition: clipPosition ?? get().clipPosition }),

  setOptions: (patch) => set({ options: { ...get().options, ...patch } }),
  setSimplify: (simplify) => set({ simplify }),
  setPrinter: (patch) => set({ printer: { ...get().printer, ...patch } }),
  setView: (view) => set({ view }),

  prepare: () => {
    const { parts, layers, unit, scale, options, simplify } = get();
    const { mesh } = buildPrintMesh(parts, layers, unit, scale);
    if (mesh.indices.length === 0) {
      set({ error: 'No hay ninguna capa visible que preparar.' });
      return;
    }
    worker?.terminate();
    worker = new Worker(new URL('../worker/prepare.worker.ts', import.meta.url), {
      type: 'module',
    });
    set({ busy: { stage: 'Iniciando', fraction: 0 }, error: null });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        set({ busy: { stage: message.stage, fraction: message.fraction } });
      } else if (message.type === 'done') {
        const { positions, indices, warnings, voxelSize, size, volume, report } = message;
        const result = { warnings, voxelSize, size, volume, report, mesh: { positions, indices } };
        set({ busy: null, result, view: 'resultado' });
      } else {
        set({ busy: null, error: message.message });
      }
    };
    worker.onerror = (event) =>
      set({ busy: null, error: event.message || 'Error en el procesado.' });
    const request: PrepareRequest = {
      positions: mesh.positions,
      indices: mesh.indices,
      options,
      simplifyError: simplify ? 0.03 : 0,
    };
    worker.postMessage(request, [mesh.positions.buffer]);
  },

  downloadStl: () => {
    const { result, fileName, scale } = get();
    if (!result) return;
    const base = (fileName ?? 'maqueta').replace(/\.[^.]+$/, '');
    const blob = new Blob([writeBinaryStl(result.mesh)], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${base}_1-${scale}.stl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
}));

function buildPartsRotated(parts: Part[]): Part[] {
  const rotated = buildParts(
    {
      objects: parts.map((p) => ({
        name: p.name,
        layer: p.sourceLayer,
        material: p.material,
        mesh: yUpToZUp(p.mesh),
      })),
      warnings: [],
    },
    { split: false },
  );
  // Conserva identificadores y capa actual (incluidas las piezas excluidas).
  return rotated.map((p, i) => ({ ...p, id: parts[i].id, layerId: parts[i].layerId }));
}
