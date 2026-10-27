import * as THREE from "three";
import { PHYSICAL_LAYER } from "./sensorRenderer";

/** Deterministic tiny PRNG for procedural textures (not used for experiment seeding). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

let floorTex: THREE.Texture | null = null;
let wallTex: THREE.Texture | null = null;

function floorTexture(): THREE.Texture {
  if (floorTex) return floorTex;
  floorTex = canvasTexture(512, 512, (ctx) => {
    const r = lcg(7);
    const plankH = 64;
    for (let y = 0; y < 512; y += plankH) {
      let x = -Math.floor(r() * 256);
      while (x < 512) {
        const len = 180 + r() * 200;
        const tone = 150 + Math.floor(r() * 30);
        ctx.fillStyle = `rgb(${tone + 25},${tone - 5},${tone - 45})`;
        ctx.fillRect(x, y, len, plankH);
        for (let g = 0; g < 14; g++) {
          ctx.strokeStyle = `rgba(90,60,30,${0.05 + r() * 0.08})`;
          ctx.beginPath();
          const gy = y + r() * plankH;
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(x + len / 3, gy + r() * 6 - 3, x + (2 * len) / 3, gy + r() * 6 - 3, x + len, gy);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(60,40,20,0.55)";
        ctx.fillRect(x, y, 2, plankH);
        x += len;
      }
      ctx.fillStyle = "rgba(60,40,20,0.6)";
      ctx.fillRect(0, y, 512, 2);
    }
  }, 1);
  return floorTex;
}

function wallTexture(): THREE.Texture {
  if (wallTex) return wallTex;
  wallTex = canvasTexture(256, 256, (ctx) => {
    const r = lcg(11);
    ctx.fillStyle = "rgb(226,222,214)";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = Math.floor(r() * 18) - 9;
      ctx.fillStyle = `rgba(${200 + v},${196 + v},${188 + v},0.25)`;
      ctx.fillRect(r() * 256, r() * 256, 2, 2);
    }
  }, 1);
  return wallTex;
}

function physical<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => c.layers.enable(PHYSICAL_LAYER));
  return o;
}

export interface RoomSpec {
  /** Interior extent along X and Z (m). Room spans [-w/2, w/2] x [-d/2, d/2]. */
  width: number;
  depth: number;
  height: number;
}

export function buildRoomShell(spec: RoomSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "room";
  const ft = floorTexture().clone();
  ft.repeat.set(spec.width / 2.5, spec.depth / 2.5);
  ft.needsUpdate = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.width, spec.depth),
    new THREE.MeshStandardMaterial({ map: ft, roughness: 0.72, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.width, spec.depth),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.95 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = spec.height;
  g.add(ceil);

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 });
  const walls: Array<[number, number, number, number]> = [
    // [length, x, z, rotY] – each wall faces the room interior
    [spec.width, 0, -spec.depth / 2, 0],
    [spec.width, 0, spec.depth / 2, Math.PI],
    [spec.depth, -spec.width / 2, 0, Math.PI / 2],
    [spec.depth, spec.width / 2, 0, -Math.PI / 2],
  ];
  for (const [len, x, z, ry] of walls) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, spec.height), wallMat);
    w.position.set(x, spec.height / 2, z);
    w.rotation.y = ry;
    w.receiveShadow = true;
    g.add(w);
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.02), baseMat);
    skirting.position.set(x, 0.05, z);
    skirting.rotation.y = ry;
    skirting.translateZ(0.01);
    g.add(skirting);
  }
  return physical(g);
}

export function addLighting(scene: THREE.Scene, opts: { intensity?: number; shadowCenter?: THREE.Vector3 } = {}): THREE.Group {
  const k = opts.intensity ?? 1;
  const g = new THREE.Group();
  g.name = "lighting";
  g.add(new THREE.HemisphereLight(0xfffaf0, 0x9a8f80, 0.55 * k));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6 * k);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.bias = -0.0005;
  g.add(sun);
  g.add(sun.target);
  scene.add(g);
  return g;
}

/** A framed print hung flat on a wall. The picture is a flat textured plane. */
export function buildPoster(picture: THREE.Texture, widthM: number, heightM: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "poster";
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.5 });
  const t = 0.04;
  const depth = 0.025;
  const parts: Array<[number, number, number, number]> = [
    [widthM + 2 * t, t, 0, heightM / 2 + t / 2],
    [widthM + 2 * t, t, 0, -heightM / 2 - t / 2],
    [t, heightM, -widthM / 2 - t / 2, 0],
    [t, heightM, widthM / 2 + t / 2, 0],
  ];
  for (const [w, h, x, y] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), frameMat);
    m.position.set(x, y, depth / 2);
    m.castShadow = true;
    g.add(m);
  }
  const mat = new THREE.MeshStandardMaterial({ map: picture, roughness: 0.55, metalness: 0 });
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  pic.position.z = 0.006;
  g.add(pic);
  return physical(g);
}

/** A flat-panel display on a low cabinet, showing an image. */
export function buildScreen(picture: THREE.Texture, screenW = 1.0, screenH = 0.6): THREE.Group {
  const g = new THREE.Group();
  g.name = "screen";
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.5, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.6 }),
  );
  cab.position.y = 0.25;
  cab.castShadow = cab.receiveShadow = true;
  g.add(cab);
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.04, screenH + 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.2 }),
  );
  bezel.position.set(0, 0.5 + 0.08 + (screenH + 0.04) / 2, -0.08);
  bezel.castShadow = true;
  g.add(bezel);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.1, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
  );
  stand.position.set(0, 0.55, -0.08);
  g.add(stand);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({ map: picture, toneMapped: false }),
  );
  screen.position.set(0, bezel.position.y, -0.08 + 0.021);
  g.add(screen);
  return physical(g);
}

/** Plain box obstacle (crate / cabinet). */
export function buildBox(w: number, h: number, d: number, color = 0x8a7a66): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  m.position.y = h / 2;
  m.castShadow = m.receiveShadow = true;
  return physical(m);
}

/**
 * A free-standing foam board (photo board) printed edge-to-edge with a picture, standing on the
 * floor on a small rear easel. The printed face is a single flat plane.
 */
export function buildPhotoBoard(picture: THREE.Texture, widthM: number, heightM: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "photo-board";
  const thick = 0.012;
  const edge = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(widthM, heightM, thick), edge);
  board.position.set(0, heightM / 2, 0);
  board.castShadow = board.receiveShadow = true;
  g.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), new THREE.MeshStandardMaterial({ map: picture, roughness: 0.6 }));
  face.position.set(0, heightM / 2, thick / 2 + 0.0005);
  g.add(face);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.6 });
  for (const x of [-widthM * 0.35, widthM * 0.35]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, heightM * 0.7, 0.03), legMat);
    leg.position.set(x, heightM * 0.33, -0.16);
    leg.rotation.x = 0.42;
    leg.castShadow = true;
    g.add(leg);
  }
  return physical(g);
}
