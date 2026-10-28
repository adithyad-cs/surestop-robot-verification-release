# SureStop: final demo handoff (Hack in Hills 2026)

Presenter sheet for a 2–3 minute live demonstration. The detailed script with the expected text
of every step is `docs/DEMO.md`.

**Rehearsal.** Every observation below was produced on a clean production build of `4cfe8a7`
(2026-10-27). It was produced by driving the real UI with `scripts/dev/rehearse-demo.mjs`, plus
`scripts/dev/demo-url-check.mjs` for link typos. The step records (`rehearsal.json`,
`url-typo-check.jsonl`) and ten screenshots are in `docs/demo/rehearsal/`.

## 1. The problem (opening, about 20 s)

A robot told "go to the potted plant" stops as soon as its detector says "potted plant". Detectors
are fooled by pictures of plants and by look-alikes, and then the robot reports arrival at the wrong
object.

SureStop refuses to declare arrival until it has checked the candidate from more than one
viewpoint, using depth. It holds back when the evidence stays insufficient.

Everything here runs in the browser:

- a simulated robot in a Three.js room;
- a real COCO-SSD detector on the pixels the robot's camera renders;
- a separate evaluator that knows the ground truth and scores the mission only after it ends.

## 2. Script (2–3 minutes)

| Time | Action | Say |
|---|---|---|
| 0:00 | Problem statement (§1) | — |
| 0:20 | **A.** Open link A, choose **Max**, then **Run mission** (about 30–60 s) | "This is our multi-view verifier. The vase of flowers is labelled 'potted plant'. It is 3-D, so depth says volumetric, and SureStop confirms it." Point to **C1 CONFIRMED**, then scroll the left panel to the Evaluator: **False arrival**. |
| 1:00 | **B.** Open link B, choose **Max**, then **Run mission** | "Same world, plus the identity-conflict check. In frame 11 the detector also called this object 'vase', 0.46 m away, so confirmation is withheld." Point to **C1 UNCONFIRMED**, then **C2 CONFIRMED**, then **Correct arrival**. |
| 1:40 | In B, select **C1**, then **#11** in *Identity conflicts* | "Every decision traces to a frame. This is frame 11 with the vase box. The amber marker and *Pose at #11* show where the robot stood when it took the frame, not where it is now." |
| 2:10 | **C.** Open link C (single-frame), choose **Max**, then **Run mission**. Then **Reset**, choose *SureStop + identity-conflict check* in **Stopping method**, and **Run mission** again | "A one-frame threshold stops at a life-size photo of a plant. SureStop sees the same board, measures it flat from two viewpoints, rejects it, and finds the real plant." Point to **C1 REJECTED** and **Correct arrival**. |
| 2:50 | Close (§8) | "Development evidence, not validation." |

If time is short, drop C. A and B carry the story.

## 3. Routes and controls

The base URL is `http://localhost:3000` after `npm start`.

| | Link |
|---|---|
| A | `/console?scenario=lookalike-3d&seed=123&method=surestop&layout=v2` |
| B | `/console?scenario=lookalike-3d&seed=123&method=surestop-identity&layout=v2` |
| C | `/console?scenario=photo-board-decoy&seed=17&method=single-frame&layout=v2`, then switch to `surestop-identity` |

**Before every run, check the setup panel.** A mistyped `method` or `scenario` value is silently
replaced by a default (rehearsed: §9).

- The **Scenario** must read *3-D look-alike (known limitation)* for A and B, and *Life-size photo
  board first* for C.
- The **Stopping method** must be the one you intend.
- The layout id under **World layout** must be `v2-04a6cf82` for A and B, and `v2-60cecb85` for C.

**Controls (left panel):**

- **Playback:** *Max* skips the animation.
- **Run mission**; after a mission it becomes **Run again**, which rebuilds the same world and
  repeats it.
- **Step**.
- **Reset** clears the mission without starting one.
- **Candidates:** click a candidate to show its reason, evidence table and identity conflicts.
- **Frame links:** `#N` buttons, and the **‹ ›** buttons of the frame strip.

**The page scrolls.** Clicking a candidate or a frame link can scroll the whole page (screenshot
`B-identity-seed123-frame11-capture-pose.png`). The Evaluator is below the fold at 1440×900. Scroll the
left panel down to show it, and scroll back up to show the amber capture-pose marker in full.

**Other pages:**

- `/method`: the policy, the development matrix and the limitations.
- `/lab`: the recorded held-out results of the original `surestop` method.

## 4. What viewers should see

Each line was observed in the rehearsal (simulated time is shown in *Sim time*).

**A. `surestop`, seed 123** (sim time 47.9 s, 19 frames):

- C1 is **CONFIRMED**: "volumetric evidence from 2 distinct viewpoints, no flat evidence".
- The outcome is **ARRIVED**: "arrived 0.90 m from candidate C1 after CONFIRMED".
- The Evaluator reads **False arrival**: "C1 → vase with flowers (lookalike, CONFIRMED)".
- **Run again** gave the identical result. **Reset** returned to READY with 0 frames and no
  candidates.

**B. `surestop-identity`, seed 123** (69.3 s, 29 frames):

- C1 is **UNCONFIRMED**: `identity conflict: the detector also reported "vase" (0.57) 0.46 m from
  this candidate (frame 11); confirmation withheld (0 volumetric views so far)`.
- C2 is **CONFIRMED** from 2 volumetric viewpoints.
- The outcome is **ARRIVED** at C2, and the Evaluator reads **Correct arrival**.
- *Identity conflicts* shows `#11 "vase" 0.57 at 0.46 m · withheld confirmation`. Clicking `#11`:
  - shows *Robot camera frame 11*;
  - shows *Pose at #11*: `x -5.40 z -2.40 θ -30° (capture)`, next to *Pose (now)*:
    `x 4.00 z 0.86 θ 164°`;
  - lists the frame's conflict.

  Stepping to the newest frame removes the capture-pose row.

**C. Photo board, seed 17:**

- **Single-frame** (20.8 s, 7 frames): C1 is **CONFIRMED**, "detector score 0.93 ≥ 0.9". The
  outcome is **ARRIVED**, and the Evaluator reads **False arrival**: "life-size photo board of a
  potted plant".
- **`surestop-identity`**, chosen in the dropdown (90.0 s, 28 frames):
  - C1 is **REJECTED**: "flat-surface evidence from 2 distinct viewpoints, no volumetric evidence".
    Its evidence table shows frames #6 and #7 at scores 0.98 and 0.99, relief 0 mm, verdict *flat*.
  - C2 is **CONFIRMED**, and the Evaluator reads **Correct arrival**.

## 5. What is real and reproducible

- **Real:** the detector really runs on rendered pixels in the browser, and the decisions shown are
  the verifier's. The Evaluator panel is ground truth, shown only after the mission, and never an
  input to the robot or verifier.
- **Deterministic:** for a given build, layout and seed the same world gives the same mission.
  - **Re-runs:** the 12 demo-world missions were re-run at the freeze and were identical to the
    recorded matrix (`docs/experiments/identity-conflict/results/demo-check.json.gz`).
  - **Rehearsal:** it reproduced A, B and C again on `4cfe8a7`.
  - **Browser tests:** A and B are also asserted by `tests/e2e/identity.spec.ts`.
- **Hardware:** scores can differ slightly on other GPUs or browsers. Rehearse on the demo machine.

**Development matrix** (`docs/experiments/identity-conflict/REPORT.md`): 294 missions = 7 scenarios
× 14 development seeds × 3 methods, layout v2.

| Method | False arrivals | Correct arrivals (target present) | Median sim time |
|---|---|---|---|
| Single-frame (τ 0.9) | 13/98 | 45/84 | 77.6 s |
| SureStop | 1/98 | 83/84 | 93.7 s |
| SureStop + identity-conflict check | 0/98 | 84/84 | 89.2 s |

Exactly one of the 98 paired worlds changed between the two SureStop variants: seed 123, from a false
arrival to a correct one. The 95 % intervals overlap, so **the difference is not statistically
established.**

## 6. How the identity-conflict rule works

The rule uses only the detector's own outputs, depth and the robot's pose. There is no ground truth,
object identifier, seed or scene rule.

1. A candidate opens when COCO-SSD reports "potted plant" ≥ 0.30 with valid depth.
2. The detector sometimes names the same object as a confusable class. The table has exactly one
   entry: `potted plant → vase`.
   - Each such detection (score ≥ 0.30, valid depth) is localised exactly like a target detection:
     depth back-projected from the robot's pose.
   - If it lands within the 0.9 m association gate of a pending candidate, from any frame (even one
     before the candidate opened), confirmation is **withheld**.
3. The candidate ends **UNCONFIRMED**, never REJECTED, and the search continues to the next candidate.

It depends on one localised "vase" detection. If the detector never calls the look-alike "vase",
the rule does nothing.

## 7. Trade-off: observations and time

Verification costs extra viewpoints and time.

- **Pooled medians:**
  - single-frame 77.6 s, 28.3 m path;
  - SureStop 93.7 s, 33.4 m;
  - SureStop + identity 89.2 s, 31.5 m.
- **Verification frames per mission:** 3.58 for SureStop, 3.17 with the identity check, because a
  withheld vase is no longer re-observed until the viewpoint budget runs out.
- **In the demo worlds:**
  - seed 123: the baseline arrives wrongly at 47.9 s; the identity check arrives correctly at 69.3 s,
    after continuing the search;
  - photo board: single-frame arrives wrongly at 20.8 s; SureStop arrives correctly at 90.0 s.
- **The cost of the rule:** a false "vase" detection near a genuine plant would withhold that plant.
  In the matrix, 0 of 84 genuine plants were withheld.

## 8. Limitations and what not to claim

**Say:** "development evidence on a simulator, on worlds we saw while developing."

**Limitations:**

- one vase asset and one plant asset;
- development seeds only;
- the class table has a single pair, chosen from this very failure;
- detection gaps:
  - the screen decoy became a candidate in only 5 of 14 screen-decoy worlds, and the poster in 11 of
    14;
  - in poster-decoy seed 42 and screen-decoy seeds 2 and 17 it never became one, so **never use
    those worlds as rejection examples.**

**Do not claim:**

- scientifically validated reliability;
- statistical significance;
- generalisation to unseen object families;
- a general semantic-identity system;
- universal decoy rejection;
- zero false arrivals in all circumstances;
- physical-robot readiness;
- any ROS 2, Nav2 or Gazebo integration;
- public deployment or GitHub publication.

The scientific evaluation gate remains **BLOCKED**.

## 9. Setup and recovery

**Setup** (rehearsed on Node 22.22, npm 10.9):

```
npm ci                 # installs from the lockfile; no network model download at runtime
npm run build
npm start              # http://localhost:3000
```

- **Browser:** a desktop browser with WebGL2.
- **Assets:** the detector weights (about 18 MB) and the 3-D assets are served locally from `public/`.
- **Before presenting:** open each link once to warm the browser cache, and run A once.

**Recovery.** Only behaviour observed in the rehearsal is listed.

| Situation | What the console does (observed) | What to do |
|---|---|---|
| A run behaves oddly mid-mission | After a page reload it returns to READY with 0 frames and the same method. Re-running gave the recorded result (B: Correct arrival) | Reload the page, then **Run mission** |
| You want to show a run again | **Run again** reproduced A identically; **Reset** returns to READY | Use either button |
| The detector weights cannot be fetched | Error box "Something failed — Failed to fetch … No simulated or fake output is substituted", with a **Reload** button. No mission can start | Check that the server is running (`npm start`) and that `public/models` is present, then reload. Not rehearsed: recovery within the same page after the network returns |
| A bad `layout` value (e.g. `layout=v9`) | Error box "Unknown world layout "v9". Use layout=v1 … or layout=v2" | Fix the link |
| A mistyped method or scenario | It is silently replaced: a bad `method` → *SureStop + identity-conflict check*; a bad `scenario` → *Picture decoy first*; no `layout` → the v1 layout with a notice | Check the setup panel and layout id before running (§3) |
| An unknown route | HTTP 404 page | Use the top navigation |

**Not rehearsed:** a browser without WebGL2 (the console shows an "Unsupported browser" box by
design), Pause/Resume and Abort, and slow machines.

## Post-handoff update (2026-10-28)

This sheet was frozen on 2026-10-27, before publication and deployment. Its text above is kept
unchanged. Since then:

- **GitHub.** The release is published at
  https://github.com/adithyad-cs/surestop-robot-verification-release (commit `b4dcc25`). The §8
  item "GitHub publication" in *Do not claim* is therefore out of date: publication is a fact.
- **Hosted demo.** It is at https://surestop-robot-verification-release.vercel.app/. To use it, put
  that base URL in front of the §3 paths instead of `http://localhost:3000`.
  - **Team-reported:** the team reported live QA on 27 October 2026, in which run A falsely arrived
    at the vase and run B withheld it and reached the real plant.
  - **Not independently verified:** the 2026-10-28 documentation update could not reach the host
    from its environment.
- **Still do not claim** that the hosted build is verified to match the commit. Its build
  provenance reports `sourceDirty: true`, with an unknown cause (see `BUILD_STATUS.md`,
  "Deployment").
  - Say instead: "a hosted demo is available; its build provenance has an open warning."
- **Before presenting on the hosted demo,** check the method, scenario and layout id in the setup
  panel, as in §3.
- **Recovery (§9):** "Check that the server is running (`npm start`)" applies only to a local
  build. On the hosted demo, reload the page; if the model still cannot be fetched, switch to a
  local production build.
