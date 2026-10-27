import { CONFUSABLE_CLASSES } from "@/verify/identity";
// A copy of docs/experiments/identity-conflict/results/matrix-summary.json (src must not import from docs/);
// tests/unit/identityConflict.test.ts checks that the two are byte-identical.
import id from "./identity-matrix-summary.json";
import AppHeader from "@/components/AppHeader";
import { DEFAULT_EVIDENCE } from "@/verify/evidence";
import { DEFAULT_SURESTOP } from "@/verify/surestop";
import { DEFAULT_PLANNER } from "@/verify/planner";
import { DEFAULT_CELL } from "@/verify/viewpoint";
import { DEFAULT_MISSION } from "@/mission/runner";
import { DEFAULT_DEPTH_NOISE } from "@/sensing/depthFeatures";
import { METRIC_DEFINITIONS } from "@/eval/metrics";
import { SCENARIOS } from "@/scenarios/layout";
import { EVAL_SEEDS, CALIBRATION_SEEDS } from "@/experiments/protocol";
import { recordedSummary } from "@/eval/recordedSummary";
import type { Rate } from "@/eval/metrics";
import ViewpointRose from "@/components/ViewpointRose";
import type { ViewVerdict } from "@/verify/types";
import run from "../poster-run.json";
import styles from "./method.module.css";

export const metadata = { title: "Method" };

const mm = (m: number) => `${Math.round(m * 1000)} mm`;
const rateText = (r: Rate) => (r.value === null ? "—" : `${Math.round(r.value * 100)}% (${r.num}/${r.den})`);
const ciPct = (ci: number[] | null) => (ci ? `${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%` : "—");
const IDENTITY_METHODS = ["single-frame", "surestop", "surestop-identity"] as const;
const ciText = (r: Rate) => (r.ci95 ? `${Math.round(r.ci95[0] * 100)}–${Math.round(r.ci95[1] * 100)}%` : "—");

// Chronology from Git commit times (UTC, 2026-10-19) and the raw record files; see
// docs/experiments/raw/MANIFEST.md and docs/FINAL_AUDIT_REPORT.md section E.
const CHRONOLOGY: Array<{ when: string; what: string; detail: string; kind?: "change" | "data" | "audit" }> = [
  { when: "14:15 · 1994d8d", what: "Phase A feasibility and verifier core", detail: "Evidence gates (60 mm volumetric, 25 mm flat, 30 mm noise, score 0.4) set from feasibility renders; unchanged since." },
  { when: "14:32 · cac2b54", what: "End-to-end mission", detail: "Developed on seeds outside both experiment sets (surviving logs show 1, 2, 3 and 5): planner rings 1.4/1.9 → 1.6/2.0 m, bin-centre bearings.", kind: "change" },
  { when: "15:12 · build 2c5200c", what: "Calibration v1", detail: "660 missions, seeds 101–110, six scenarios. Used to pick τ and to debug SureStop.", kind: "data" },
  { when: "15:18 · 7c1f2a4", what: "Changes after v1", detail: "Rings 1.9/2.2 m, confirm range 2.5 m, ‘not reproducible’ rejection rule, new photo-board-decoy scenario.", kind: "change" },
  { when: "15:50 · 15:51 e37e6d7", what: "Calibration v2 and thresholds", detail: "770 missions, all seven scenarios → single-frame τ 0.9, persistence τ 0.8 (v1 had picked 0.6).", kind: "data" },
  { when: "16:48", what: "Held-out evaluation", detail: "560 missions, seeds 1001–1020; robot code identical to e37e6d7. These are the results above.", kind: "data" },
  { when: "evening · next day", what: "Final audit and remediation", detail: "All published numbers recomputed from the records; wording and provenance corrected; records unchanged.", kind: "audit" },
];

export default function MethodPage() {
  const e = DEFAULT_EVIDENCE;
  const s = DEFAULT_SURESTOP;
  const p = DEFAULT_PLANNER;
  const m = DEFAULT_MISSION;
  const summary = recordedSummary();
  const c1 = run.tracks.find((t) => t.id === "C1")!;
  return (
    <>
      <AppHeader />
      <main className={styles.page}>
        <nav className={styles.toc} aria-label="On this page">
          <a href="#task">Task contract</a>
          <a href="#arch">Architecture</a>
          <a href="#verify">Verification policy</a>
          <a href="#identity">Experimental: identity check</a>
          <a href="#baselines">Baselines</a>
          <a href="#protocol">Protocol &amp; metrics</a>
          <a href="#results">Results</a>
          <a href="#changes">Chronology &amp; changes</a>
          <a href="#sensing">Sensing model</a>
          <a href="#prior">Prior work</a>
          <a href="#limits">Limitations</a>
          <a href="#repro">Reproduce</a>
        </nav>
        <article className={styles.article}>
          <h1>Method</h1>
          <p className={styles.lede}>
            What is implemented, what is measured, and what remains a hypothesis. Parameter values on this page are read from the same code the simulator runs.
          </p>

          <section id="task">
            <h2>Task contract</h2>
            <ul>
              <li>
                <b>Goal given to the robot:</b> the COCO class name <code>{m.targetClass}</code>. The task is <b>category-level</b>: stop at a physical,
                three-dimensional potted plant. A picture or a display of a plant is not a valid target.
              </li>
              <li>
                <b>What the robot may use:</b> rendered RGB frames, a pixel-aligned depth image with a noise model, its own pose, a fixed search route and a
                label-free occupancy map for path planning.
              </li>
              <li>
                <b>What it never sees:</b> object identities, scenario names, which object is the target, or any ground-truth label. A unit test fails if
                robot-facing modules import the scenario, asset catalogue or evaluator.
              </li>
              <li>
                <b>What the detector can and cannot establish:</b> COCO-SSD predicts a class and a box; it does not identify a particular plant. Depth
                establishes whether the boxed surface is flat or volumetric; it does not establish semantic identity.
              </li>
            </ul>
          </section>

          <section id="arch">
            <h2>Architecture</h2>
            <div className={styles.arch} role="img" aria-label="Data flow from simulation through sensor, detector and verifier to the mission; evaluator reads results afterwards">
              <div className={styles.lane}>
                <span className={styles.laneTag}>Simulation</span>
                <div>Three.js scene · glTF assets · robot pose · A* on occupancy grid</div>
              </div>
              <div className={styles.lane}>
                <span className={`${styles.laneTag} ${styles.sensor}`}>Sensor</span>
                <div>640×480 RGB render + aligned depth pass + seeded noise</div>
              </div>
              <div className={styles.lane}>
                <span className={`${styles.laneTag} ${styles.model}`}>Perception</span>
                <div>COCO-SSD (TF.js) on the RGB pixels → boxes, classes, scores</div>
              </div>
              <div className={styles.lane}>
                <span className={`${styles.laneTag} ${styles.verifier}`}>Verifier</span>
                <div>Depth features in box → per-view verdict → viewpoint cells → candidate decision → planned re-observation</div>
              </div>
              <div className={styles.lane}>
                <span className={styles.laneTag}>Mission</span>
                <div>Search route · candidate tracks · approach &amp; stop · event log</div>
              </div>
              <div className={`${styles.lane} ${styles.evalLane}`}>
                <span className={`${styles.laneTag} ${styles.eval}`}>Evaluator</span>
                <div>After the mission: labels candidates by position against ground truth and scores the trial. Never feeds back.</div>
              </div>
            </div>
            <p>
              Everything runs in the browser; there is no server-side inference. Perception results are memoised per exact camera pose within a page, so
              methods that pass through the same pose see identical frames. Replaying a recorded trial in Mission Control (four trials checked) reproduced
              its trajectory, every target-class observation, every candidate decision and the evaluator score; 2 of 92 detections of <em>other</em>{" "}
              classes differed in the fourth decimal, and the same happened with the build that produced the records.
            </p>
          </section>

          <section id="verify">
            <h2>Verification policy (SureStop)</h2>
            <p>
              A deterministic <b>sequential viewpoint evidence policy</b>. It is not an SPRT: votes are not likelihood ratios and no probability is
              calibrated. The deck proposed calibrated log-likelihood ratios and Wald’s test; we did not have labelled data and time to fit and validate
              such models, so we use transparent rules and say so.
            </p>
            <h3>Per-view assessment</h3>
            <table className={styles.table}>
              <tbody>
                <tr>
                  <th scope="row">Inputs</th>
                  <td>Target-class detection (score, box) and depth inside the box, inset 20% to limit background bleed.</td>
                </tr>
                <tr>
                  <th scope="row">Excess relief</th>
                  <td>
                    √max(0, RMS² − σ²): RMS distance of depth points to their best-fit plane, minus the sensor noise expected at that range.
                  </td>
                </tr>
                <tr>
                  <th scope="row">INCONCLUSIVE if</th>
                  <td>
                    no detection (miss); no depth; box &lt; {e.minBoxW}×{e.minBoxH} px; box touches the image border; &lt; {e.minValidFraction * 100}% valid
                    depth; expected noise &gt; {mm(e.maxExpectedNoise)}; relief between thresholds; or two flat planes explain ≥ {e.maxTwoPlaneFraction * 100}%
                    of points (an occluder in front of a picture, or a wall corner).
                  </td>
                </tr>
                <tr>
                  <th scope="row">VOLUMETRIC if</th>
                  <td>
                    relief ≥ {mm(e.volumetricRelief)} and detector score ≥ {e.minScore}.
                  </td>
                </tr>
                <tr>
                  <th scope="row">FLAT if</th>
                  <td>relief ≤ {mm(e.flatRelief)}.</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.note}>
              Thresholds were set from the Phase A feasibility renders (plant relief 98–192 mm, prints and displays ≤ 12 mm), which are separate from all
              mission seeds. See PERCEPTION_FEASIBILITY.md.
            </p>
            <h3>Evidence accounting and decision</h3>
            <ul>
              <li>
                <b>One vote per viewpoint cell.</b> A cell is the robot’s range bin ({DEFAULT_CELL.rangeBin} m) × bearing bin ({DEFAULT_CELL.bearingBinDeg}°)
                around the candidate. Repeated frames in a cell share one vote; a conclusive or lower-noise observation can replace the cell’s vote.
              </li>
              <li>
                <b>CONFIRMED</b> when ≥ {s.requiredSupport} distinct cells are VOLUMETRIC, none is FLAT, and one supporting view is within {s.confirmRange} m.
              </li>
              <li>
                <b>REJECTED</b> when ≥ {s.requiredAgainst} distinct cells are FLAT and none is VOLUMETRIC, or when ≥ {s.requiredMisses} distinct planned
                viewpoints with line of sight fail to re-detect it and none is VOLUMETRIC (detection not reproducible).
              </li>
              <li>
                <b>UNCONFIRMED</b> when {s.maxViewpoints} planned viewpoints are spent, no reachable unused viewpoint exists, or the mission budget ends while
                verifying. Conflicting evidence never resolves to CONFIRMED.
              </li>
              <li>
                A terminal candidate decision is final: later observations are logged but cannot change it.
              </li>
            </ul>
            <figure className={styles.roseFig}>
              <ViewpointRose id={c1.id} status="REJECTED" views={c1.evidence.map((e) => ({ ...e, verdict: e.verdict as ViewVerdict }))} size={220} />
              <figcaption>
                <b>Reading a viewpoint rose.</b> Recorded example ({run.provenance.run.scenarioId}, seed {run.provenance.run.seed}, SureStop): candidate C1
                seen from {c1.evidence.length} viewpoints. Each mark sits at the robot’s bearing and range as seen from the candidate, on the verifier’s own cell
                grid ({DEFAULT_CELL.rangeBin} m × {DEFAULT_CELL.bearingBinDeg}°). Two cells voted FLAT, two planned viewpoints did not re-detect it, and one
                far view was inconclusive, so C1 was REJECTED: {c1.reason}.
              </figcaption>
            </figure>
            <h3>Bounded re-observation</h3>
            <p>
              Candidate viewpoints lie on rings of {p.ranges.join(" and ")} m around the candidate at the centres of {p.bearingStepDeg}° bearing bins. A
              viewpoint must be free, reachable by A*, in an unused cell, and have line of sight (ignoring the last {p.ownFootprint} m, the candidate’s own
              footprint). Score = 2 × min(bearing change, {p.saturatingChangeDeg}°)/{p.saturatingChangeDeg}° + {p.closenessWeight} × closeness −{" "}
              {p.pathWeight} × path length. This is a geometric heuristic, not information-gain planning.
            </p>
            <h3>Candidate vs mission outcomes</h3>
            <ul>
              <li>REJECTED and UNCONFIRMED candidates are frozen and the search continues.</li>
              <li>
                Mission ends <b>ARRIVED</b> after approaching a CONFIRMED candidate to {m.standOff} m; <b>UNRESOLVED</b> if the route ends with any engaged
                candidate UNCONFIRMED; <b>NOT_FOUND</b> otherwise; <b>NAV_FAILURE</b> if a confirmed candidate cannot be approached.
              </li>
              <li>
                Budget: {m.maxFrames} frames or {m.maxSimTime} s simulated time. Search observations every {m.observeEvery} m plus scans at route waypoints.
              </li>
            </ul>
          </section>

          <section id="identity">
            <h2>Experimental: identity-conflict check</h2>
            <p>
              <b>Status: experimental.</b> Method <code>surestop-identity</code>, preselected in Mission Control. The method <code>surestop</code> above is
              unchanged, and every recorded result on this page uses it.
            </p>
            <ul>
              <li>
                <b>Failure it addresses.</b> In <code>lookalike-3d</code> seed 123 (layout <code>v2-04a6cf82</code>), COCO-SSD labels a vase of flowers
                “potted plant” in two views. Both views are volumetric, because the vase is 3-D, so <code>surestop</code> confirms it and arrives there.
                Repeated target labels plus correct geometry do not establish identity.
              </li>
              <li>
                <b>Rule.</b> The detector sometimes names the same object as a confusable class ({Object.entries(CONFUSABLE_CLASSES).map(([t, cs]) => `“${t}” → ${cs.map((c) => `“${c}”`).join(", ")}`).join("; ")}).
                Such a detection, at score ≥ {m.detectionFloor} with valid depth, is localised like a target detection. If it lies within {m.associationGate} m of
                a candidate (from any frame, before or after the candidate opened), confirmation is withheld. The candidate ends{" "}
                <b>UNCONFIRMED</b>, never REJECTED, and the search resumes. Conflicts are applied before a frame’s target evidence.
              </li>
              <li>
                <b>Inputs.</b> Detector classes, scores, boxes, depth and the robot’s pose only. No ground truth, object identifiers, seeds or scene
                graph.
              </li>
              <li>
                <b>Development matrix.</b> Design frozen before implementation; {id.missions} missions = 7 scenarios × 14 seeds × 3 methods; layout
                v2; real inference; development seeds only. Intervals are 95% Wilson.
                <ul>
                  {IDENTITY_METHODS.map((k) => {
                    const p = id.pooled[k];
                    return (
                      <li key={k}>
                        <code>{k}</code>: false arrivals {p.falseArrivals}/{p.missions} [{ciPct(p.falseArrivalCI)}]; correct arrivals{" "}
                        {p.correctArrivals}/{p.targetPresent} target-present [{ciPct(p.correctArrivalCI)}]; median simulated time {p.medianSimTime.toFixed(1)} s.
                      </li>
                    );
                  })}
                  <li>
                    <b>Outcome changes:</b> of {id.paired.pairs} paired worlds, exactly {id.paired.changed.length} outcome changed between{" "}
                    <code>surestop</code> and <code>surestop-identity</code> (seed 123: false arrival → correct arrival). The intervals overlap; this is not a
                    statistically established improvement.
                  </li>
                  <li>
                    <b>Decoy exposure:</b> real perception made the decoy a candidate in only{" "}
                    {(["screen-decoy", "poster-decoy", "photo-board-decoy"] as const)
                      .map((sc) => `${id.decoyExposure.surestop[sc].missionsWithDecoyCandidate} of ${id.decoyExposure.surestop[sc].n} ${sc}`)
                      .join(", ")}{" "}
                    worlds. A correct arrival where the decoy was never detected is not evidence of rejection.
                  </li>
                </ul>
              </li>
              <li>
                <b>Limits.</b>
                <ul>
                  <li>It is a confusable-class conflict rule over the detector’s own labels, not a general semantic identity system.</li>
                  <li>It needs the detector to call the look-alike “vase” in at least one localised view.</li>
                  <li>A false “vase” detection near a genuine plant would withhold that plant.</li>
                  <li>The class table was chosen from this case.</li>
                  <li>It was tested on one vase asset and one plant asset.</li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="baselines">
            <h2>Baselines</h2>
            <ul>
              <li>
                <b>Single-frame threshold</b> (VLFM-style per the team’s code reading): commit to a candidate on the first frame with target score ≥ τ
                (default τ = {m.singleFrame.threshold}), then approach and stop.
              </li>
              <li>
                <b>Temporal persistence</b>: approach the candidate in {m.persistence.step} m steps, commit when {m.persistence.requiredHits} of the last{" "}
                {m.persistence.window} frames score ≥ τ (default τ = {m.persistence.threshold}); drop it after {m.persistence.maxConsecutiveMisses}{" "}
                consecutive misses.
              </li>
              <li>
                <b>SureStop, one view (ablation)</b>: the same evidence and planner but a single conclusive view decides. It isolates the multi-view part.
              </li>
            </ul>
            <p>
              All methods share the detector, the detection floor ({m.detectionFloor}), candidate association, the search route and the approach behaviour.
              Baseline thresholds τ are selected on calibration seeds by the rule in the Lab’s calibration table, never on evaluation seeds. SureStop moves to
              extra viewpoints and therefore spends more frames and path; the Lab reports both.
            </p>
          </section>

          <section id="protocol">
            <h2>Protocol and metrics</h2>
            <p>One trial = one seeded mission. Seeds jitter object placement and yaw, robot start pose, lighting and the depth-noise stream.</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Target present</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((sc) => (
                  <tr key={sc.id}>
                    <td>
                      <code>{sc.id}</code>
                    </td>
                    <td>{sc.targetPresent ? "yes" : "no"}</td>
                    <td>{sc.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Calibration seeds: {CALIBRATION_SEEDS[0]}–{CALIBRATION_SEEDS[CALIBRATION_SEEDS.length - 1]}. Held-out evaluation seeds: {EVAL_SEEDS[0]}–
              {EVAL_SEEDS[EVAL_SEEDS.length - 1]} ({EVAL_SEEDS.length} per scenario and method).
            </p>
            <ul>
              {Object.entries(METRIC_DEFINITIONS).map(([k, v]) => (
                <li key={k}>
                  <b>{k}</b>: {v}
                </li>
              ))}
              <li>
                Candidate-level counts use one encounter = one candidate track (verification episode), not one frame. Intervals are 95% Wilson score
                intervals. No calibration metrics (ECE, Brier) are reported because the system produces no probabilities.
              </li>
            </ul>
          </section>

          <section id="results">
            <h2>Results (recorded held-out evaluation)</h2>
            <p className={styles.note}>
              Computed when this page was built from <code>public/data/eval-summary.json</code> ({summary.trials} missions, seeds {summary.seeds}, recorded{" "}
              {summary.generatedAt.slice(0, 10)}), with the same metric code the Lab uses. Rates show numerator/denominator; intervals are 95% Wilson.
            </p>
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Recorded results by method (scrolls horizontally on small screens)">
              <table className={`${styles.table} ${styles.nowrap}`}>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>
                      Method
                    </th>
                    <th scope="colgroup" colSpan={4} className={styles.groupHead}>
                      False arrivals
                    </th>
                    <th scope="col" rowSpan={2}>
                      Completion, all 7
                    </th>
                    <th scope="col" rowSpan={2}>
                      Mean path
                    </th>
                  </tr>
                  <tr>
                    <th scope="col">All 7</th>
                    <th scope="col">95% CI</th>
                    <th scope="col">Original 6</th>
                    <th scope="col">Photo board</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.variant}>
                      <th scope="row">{r.label}</th>
                      <td className="mono">{rateText(r.all.falseArrivalRate)}</td>
                      <td className="mono">{ciText(r.all.falseArrivalRate)}</td>
                      <td className="mono">{rateText(r.original6.falseArrivalRate)}</td>
                      <td className="mono">{rateText(r.postHoc.falseArrivalRate)}</td>
                      <td className="mono">{rateText(r.all.completionRate)}</td>
                      <td className="mono">{r.all.meanPathLength.toFixed(1)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul>
              <li>
                The difference in false arrivals against the tuned single-frame baseline comes entirely from <code>photo-board-decoy</code>, added after
                calibration v1 (see the chronology below). On the six original scenarios both have none.
              </li>
              <li>SureStop pays for re-observation in path length and frames; abstention (UNRESOLVED) did not occur on held-out seeds for any method.</li>
              <li>Twenty seeds per scenario and method, our own decoys, one layout: the intervals are wide and the results are preliminary.</li>
            </ul>
          </section>

          <section id="changes">
            <h2>Chronology and changes made after the first calibration run</h2>
            <ol className={styles.chrono} aria-label="Development and experiment chronology, 19 October 2026 (UTC)">
              {CHRONOLOGY.map((c) => (
                <li key={c.what} data-kind={c.kind ?? "base"}>
                  <span className={styles.chronoWhen}>{c.when}</span>
                  <span className={styles.chronoWhat}>{c.what}</span>
                  <span className={styles.chronoDetail}>{c.detail}</span>
                </li>
              ))}
            </ol>
            <p>
              Calibration v1 (seeds 101–110, commit 2c5200c; summary in <code>docs/experiments/calibration-v1-summary.json</code>) was used for debugging as
              well as threshold selection. Three changes followed; the held-out evaluation seeds were not run until after them.
            </p>
            <ul>
              <li>
                <b>Planner rings 1.6/2.0 m → 1.9/2.2 m, confirm range 2.2 → 2.5 m.</b> At 1.6 m the bottom of the camera view (floor 1.43 m ahead) cut off the
                plant, so most verification views were truncated and inconclusive.
              </li>
              <li>
                <b>New rule: REJECTED “not reproducible”</b> after {s.requiredMisses} distinct planned viewpoints with line of sight fail to re-detect the
                candidate (and none supports it). Before, a one-off weak detection could only end UNCONFIRMED.
              </li>
              <li>
                <b>New scenario <code>photo-board-decoy</code>.</b> In v1, seen from the search route, our prints and displays never scored above 0.78,
                while the real plant’s best score per encounter in single-frame runs was 0.87–0.99 (49 of 50 encounters ≥ 0.9). So a single-frame threshold
                of 0.9 separated them and matched SureStop. Closer views score higher: when the persistence baseline stepped towards them, v1 prints reached
                0.95 and displays 0.99. Real decoys need not be that weak, so we added a life-size photo board. In a 9-view probe it scored 0.96–0.99 in 5 of
                6 views within 30° of its normal (<code>docs/feasibility/report-wasm-board.json</code>). In held-out single-frame runs its best score per
                encounter was 0.87–0.99 (median 0.97). This scenario was added because of what v1 showed; it also moved the selected persistence threshold
                from 0.6 to 0.8. Results are reported both with and without it.
              </li>
            </ul>
          </section>

          <section id="sensing">
            <h2>Sensing model</h2>
            <ul>
              <li>Camera: 640×480, 50° vertical FOV, 1.0 m high, pitched −10°, fixed to the robot.</li>
              <li>
                Depth: rendered linear depth along the optical axis, pixel-aligned with the RGB frame (validated against ray casting: median error 0.08 mm).
                Noise σ(z) = {mm(DEFAULT_DEPTH_NOISE.sigma0)} + {DEFAULT_DEPTH_NOISE.k}·z² m per pixel, independent per pixel (real sensors have
                correlated noise), returns beyond {DEFAULT_DEPTH_NOISE.maxRange} m dropped, transmissive glass not returned.
              </li>
              <li>Detector: COCO-SSD 2.2.3 lite_mobilenet_v2; WebGL on hardware GPUs, WASM when WebGL is software-rendered (same scores).</li>
            </ul>
          </section>

          <section id="prior">
            <h2>Prior work and the boundary of this contribution</h2>
            <p>
              Verifying a goal before stopping, using depth or geometry, persistence filters and active re-observation are all established ideas; we claim none
              of them as novel. What this prototype tests is narrower: on our own decoy scenarios, does flat-surface depth evidence from distinct viewpoints, with
              bounded re-observation and explicit abstention, reduce false arrivals relative to single-frame and persistence stop rules, and at what cost?
            </p>
            <ul>
              <li>
                <b>VLFM</b>: Yokoyama et al., “VLFM: Vision-Language Frontier Maps for Zero-Shot Semantic Navigation”, ICRA 2024, MIT licence (README read for
                this build). The team’s deck reports, from reading the code, that the goal is set from a single detection above a fixed score and the agent
                stops within 0.9 m; that detail is not stated in the README and was not re-verified here. Our single-frame baseline follows that description.
              </li>
              <li>
                <b>PSG-Nav</b> (ICML 2026, proceedings.mlr.press/v306/chen26i.html) and <b>Uncertainty-Informed Active Perception for Open Vocabulary Object
                Goal Navigation</b> (arXiv:2506.13367): relevant work on false goal detection and uncertainty-driven re-observation. Neither page was reachable
                from this build environment, so we make no claims about their methods or results and do not compare against them.
              </li>
              <li>We have not reproduced any of these systems and claim no superiority over them.</li>
            </ul>
          </section>

          <section id="limits">
            <h2>Limitations and known failure modes</h2>
            <ul>
              <li>
                <b>3-D look-alikes:</b> a vase of flowers is labelled “potted plant” by COCO-SSD in many views; it is volumetric, so depth evidence cannot reject
                it. The look-alike scenario exists to show this failure honestly. <code>surestop</code> still fails seed 123. The experimental identity check
                (above) prevents it on the development matrix, but not for look-alikes that the detector never names as a confusable class.
              </li>
              <li>Transparent targets, pictures on curved or relief surfaces, and wall corners can break the flatness cue (the two-plane check mitigates corners).</li>
              <li>Distinct viewpoints are not statistically independent; vote counts are not probabilities.</li>
              <li>Simulation only: one floor layout, scenarios and decoys designed by us, small trial counts; results are preliminary.</li>
              <li>
                <b>Idealised map and route:</b> navigation uses a prior occupancy map and perfect odometry. That map contains the footprints of the candidate
                objects themselves, and the fixed search route was written knowing where the object slots are. No dynamic obstacles or people; no safety
                claims.
              </li>
              <li>
                <b>Abstention not validated on held-out seeds:</b> no held-out mission ended UNRESOLVED, so how often SureStop abstains on new seeds is
                unknown. The path is covered by unit tests and occurred in calibration v1.
              </li>
              <li>
                <b>Weak persistence baseline:</b> it engages every candidate at the {m.detectionFloor} floor, its close approach steps raise decoy scores
                (prints up to 0.95, displays up to 0.98 in held-out frames), and {m.persistence.maxConsecutiveMisses} consecutive frames below τ reject a
                candidate permanently (24 of 99 real-plant candidates). It is one simple design; its results do not generalise to persistence methods.
              </li>
              <li>
                <b>Asymmetric effort:</b> SureStop’s planner and decision rules were revised after inspecting calibration v1 on the calibration seeds; the
                baselines only had a threshold sweep. Ground truth is scored by a separate evaluator module written by the same team, not by an independent
                party.
              </li>
              <li>Detector scores may differ slightly across GPUs and browsers; recorded runs list the backend used.</li>
            </ul>
          </section>

          <section id="repro">
            <h2>Reproduce</h2>
            <ul>
              <li>
                Any trial: open Mission Control with the same scenario, seed and method and the “Recorded evaluation (v1)” world layout (the Lab’s “Replay” link
                fills these in). Mission Control otherwise starts on the seeded v2 layout, which no recorded result used.
              </li>
              <li>A batch: Verification Lab → Run an experiment; export CSV/JSON.</li>
              <li>
                Headless batches: build with the experiment harness enabled (<code>npm run build:diagnostics</code>), start the server, then run{" "}
                <code>scripts/missions.mjs</code> with an explicit scenario, seed and method list. The exact commands used for calibration v2 and the
                held-out evaluation are in the README (“Reproduce experiments”) and <code>docs/experiments/raw/MANIFEST.md</code>.
              </li>
            </ul>
          </section>
        </article>
      </main>
    </>
  );
}
