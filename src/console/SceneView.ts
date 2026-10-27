// Overview renderer for Mission Control. Renders the same world the sensor renders, plus
// visual overlays on OVERLAY_LAYER, which the robot camera (layer 0 only) never sees.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Pose2 } from "@/verify/types";
import type { CandidateStatus } from "@/verify/types";

export const OVERLAY_LAYER = 1;

const STATUS_COLOR: Record<CandidateStatus, number> = {
  PENDING: 0xf5a524,
  CONFIRMED: 0x34d399,
  REJECTED: 0xf87171,
  UNCONFIRMED: 0x9aa3ad,
};

function overlay<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => c.layers.set(OVERLAY_LAYER));
  return o;
}

export interface CandidateMarker {
  id: string;
  x: number;
  z: number;
  status: CandidateStatus;
  selected: boolean;
}

export interface GroundTruthMarker {
  id: string;
  x: number;
  z: number;
  label: string;
  isTarget: boolean;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene: THREE.Scene | null = null;
  private readonly root = new THREE.Group();
  private readonly robot: THREE.Group;
  private readonly fov: THREE.Mesh;
  /** Pose of the robot when the selected (earlier) frame was captured; hidden while following live. */
  private readonly capture: THREE.Group;
  private readonly captureLabel: CSS2DObject;
  private plannedLine: THREE.Line | null = null;
  private trailLine: THREE.Line;
  private readonly trail: THREE.Vector3[] = [];
  private readonly candidateGroup = new THREE.Group();
  private readonly gtGroup = new THREE.Group();
  private readonly env: THREE.Texture;
  private raf = 0;
  private userMoved = false;
  private readonly background = new THREE.Color(0x0b0d10);
  private disposed = false;
  private readonly resizeObs: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.style.position = "absolute";
    this.labels.domElement.style.inset = "0";
    this.labels.domElement.style.pointerEvents = "none";
    container.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.layers.enable(0);
    this.camera.layers.enable(OVERLAY_LAYER);
    this.camera.position.set(0, 13.5, 10.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;
    this.controls.update();
    this.controls.addEventListener("start", () => (this.userMoved = true));

    this.robot = overlay(buildRobot());
    this.fov = overlay(buildFovWedge());
    this.robot.add(this.fov);
    this.trailLine = overlay(
      new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 })),
    );
    this.captureLabel = new CSS2DObject(Object.assign(document.createElement("div"), { className: "scene-label scene-label-capture" }));
    this.captureLabel.position.set(0, 1.3, 0);
    this.capture = buildCaptureMarker();
    this.capture.add(this.captureLabel);
    this.setCapturePose(null);
    this.root.add(this.robot, this.trailLine, this.candidateGroup, this.gtGroup, this.capture);
    overlay(this.root);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setWorld(scene: THREE.Scene | null) {
    if (this.scene) this.scene.remove(this.root);
    this.scene = scene;
    this.trail.length = 0;
    this.updateTrail();
    this.setPlannedPath(null);
    this.setCandidates([]);
    this.setGroundTruth(null);
    this.setCapturePose(null);
    if (scene) scene.add(this.root);
  }

  /**
   * Shows where the robot was, and where its camera pointed, when a selected earlier frame was captured.
   * null hides it. The CSS label is hidden explicitly: CSS2DRenderer ignores the parent's visibility.
   */
  setCapturePose(p: Pose2 | null, label = "") {
    this.capture.visible = p !== null;
    this.captureLabel.visible = p !== null;
    this.captureLabel.element.textContent = label;
    if (!p) return;
    this.capture.position.set(p.x, 0, p.z);
    this.capture.rotation.y = -p.theta;
  }

  setRobot(p: Pose2, appendTrail = true) {
    this.robot.position.set(p.x, 0, p.z);
    // Robot local +X is forward; heading theta measured from +X towards +Z.
    this.robot.rotation.y = -p.theta;
    if (appendTrail) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.05) {
        this.trail.push(new THREE.Vector3(p.x, 0.03, p.z));
        this.updateTrail();
      }
    }
  }

  resetTrail() {
    this.trail.length = 0;
    this.updateTrail();
  }

  private updateTrail() {
    this.trailLine.geometry.dispose();
    this.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(this.trail.length ? this.trail : [new THREE.Vector3()]);
    this.trailLine.visible = this.trail.length > 1;
  }

  setPlannedPath(points: Array<{ x: number; z: number }> | null) {
    if (this.plannedLine) {
      this.root.remove(this.plannedLine);
      this.plannedLine.geometry.dispose();
      this.plannedLine = null;
    }
    if (!points || points.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0.04, p.z)));
    this.plannedLine = overlay(new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.18, gapSize: 0.12 })));
    this.plannedLine.computeLineDistances();
    this.root.add(this.plannedLine);
  }

  setCandidates(list: CandidateMarker[]) {
    clearGroup(this.candidateGroup);
    for (const c of list) {
      const color = STATUS_COLOR[c.status];
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(c.selected ? 0.42 : 0.36, c.selected ? 0.5 : 0.42, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.renderOrder = 5;
      g.add(ring);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 6), new THREE.MeshBasicMaterial({ color }));
      stem.position.y = 0.8;
      g.add(stem);
      const el = document.createElement("div");
      el.className = "scene-label";
      el.dataset.status = c.status;
      el.textContent = `${c.id} · ${c.status}`;
      const lbl = new CSS2DObject(el);
      lbl.position.set(0, 1.75, 0);
      g.add(lbl);
      g.position.set(c.x, 0, c.z);
      this.candidateGroup.add(overlay(g));
    }
  }

  /** Evaluator-only overlay, shown after a mission ends when the user opts in. */
  setGroundTruth(list: GroundTruthMarker[] | null) {
    clearGroup(this.gtGroup);
    if (!list) return;
    for (const o of list) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.6, 48),
        new THREE.MeshBasicMaterial({ color: o.isTarget ? 0x34d399 : 0xf87171, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      g.add(ring);
      const el = document.createElement("div");
      el.className = "scene-label scene-label-gt";
      el.textContent = `GT · ${o.label}`;
      const lbl = new CSS2DObject(el);
      lbl.position.set(0, 0.1, 0.75);
      g.add(lbl);
      g.position.set(o.x, 0, o.z);
      this.gtGroup.add(overlay(g));
    }
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.fitOverview();
  }

  /**
   * Default view: the shortest camera distance (along a fixed oblique direction) at which the
   * whole 14 × 10 m floor and the cut-away wall tops project inside the canvas, then the orbit
   * target is nudged so the room is centred vertically. Fits any aspect ratio without the empty
   * bands a fixed margin leaves. Overview camera only; the robot's sensor camera is separate.
   */
  private fitOverview() {
    // 62° elevation: steep enough to read paths and viewpoints around candidates, still oblique
    // enough to see furniture as 3-D.
    const phi = (62 * Math.PI) / 180;
    const dir = new THREE.Vector3(0, Math.sin(phi), Math.cos(phi));
    const pts: THREE.Vector3[] = [];
    for (const x of [-7, 7]) for (const z of [-5, 5]) for (const y of [0, 2.7 * 0.62]) pts.push(new THREE.Vector3(x, y, z));
    const cam = this.camera;
    const target = new THREE.Vector3();
    const extent = () => {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minY = Infinity, maxY = -Infinity, maxAbs = 0;
      for (const p of pts) {
        const v = p.clone().project(cam);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        maxAbs = Math.max(maxAbs, Math.abs(v.x));
      }
      return { minY, maxY, maxAbs };
    };
    let dist = 20;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 4, hi = 80;
      for (let i = 0; i < 30; i++) {
        dist = (lo + hi) / 2;
        const e = extent();
        if (e.maxAbs <= 0.94 && e.maxY - e.minY <= 1.84 && e.minY >= -0.97 && e.maxY <= 0.97) hi = dist;
        else lo = dist;
      }
      dist = hi;
      // Re-centre vertically: move the target along the floor's depth axis by the residual offset.
      const e = extent();
      const off = (e.maxY + e.minY) / 2;
      target.z -= off * dist * 0.35;
    }
    extent();
    this.controls.target.copy(target);
    this.controls.update();
  }

  private render() {
    if (!this.scene) {
      this.renderer.setClearColor(0x0b0d10, 1);
      this.renderer.clear();
      return;
    }
    const prevEnv = this.scene.environment;
    const prevBg = this.scene.background;
    this.scene.environment = this.env;
    this.scene.background = this.background;
    const ceiling = this.scene.getObjectByName("ceiling");
    if (ceiling) ceiling.visible = false;
    // Architectural cut-away for the overview only: walls are drawn at 62% height so the floor
    // stays visible from any orbit angle. The robot's sensor always renders full-height walls.
    const walls: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.name === "wall") walls.push(o);
    });
    for (const w of walls) {
      w.userData.y = w.position.y;
      w.scale.y = 0.62;
      w.position.y = w.userData.y * 0.62;
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    for (const w of walls) {
      w.scale.y = 1;
      w.position.y = w.userData.y;
    }
    if (ceiling) ceiling.visible = true;
    this.scene.environment = prevEnv;
    this.scene.background = prevBg;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    if (this.scene) this.scene.remove(this.root);
    this.controls.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

function clearGroup(g: THREE.Group) {
  for (const c of [...g.children]) {
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
      }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    g.remove(c);
  }
}

function buildRobot(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.5, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4, emissive: 0x0b3a52 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 32), body);
  base.position.y = 0.16;
  base.castShadow = true;
  g.add(base);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.252, 0.252, 0.03, 32), accent);
  stripe.position.y = 0.22;
  g.add(stripe);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 12), body);
  mast.position.set(0.05, 0.62, 0);
  g.add(mast);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.2), body);
  head.position.set(0.08, 1.0, 0);
  g.add(head);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), accent);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.15, 1.0, 0);
  g.add(lens);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 3), accent);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.3, 0.06, 0);
  g.add(nose);
  return g;
}

/** Capture-pose marker: an amber footprint ring and field-of-view wedge, distinct from the live robot. */
function buildCaptureMarker(): THREE.Group {
  const g = new THREE.Group();
  const color = 0xf5a524;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.28, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.renderOrder = 6;
  g.add(ring);
  const wedge = buildFovWedge(color, 0.22);
  wedge.position.y = 0.025;
  g.add(wedge);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 3), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.34, 0.06, 0);
  g.add(nose);
  return g;
}

/** Horizontal field of view of the robot camera, drawn on the floor out to 3 m. */
function buildFovWedge(color = 0x38bdf8, opacity = 0.1): THREE.Mesh {
  const hfov = 2 * Math.atan(Math.tan((50 * Math.PI) / 360) * (640 / 480));
  const r = 3;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(r * Math.cos(hfov / 2), r * Math.sin(hfov / 2));
  shape.absarc(0, 0, r, hfov / 2, -hfov / 2, true);
  shape.lineTo(0, 0);
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}
