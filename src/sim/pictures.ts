import * as THREE from "three";
import type { AssetSpec } from "./assets";
import { loadAsset } from "./loadAsset";
import { addLighting } from "./props";
import { makeRobotCamera, ROBOT_CAMERA, type SensorRenderer } from "./sensorRenderer";

/**
 * Renders an asset in a neutral studio and returns the image as a texture, cropped to
 * the given aspect ratio. Used for the picture shown by poster and display decoys.
 */
export async function studioPicture(sensor: SensorRenderer, spec: AssetSpec, aspect: number): Promise<THREE.CanvasTexture> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdedbd5);
  const obj = await loadAsset(spec);
  scene.add(obj);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  addLighting(scene, { intensity: 1.1 });
  const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
  const cam = makeRobotCamera();
  const dist = (sphere.radius / Math.sin((ROBOT_CAMERA.vfovDeg * Math.PI) / 360)) * 1.05;
  const az = (25 * Math.PI) / 180;
  cam.position.set(Math.sin(az) * dist, sphere.center.y + dist * 0.2, Math.cos(az) * dist);
  cam.lookAt(sphere.center);
  cam.updateMatrixWorld(true);
  const img = sensor.renderRGB(scene, cam);
  const { width: W, height: H } = ROBOT_CAMERA;
  const cw = aspect >= W / H ? W : Math.round(H * aspect);
  const ch = aspect >= W / H ? Math.round(W / aspect) : H;
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  src.getContext("2d")!.putImageData(img, 0, 0);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  c.getContext("2d")!.drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, cw, ch);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A life-size, in-context photograph of an asset: the object standing on the same wood floor
 * in front of the same wall finish, seen from a low camera, cropped to `aspect`. Printed at the
 * object's real size it is a deliberately strong decoy (a photo board or cardboard standee).
 */
export async function inContextPicture(sensor: SensorRenderer, spec: AssetSpec, aspect: number, floorTex: THREE.Texture, wallTex: THREE.Texture): Promise<THREE.CanvasTexture> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe2ded6);
  const obj = await loadAsset(spec);
  scene.add(obj);
  const ft = floorTex.clone();
  ft.repeat.set(4, 4);
  ft.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.72 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
  wall.position.set(0, 2, -1.2);
  wall.receiveShadow = true;
  scene.add(wall);
  addLighting(scene, { intensity: 1.0 });
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y;
  const cam = makeRobotCamera();
  // Frame the object so it fills ~80% of the picture height.
  const dist = (h / 0.8 / 2) / Math.tan((ROBOT_CAMERA.vfovDeg * Math.PI) / 360);
  cam.position.set(0.25 * dist, h * 0.55, dist);
  cam.lookAt(0, h * 0.5, 0);
  cam.updateMatrixWorld(true);
  const img = sensor.renderRGB(scene, cam);
  const { width: W, height: H } = ROBOT_CAMERA;
  const cw = aspect >= W / H ? W : Math.round(H * aspect);
  const ch = aspect >= W / H ? Math.round(W / aspect) : H;
  const src = document.createElement("canvas");
  src.width = W;
  src.height = H;
  src.getContext("2d")!.putImageData(img, 0, 0);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  c.getContext("2d")!.drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, cw, ch);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
