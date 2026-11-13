import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Layer, Mesh, Part } from '../core/types';

export interface SceneCallbacks {
  onPick: (partId: string | null, additive: boolean) => void;
}

const SELECT_COLOR = new THREE.Color('#ffd400');

function toGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Visor three.js imperativo: React solo le pasa el estado que debe mostrarse. */
export class SceneView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private resultGroup = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private partsRef: Part[] = [];
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private frame = 0;
  private needsRender = true;
  private resizeObserver: ResizeObserver;
  private downAt: [number, number] | null = null;
  private fittedTo: object | null = null;

  constructor(
    private container: HTMLElement,
    private callbacks: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor('#1b1f27');
    container.appendChild(this.renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#3a3f4b', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(1, -2, 3);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#ffffff', 0.6);
    fill.position.set(-2, 1, 1);
    this.scene.add(fill);
    this.resultGroup.visible = false;
    this.scene.add(this.modelGroup, this.resultGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => (this.needsRender = true));

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => (this.downAt = [e.clientX, e.clientY]));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]);
      this.downAt = null;
      if (moved < 4 && e.button === 0) this.pick(e);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.resultGroup);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
      group.remove(child);
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Sincroniza las piezas del modelo. Reutiliza las geometrías cuyo `mesh` no ha cambiado. */
  setParts(parts: Part[]): void {
    const keep = new Set(parts.map((p) => p.id));
    for (const [id, mesh] of this.meshes) {
      if (!keep.has(id) || mesh.userData.source !== parts.find((p) => p.id === id)?.mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.modelGroup.remove(mesh);
        this.meshes.delete(id);
      }
    }
    for (const part of parts) {
      if (this.meshes.has(part.id)) continue;
      const material = new THREE.MeshStandardMaterial({
        flatShading: true,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0,
        clippingPlanes: [],
      });
      const mesh = new THREE.Mesh(toGeometry(part.mesh), material);
      mesh.userData.partId = part.id;
      mesh.userData.source = part.mesh;
      this.meshes.set(part.id, mesh);
      this.modelGroup.add(mesh);
    }
    const first = parts[0]?.mesh ?? null;
    if (this.partsRef.length === 0 || this.fittedTo !== first) {
      this.fittedTo = first;
      if (parts.length) this.fit(this.modelGroup);
    }
    this.partsRef = parts;
    this.needsRender = true;
  }

  setAppearance(parts: Part[], layers: Layer[], selection: string[]): void {
    const layerById = new Map(layers.map((l) => [l.id, l]));
    const selected = new Set(selection);
    for (const part of parts) {
      const mesh = this.meshes.get(part.id);
      if (!mesh) continue;
      const layer = layerById.get(part.layerId);
      mesh.visible = layer?.visible ?? false;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const glass = part.kind === 'vidrio';
      material.color.set(layer?.color ?? '#888888');
      material.transparent = glass;
      material.opacity = glass ? 0.45 : 1;
      material.depthWrite = !glass;
      if (selected.has(part.id)) {
        material.emissive.copy(SELECT_COLOR);
        material.emissiveIntensity = 0.55;
      } else {
        material.emissiveIntensity = 0;
      }
    }
    this.needsRender = true;
  }

  setResult(mesh: Mesh | null): void {
    this.clearGroup(this.resultGroup);
    if (mesh && mesh.indices.length) {
      const material = new THREE.MeshStandardMaterial({
        color: '#d9d4c7',
        flatShading: true,
        roughness: 0.9,
        side: THREE.DoubleSide,
        clippingPlanes: [],
      });
      this.resultGroup.add(new THREE.Mesh(toGeometry(mesh), material));
      if (this.resultGroup.visible) this.fit(this.resultGroup);
    }
    this.needsRender = true;
  }

  setView(view: 'modelo' | 'resultado'): void {
    const showResult = view === 'resultado' && this.resultGroup.children.length > 0;
    if (this.resultGroup.visible !== showResult) {
      this.modelGroup.visible = !showResult;
      this.resultGroup.visible = showResult;
      this.fit(showResult ? this.resultGroup : this.modelGroup);
    }
    this.needsRender = true;
  }

  private activeGroup(): THREE.Group {
    return this.resultGroup.visible ? this.resultGroup : this.modelGroup;
  }

  /** Plano de corte para ver el interior. `position` va de 0 a 1 a lo largo del eje. */
  setClip(axis: 'none' | 'x' | 'y' | 'z', position: number): void {
    const group = this.activeGroup();
    const planes: THREE.Plane[] = [];
    if (axis !== 'none' && group.children.length) {
      const box = new THREE.Box3().setFromObject(group);
      const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const value =
        box.min.getComponent(i) + (box.max.getComponent(i) - box.min.getComponent(i)) * position;
      // Se conserva la mitad más alejada de la cámara por defecto, para que el corte se vea.
      const sign = axis === 'y' ? 1 : -1;
      const normal = new THREE.Vector3();
      normal.setComponent(i, sign);
      this.clipPlane.set(normal, -sign * value);
      planes.push(this.clipPlane);
    }
    for (const g of [this.modelGroup, this.resultGroup]) {
      for (const child of g.children) {
        ((child as THREE.Mesh).material as THREE.Material).clippingPlanes = planes;
      }
    }
    this.needsRender = true;
  }

  fit(group: THREE.Object3D = this.activeGroup()): void {
    const box = new THREE.Box3();
    for (const child of group.children) {
      const geometry = (child as THREE.Mesh).geometry;
      if (geometry?.boundingBox) box.union(geometry.boundingBox);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    const direction = new THREE.Vector3(0.8, -1, 0.7).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.1);
    this.camera.near = radius / 500;
    this.camera.far = radius * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.needsRender = true;
  }

  private pick(event: PointerEvent): void {
    if (!this.modelGroup.visible) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const visible = this.modelGroup.children.filter((c) => c.visible);
    const hits = raycaster.intersectObjects(visible, false);
    const clip = ((visible[0] as THREE.Mesh | undefined)?.material as THREE.Material | undefined)
      ?.clippingPlanes;
    const hit = hits.find((h) => !clip?.some((plane) => plane.distanceToPoint(h.point) < 0));
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    this.callbacks.onPick(hit ? (hit.object.userData.partId as string) : null, additive);
  }
}
