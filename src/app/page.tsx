import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import ViewpointRose, { type RoseView } from "@/components/ViewpointRose";
import { BOUNDS, WALLS } from "@/scenarios/layout";
import { recordedSummary } from "@/eval/recordedSummary";
import type { Rate } from "@/eval/metrics";
import type { CandidateStatus, ViewVerdict } from "@/verify/types";
import EvidencePoster, { type PosterFrame } from "./landing/EvidencePoster";
import RouteMap from "./landing/RouteMap";
import run from "./poster-run.json";
import styles from "./page.module.css";

// Everything on this page that describes a mission comes from one recorded held-out mission
// (src/app/poster-run.json, extracted from public/data/eval-runs.json by
// scripts/poster-data.mjs) or from the recorded summary. Nothing here runs live.

type Track = (typeof run.tracks)[number];
const track = (id: string) => run.tracks.find((t) => t.id === id) as Track;
const frameById = (id: number) => run.frames.find((f) => f.frameId === id)!;
const mm = (m: number | null) => (m === null ? "—" : `${Math.round(m * 1000)}`);
const frac = (r: Rate) => `${r.num}/${r.den}`;

function posterFrame(trackId: string, frameId: number, title: string, rgb: string, depth: string, rgbAlt: string, depthAlt: string): PosterFrame {
  const t = track(trackId);
  const f = frameById(frameId);
  const obs = f.targets.find((x) => x.trackId === trackId)!;
  const ev = t.evidence.find((e) => e.frameId === frameId)!;
  const views = t.evidence.filter((e) => e.counted).length;
  const detail =
    t.status === "REJECTED"
      ? `${t.against} flat, ${t.support} volumetric of ${views} viewpoints`
      : `${t.support} volumetric, ${t.against} flat of ${views} viewpoints`;
  return {
    trackId,
    frameId,
    t: f.t,
    title,
    rgb,
    depth,
    rgbAlt,
    depthAlt,
    score: obs.score,
    reliefMm: Math.round((obs.relief ?? 0) * 1000),
    // Horizontal distance from the robot to the candidate estimate (the verifier's range).
    range: ev.range,
    verdict: ev.verdict,
    status: t.status,
    statusDetail: detail,
  };
}

function roseViews(t: Track): RoseView[] {
  return t.evidence.map((e) => ({ ...e, verdict: e.verdict as ViewVerdict }));
}

export default function Home() {
  const c1 = track("C1");
  const c2 = track("C2");
  const frames = [
    posterFrame(
      "C1",
      2,
      "life-size photo board",
      "/media/frame-board.jpg",
      "/media/frame-board-depth.jpg",
      "Robot camera frame 2: a life-size photo board of a potted plant; COCO-SSD box labelled potted plant 0.97",
      "Depth image of frame 2: the board is one flat surface inside the sampled region",
    ),
    posterFrame(
      "C2",
      28,
      "3-D potted plant",
      "/media/frame-plant.jpg",
      "/media/frame-plant-depth.jpg",
      "Robot camera frame 28: a real 3-D potted plant; COCO-SSD box labelled potted plant 0.98",
      "Depth image of frame 28: leaves and pot at many different depths",
    ),
  ];
  const first = run.frames[0];
  const firstObs = first.targets[0];
  const firstRange = c1.evidence.find((e) => e.frameId === first.frameId)!.range;
  const verifyOf = (id: string) => run.frames.filter((f) => f.purpose === "verify" && f.focusTrackId === id);
  const c1Verify = verifyOf("C1");
  const c1Misses = c1Verify.filter((f) => !f.targets.some((x) => x.trackId === "C1")).length;
  const c1Flat = c1.evidence.filter((e) => e.counted && e.verdict === "FLAT");
  const c2Vol = c2.evidence.filter((e) => e.counted && e.verdict === "VOLUMETRIC");
  const decidedAt = (id: string, to: string) => run.candidateEvents.find((e) => e.trackId === id && e.to === to)!.t;
  const openedAt = (id: string) => run.candidateEvents.find((e) => e.trackId === id && e.to === "PENDING")!.t;
  const last = run.frames[run.frames.length - 1];
  const verifyViews = run.frames
    .filter((f) => f.purpose === "verify")
    .map((f) => ({ frameId: f.frameId, x: f.x, z: f.z, trackId: f.focusTrackId, detected: f.targets.some((x) => x.trackId === f.focusTrackId) }));
  const P = run.provenance.run;
  const recordedLine = `Recorded simulation · ${P.scenarioId} · held-out seed ${P.seed} · SureStop · real rendering and real COCO-SSD inference (WASM), recorded ${run.provenance.recordedAt.slice(0, 10)}.`;

  const summary = recordedSummary();
  const ss = summary.rows.find((r) => r.variant === "surestop")!;
  const sf = summary.rows.find((r) => r.variant === "single-frame")!;

  return (
    <>
      <AppHeader />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.copy}>
            <p className="eyebrow">Hack in Hills ’26 · Team Nexora4 · browser prototype</p>
            <h1 id="hero-title" className={styles.title}>
              <span className={styles.display}>Find. Verify. Then&nbsp;arrive.</span>
              <span className={styles.thesis}>Robots should verify the intended target before reporting arrival.</span>
            </h1>
            <p className={styles.lede}>
              A simulated robot runs a real object detector on the pixels its own camera renders. When something looks like the target, SureStop moves to
              new viewpoints and measures depth before it is allowed to stop, and it holds back when the evidence stays insufficient.
            </p>
            <div className={styles.actions}>
              <Link href="/console" className={`btn btn-primary ${styles.cta}`}>
                ENTER SYSTEM
              </Link>
              <p className={styles.quiet}>
                or inspect <Link href="/lab">{summary.trials} recorded missions</Link> · read the <Link href="/method">method and its limits</Link>
              </p>
            </div>
          </div>
          <div className={styles.posterCol}>
            <h2 className={styles.posterTitle}>
              Same detector confidence. <span>Different geometry.</span>
            </h2>
            <EvidencePoster
              frames={frames}
              provenance={`${recordedLine} Boxes are the detector's real output on these pixels; depth is the simulated range sensor with its noise model. C1 and C2 are the robot's candidates; the object names are the evaluator's labels, applied after the mission.`}
            />
          </div>
        </section>

        <section className={styles.route} aria-labelledby="route-title">
          <header className={styles.sectionHead}>
            <p className="eyebrow">The same mission, from above</p>
            <h2 id="route-title">It moved to look again before deciding.</h2>
          </header>
          <div className={styles.routeGrid}>
            <RouteMap
              data={{ walls: WALLS, bounds: BOUNDS, trajectory: run.trajectory as Array<[number, number]>, tracks: run.tracks, verifyViews }}
              caption={`${recordedLine} Path ${run.stats.pathLength.toFixed(1)} m over ${run.stats.simTime.toFixed(1)} s of simulated time; ${run.stats.frames} camera frames, ${run.stats.verificationFrames} of them from planned verification viewpoints.`}
            />
            <div className={styles.roses}>
              {[c1, c2].map((t) => (
                <div key={t.id} className={styles.roseCard}>
                  <ViewpointRose id={t.id} status={t.status as CandidateStatus} views={roseViews(t)} size={240} />
                  <p className={styles.roseText}>
                    <b className="mono">{t.id}</b> {t.reason}.
                  </p>
                </div>
              ))}
              <p className={styles.roseNote}>
                Each mark is one observation of the candidate, placed at the robot’s bearing and range as seen from the candidate (plan view, same
                orientation as the map). The grid is the verifier’s own: one vote per 0.75 m × 30° cell.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.steps} aria-labelledby="steps-title">
          <h2 id="steps-title" className="visually-hidden">
            Find, verify, arrive in this mission
          </h2>
          <ol>
            <li>
              <span className={styles.stepName}>Find</span>
              <p>
                On frame {first.frameId}, {firstRange.toFixed(1)} m away, COCO-SSD labels the photo board “potted plant” at{" "}
                <b className="mono">{firstObs.score.toFixed(2)}</b>. Candidate C1 opens at t = {openedAt("C1").toFixed(1)} s.
              </p>
            </li>
            <li>
              <span className={styles.stepName}>Verify</span>
              <p>
                The robot drives to {c1Verify.length} planned viewpoints around C1: flat surface twice ({c1Flat.map((e) => `${mm(e.excessRelief)} mm`).join(", ")}), not
                re-detected {c1Misses} times. C1 is <b className={styles.rej}>REJECTED</b> at {decidedAt("C1", "REJECTED").toFixed(1)} s. Later, C2 measures{" "}
                {c2Vol.map((e) => `${mm(e.excessRelief)} mm`).join(" and ")} of relief from two viewpoints and is <b className={styles.conf}>CONFIRMED</b> at{" "}
                {decidedAt("C2", "CONFIRMED").toFixed(1)} s.
              </p>
            </li>
            <li>
              <span className={styles.stepName}>Arrive</span>
              <p>
                It approaches C2 and reports <b className="mono">{run.outcome}</b> at t = {last.t.toFixed(1)} s: “{run.reason}”. Only then does the separate
                evaluator module compare positions with ground truth: C2 is the real plant.
              </p>
            </li>
          </ol>
        </section>

        <section className={styles.results} aria-labelledby="results-title">
          <header className={styles.sectionHead}>
            <p className="eyebrow">
              Recorded held-out evaluation · {summary.trials} missions · {summary.scenarios} scenarios × 4 methods × seeds {summary.seeds}
            </p>
            <h2 id="results-title">One mission is an example. Here is the whole recorded set.</h2>
          </header>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Recorded results by method (scrolls horizontally on small screens)">
            <table className={styles.table}>
              <caption className="visually-hidden">False arrivals, completion and path length per method, recorded held-out seeds</caption>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">False arrivals, all 7 scenarios</th>
                  <th scope="col">False arrivals, original 6</th>
                  <th scope="col">Completion, all 7</th>
                  <th scope="col">Mean path, all 7</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.variant} data-ours={r.variant === "surestop"}>
                    <th scope="row">{r.label}</th>
                    <td className="mono">{frac(r.all.falseArrivalRate)}</td>
                    <td className="mono">{frac(r.original6.falseArrivalRate)}</td>
                    <td className="mono">{frac(r.all.completionRate)}</td>
                    <td className="mono">{r.all.meanPathLength.toFixed(1)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={styles.reading}>
            <li>
              On the six original scenarios, the tuned single-frame threshold made {frac(sf.original6.falseArrivalRate)} false arrivals.{" "}
              {sf.postHoc.falseArrivalRate.num === sf.all.falseArrivalRate.num ? "All" : sf.postHoc.falseArrivalRate.num} of its{" "}
              {sf.all.falseArrivalRate.num} false arrivals are on <code>photo-board-decoy</code>, a scenario added after the first calibration run showed our
              original decoys scored lower than the plant from the search route.
            </li>
            <li>
              SureStop’s re-observation has a cost: a mean path of {ss.all.meanPathLength.toFixed(1)} m against {sf.all.meanPathLength.toFixed(1)} m for
              single-frame.
            </li>
            <li>Simulation only, one floor layout, decoys designed by us, 20 seeds per scenario and method. Denominators count trials with a non-target candidate.</li>
          </ul>
          <p className={styles.quiet}>
            Every number above is recomputed from the recorded runs in the <Link href="/lab">Verification Lab</Link>, which also opens each trial’s decision
            trace. Scope, protocol changes and failure modes are on the <Link href="/method">Method</Link> page.
          </p>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>
          Prototype scope: a category-level task (a physical, three-dimensional potted plant) in simulation. No real-robot, safety, instance-identity,
          novelty or statistical-guarantee claims.
        </p>
      </footer>
    </>
  );
}
