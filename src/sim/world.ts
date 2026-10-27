// Builds the Three.js scene and the navigation prior map for a scenario instance.
// The returned grid holds only occupied/free cells; object labels stay in the instance
// (ground truth) and are never passed to robot-facing code.
import * as THREE from "three";
import { ASSETS } from "./assets";
import { loadAsset } from "./loadAsset";
import { buildBox, buildPhotoBoard, buildPoster, buildScreen } from "./props";
import { studioPicture, inContextPicture } from "./pictures";
import { getFloorTexture, getWallTexture } from "./textures";
import type { SensorRenderer } from "./sensorRenderer";
import { OccupancyGrid, type Rect } from "@/nav/grid";
import { BOUNDS, WALLS, WALL_HEIGHT, type PlacedObject, type ScenarioInstance } from "@/scenarios/layout";
import { GRID_RES, INFLATION } from "./navParams";

export { GRID_RES, ROBOT_RADIUS, INFLATION } from "./navParams";

export interface BuiltWorld {
  scene: THREE.Scene;
  grid: OccupancyGrid;
  /** Scene roots by placed-object id. Evaluator/debug use only. */
  objectRoots: Map<string, THREE.Object3D>;
  dispose(): void;
}

const pictureCache = new Map<string, Promise<THREE.Texture>>();
const boardCache = new Map<string, Promise<THREE.Texture>>();

function boardPictureOf(assetId: string, sensor: SensorRenderer, aspect: number): Promise<THREE.Texture> {
  const key = `${assetId}:${aspect.toFixed(3)}`;
  let p = boardCache.get(key);
  if (!p) {
    p = inContextPicture(sensor, ASSETS[assetId], aspect, getFloorTexture(), getWallTexture());
    boardCache.set(key, p);
  }
  return p;
}

function pictureOf(assetId: string, sensor: SensorRenderer, aspect: number): Promise<THREE.Texture> {
  const key = `${assetId}:${aspect.toFixed(3)}`;
  let p = pictureCache.get(key);
  if (!p) {
    p = studioPicture(sensor, ASSETS[assetId], aspect);
    pictureCache.set(key, p);
  }
  return p;
}

function buildShell(scene: THREE.Scene) {
  const w = BOUNDS.maxX - BOUNDS.minX;
  const d = BOUNDS.maxZ - BOUNDS.minZ;
  const ft = getFloorTexture().clone();
  ft.repeat.set(w / 2.5, d / 2.5);
  ft.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.72 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((BOUNDS.minX + BOUNDS.maxX) / 2, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = "floor";
  scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.95 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(floor.position.x, WALL_HEIGHT, floor.position.z);
  ceil.name = "ceiling";
  scene.add(ceil);
  const wallMat = new THREE.MeshStandardMaterial({ map: getWallTexture(), roughness: 0.9 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 });
  for (const r of WALLS) {
    const sx = r.maxX - r.minX, sz = r.maxZ - r.minZ;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMat);
    wall.position.set((r.minX + r.maxX) / 2, WALL_HEIGHT / 2, (r.minZ + r.maxZ) / 2);
    wall.receiveShadow = true;
    wall.castShadow = true;
    wall.name = "wall";
    scene.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.03, 0.1, sz + 0.03), skirtMat);
    skirt.position.set(wall.position.x, 0.05, wall.position.z);
    scene.add(skirt);
  }
}

function addLights(scene: THREE.Scene, inst: ScenarioInstance) {
  const k = inst.lightScale;
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0x9a8f80, 0.55 * k));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.5 * k);
  const az = (inst.sunAzimuthDeg * Math.PI) / 180;
  sun.position.set(Math.cos(az) * 6, 8, Math.sin(az) * 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -9; cam.right = 9; cam.top = 9; cam.bottom = -9; cam.near = 0.5; cam.far = 30;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
}

async function buildObject(o: PlacedObject, sensor: SensorRenderer): Promise<THREE.Object3D> {
  const m = o.model;
  let obj: THREE.Object3D;
  if (m.type === "asset") {
    obj = await loadAsset(ASSETS[m.assetId]);
  } else if (m.type === "poster") {
    obj = buildPoster(await pictureOf(m.ofAsset, sensor, m.width / m.height), m.width, m.height);
  } else if (m.type === "board") {
    obj = buildPhotoBoard(await boardPictureOf(m.ofAsset, sensor, m.width / m.height), m.width, m.height);
  } else if (m.type === "screen") {
    obj = buildScreen(await pictureOf(m.ofAsset, sensor, 0.75), 0.47, 0.62);
  } else {
    obj = buildBox(m.w, m.h, m.d, m.color);
  }
  const root = new THREE.Group();
  root.add(obj);
  root.position.set(o.x, o.y ?? 0, o.z);
  root.rotation.y = o.yaw;
  root.name = `object:${o.id}`;
  return root;
}

export async function buildWorld(inst: ScenarioInstance, sensor: SensorRenderer): Promise<BuiltWorld> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0eee9);
  buildShell(scene);
  addLights(scene, inst);
  const grid = new OccupancyGrid(BOUNDS, GRID_RES);
  WALLS.forEach((r) => grid.addRect(r));
  const objectRoots = new Map<string, THREE.Object3D>();
  for (const o of inst.objects) {
    const root = await buildObject(o, sensor);
    scene.add(root);
    objectRoots.set(o.id, root);
    if (o.model.type !== "poster") {
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(root);
      const rect: Rect = { minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z };
      grid.addRect(rect);
    }
  }
  grid.inflate(INFLATION);
  scene.updateMatrixWorld(true);
  return {
    scene,
    grid,
    objectRoots,
    dispose() {
      // Asset geometries, materials and picture textures are shared through module caches
      // and reused by the next world, so only the scene graph is released here.
      scene.clear();
    },
  };
}
