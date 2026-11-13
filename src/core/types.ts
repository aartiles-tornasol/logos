/** Tipos de dominio compartidos por todo el núcleo. Sin dependencias de DOM ni de three.js. */

export type Vec3 = [number, number, number];

/** Malla triangular indexada. `positions` son ternas xyz; `indices` son ternas de vértices. */
export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Tipo de elemento constructivo sugerido por las heurísticas. */
export type PartKind = 'muro' | 'forjado' | 'cubierta' | 'detalle' | 'vidrio' | 'otros';

/** Una pieza del modelo: la unidad mínima que el usuario puede seleccionar y mover de capa. */
export interface Part {
  id: string;
  name: string;
  /** Nombre de la capa/nivel/grupo tal como venía en el fichero. */
  sourceLayer: string;
  /** Material o color de origen, si el fichero lo trae. */
  material?: string;
  layerId: string;
  mesh: Mesh;
  bbox: BBox;
  kind?: PartKind;
  /** Fracción (0–1) de la pieza visible desde el exterior; indefinido si no se ha calculado. */
  exposure?: number;
}

export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface ImportedObject {
  name: string;
  layer: string;
  material?: string;
  mesh: Mesh;
}

export interface ImportResult {
  objects: ImportedObject[];
  warnings: string[];
  /** Unidad declarada en el fichero, si la hay. */
  unitHint?: LengthUnit;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const UNIT_TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};
