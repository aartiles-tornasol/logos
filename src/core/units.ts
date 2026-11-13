import type { LengthUnit, Vec3 } from './types';
import { UNIT_TO_MM } from './types';

/**
 * Adivina la unidad del modelo suponiendo que es un edificio (entre ~3 m y ~300 m).
 * MicroStation suele trabajar en metros o milímetros, pero el fichero exportado no lo dice.
 */
export function guessUnit(size: Vec3): LengthUnit {
  const maxDim = Math.max(size[0], size[1], size[2]);
  const candidates: LengthUnit[] = ['m', 'mm', 'cm', 'ft', 'in'];
  for (const unit of candidates) {
    const meters = (maxDim * UNIT_TO_MM[unit]) / 1000;
    if (meters >= 3 && meters <= 300) return unit;
  }
  return 'm';
}

/** Factor que convierte unidades del modelo en milímetros impresos a escala 1:`scale`. */
export function printScaleFactor(unit: LengthUnit, scale: number): number {
  return UNIT_TO_MM[unit] / scale;
}
