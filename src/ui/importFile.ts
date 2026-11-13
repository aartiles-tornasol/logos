import type { BufferGeometry, Mesh as ThreeMesh, Object3D } from 'three';
import { fileExtension, importModel } from '../core/import';
import type { ImportedObject, ImportResult } from '../core/types';

export const ACCEPTED_EXTENSIONS = '.obj,.dxf,.stl,.glb,.gltf,.fbx,.dgn';

export interface LoadedFile {
  result: ImportResult;
  /** El formato usa Y como eje vertical y hay que girarlo. */
  yUp: boolean;
}

function fromThreeScene(root: Object3D): ImportResult {
  const objects: ImportedObject[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as ThreeMesh;
    if (!mesh.isMesh) return;
    const geometry = (mesh.geometry as BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
    const position = geometry.getAttribute('position');
    if (!position) return;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      positions[i * 3] = position.getX(i);
      positions[i * 3 + 1] = position.getY(i);
      positions[i * 3 + 2] = position.getZ(i);
    }
    const index = geometry.getIndex();
    const indices = new Uint32Array(index ? index.count : position.count);
    for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = mesh.name || mesh.parent?.name || 'objeto';
    objects.push({
      name,
      layer: mesh.parent?.name || material?.name || name,
      material: material?.name || undefined,
      mesh: { positions, indices: indices.subarray(0, indices.length - (indices.length % 3)) },
    });
    geometry.dispose();
  });
  return { objects, warnings: objects.length ? [] : ['El fichero no contiene mallas.'] };
}

/** Lee un fichero del usuario. glTF y FBX se cargan bajo demanda con los lectores de three.js. */
export async function loadFile(file: File): Promise<LoadedFile> {
  const data = await file.arrayBuffer();
  const ext = fileExtension(file.name);
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(data, '');
    return { result: fromThreeScene(gltf.scene), yUp: true };
  }
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    return { result: fromThreeScene(new FBXLoader().parse(data, '')), yUp: true };
  }
  return { result: importModel(file.name, data), yUp: false };
}
