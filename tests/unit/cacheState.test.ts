// P1-g: every mission records the sensor cache state it started with, so warm-cache wall-clock
// times can be identified; execution order and caching are unchanged.
import { describe, expect, it } from "vitest";
import { MissionRunner, missionConfig } from "@/mission/runner";
import { BrowserSensor } from "@/mission/browserSensor";
import type { Sensor, SensorFrame } from "@/mission/types";
import type { Pose2 } from "@/verify/types";
import { instantiateLayout } from "@/scenarios/generate";
import { ROUTE } from "@/scenarios/layout";
import { buildPriorGrid } from "@/scenarios/validate";
import { FakeLayoutSensor } from "./fixtures/fakeMissions";

/** Per-pose memoisation in front of the fake sensor, keyed like BrowserSensor.capture. */
class CachingSensor implements Sensor {
  readonly detectorInfo = null;
  private cache = new Map<string, SensorFrame>();
  constructor(private inner: Sensor) {}
  cacheEntries() {
    return this.cache.size;
  }
  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    const key = `${robot.x.toFixed(3)},${robot.z.toFixed(3)},${robot.theta.toFixed(4)}`;
    const hit = this.cache.get(key);
    if (hit) return { ...hit, frameId, t, robot: { ...robot }, cached: true, inferenceMs: 0 };
    const f = await this.inner.capture(robot, frameId, t);
    this.cache.set(key, f);
    return f;
  }
}

function runner(sensor: Sensor, method: "surestop" | "single-frame") {
  const inst = instantiateLayout("poster-decoy", 5, "v1");
  return new MissionRunner(missionConfig(method), buildPriorGrid(inst.objects), ROUTE, inst.start, sensor, { scenarioId: "poster-decoy", seed: 5 });
}

describe("cache state at mission start", () => {
  it("the first mission on a sensor starts cold; a later variant on the same sensor starts warm", async () => {
    const sensor = new CachingSensor(new FakeLayoutSensor([]));
    const first = await runner(sensor, "single-frame").runToEnd();
    expect(first.stats).toMatchObject({ sensorCacheEntriesAtStart: 0, cacheState: "cold" });
    const second = await runner(sensor, "surestop").runToEnd();
    expect(second.stats.sensorCacheEntriesAtStart).toBeGreaterThan(0);
    expect(second.stats.cacheState).toBe("warm");
    expect(second.stats.cachedFrames).toBeGreaterThan(0);
  });

  it("a sensor that does not report its cache gives null and 'unknown', never a guessed 'cold'", async () => {
    const r = await runner(new FakeLayoutSensor([]), "surestop").runToEnd();
    expect(r.stats).toMatchObject({ sensorCacheEntriesAtStart: null, cacheState: "unknown" });
  });

  it("BrowserSensor reports the size of its per-pose cache", () => {
    const fake = { cache: new Map([["a", 1], ["b", 2]]) };
    expect(BrowserSensor.prototype.cacheEntries.call(fake as unknown as BrowserSensor)).toBe(2);
  });
});
