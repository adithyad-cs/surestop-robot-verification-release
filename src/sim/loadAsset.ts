import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetSpec } from "./assets";

const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Loads a glTF asset, strips embedded lights/cameras, scales it to spec.height,
 * centres it on the XZ origin and puts its lowest point on y = 0.
 * Returns a fresh clone each call (geometry/materials are shared).
 */
export async function loadAsset(spec: AssetSpec): Promise<THREE.Object3D> {
  let base = cache.get(spec.url);
  if (!base) {
    base = new GLTFLoader().loadAsync(spec.url).then((gltf) => normalise(gltf.scene, spec));
    cache.set(spec.url, base);
  }
  const obj = (await base).clone(true);
  return obj;
}

function normalise(scene: THREE.Object3D, spec: AssetSpec): THREE.Object3D {
  const strip: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) strip.push(o);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  strip.forEach((o) => o.removeFromParent());

  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = spec.height / Math.max(size.y, 1e-6);
  scene.scale.multiplyScalar(s);
  scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene);
  const c = box2.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= box2.min.y;
  if (spec.yaw) wrapper.rotation.y = spec.yaw;
  wrapper.name = `asset:${spec.id}`;
  return wrapper;
}
