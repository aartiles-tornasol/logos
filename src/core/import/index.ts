import type { ImportResult } from '../types';
import { parseDxf } from './dxf';
import { parseObj } from './obj';
import { parseStl } from './stl';

/** Formatos que el núcleo lee sin dependencias externas. */
export const CORE_EXTENSIONS = ['stl', 'obj', 'dxf'] as const;

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** Importa un fichero por su extensión. Lanza un error descriptivo si no está soportado. */
export function importModel(fileName: string, data: ArrayBuffer): ImportResult {
  const ext = fileExtension(fileName);
  switch (ext) {
    case 'stl':
      return parseStl(data, baseName(fileName));
    case 'obj':
      return parseObj(new TextDecoder().decode(data));
    case 'dxf':
      return parseDxf(new TextDecoder().decode(data));
    case 'dgn':
      throw new Error(
        'El formato DGN es propietario y no se puede leer directamente. ' +
          'En MicroStation usa Archivo > Exportar y elige OBJ, DXF o STL.',
      );
    default:
      throw new Error(`Formato .${ext || '?'} no soportado. Usa OBJ, DXF, STL, glTF/GLB o FBX.`);
  }
}
