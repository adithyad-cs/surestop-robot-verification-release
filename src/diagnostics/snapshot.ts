// Diagnostic snapshots: a top-down render of a scenario with the search route, and real
// robot-camera frames (with live detector boxes) at each route waypoint.
import * as THREE from "three";
import { ExperimentEngine } from "@/experiments/engine";
import { ROUTE, BOUNDS } from "@/scenarios/layout";
import { thumbnail } from "./feasibility";

export async function snapshot(scenarioId: string, seed: number, backend: string | null): Promise<Record<string, string>> {
  const engine = await ExperimentEngine.create(backend);
  const p = await engine.prepare(scenarioId, seed, true);
  const out: Record<string, string> = {};
  const w = BOUNDS.maxX - BOUNDS.minX;
  const d = BOUNDS.maxZ - BOUNDS.minZ;
  const top = new THREE.OrthographicCamera(-w / 2 - 0.2, w / 2 + 0.2, (w * 0.75) / 2, -(w * 0.75) / 2, 0.1, 50);
  top.position.set(0, 20, 0);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0);
  const ceiling = p.world.scene.getObjectByName("ceiling");
  if (ceiling) ceiling.visible = false;
  const helpers = new THREE.Group();
  const pts = ROUTE.map((r) => new THREE.Vector3(r.x, 2.0, r.z));
  helpers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x0088ff })));
  for (const r of ROUTE) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshBasicMaterial({ color: 0x0088ff }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(r.x, 2.0, r.z);
    helpers.add(m);
  }
  p.world.scene.add(helpers);
  const img = engine.renderer.renderRGB(p.world.scene, top);
  out["top"] = thumbnail(img, [], null, 1);
  p.world.scene.remove(helpers);
  if (ceiling) ceiling.visible = true;
  void d;
  let i = 0;
  for (const r of ROUTE) {
    for (const h of r.scan ?? [null]) {
      const theta = h === null ? Math.atan2((ROUTE[i + 1]?.z ?? r.z) - r.z, (ROUTE[i + 1]?.x ?? r.x + 1) - r.x) : (h * Math.PI) / 180;
      const f = await p.sensor.capture({ x: r.x, z: r.z, theta }, 0, 0);
      out[`wp${i}-h${h === null ? "fwd" : h}`] = thumbnail(p.sensor.lastImage!, f.detections.filter((x) => x.score >= 0.3), null, 0.5);
    }
    i++;
  }
  return out;
}
