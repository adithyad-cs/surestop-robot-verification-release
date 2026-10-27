#!/usr/bin/env python3
# Summarises a missions.mjs batch (final JSON or its .journal.jsonl) for the identity-conflict development
# comparison (docs/experiments/identity-conflict/DESIGN.md): counts with denominators per method and
# scenario, 95 % Wilson intervals on pooled mission proportions, paired outcome changes per world, and
# failure categories read from the evaluator fields. Development data only; never a confirmatory result.
# usage: python3 scripts/dev/identity-matrix.py <batch.json[.gz] | batch.json.journal.jsonl> [--json out.json]
import gzip
import json
import math
import statistics
import sys
from collections import Counter, defaultdict

METHODS = ["single-frame", "surestop", "surestop-identity"]
TARGET_PRESENT = {"clear-target", "poster-decoy", "screen-decoy", "occluded-target", "photo-board-decoy", "lookalike-3d"}
# Evaluator kinds of the non-target object each scenario is built around (REPORT.md §4.6a).
DECOY_KINDS = {"poster-decoy": {"picture-decoy"}, "screen-decoy": {"screen-decoy"}, "photo-board-decoy": {"picture-decoy"},
               "decoys-only": {"picture-decoy", "screen-decoy"}, "lookalike-3d": {"lookalike"}}


def load(path):
    if path.endswith(".jsonl"):
        runs = []
        failures = []
        for line in open(path):
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("type") == "run":
                runs.append(e["run"])
            elif e.get("type") == "failure":
                failures.append(e["failure"])
        return runs, failures
    d = json.load(gzip.open(path, "rt") if path.endswith(".gz") else open(path))
    return d["runs"], d.get("failures", [])


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def category(r):
    """One failure category per mission that did not end correctly (DESIGN.md §4)."""
    s, res = r["score"], r["result"]
    if s["correctArrival"] or (s["correctTerminal"] and not s["targetPresent"]):
        return None
    if res["outcome"] == "NAV_FAILURE":
        return "mission: navigation failure"
    if s["falseArrival"]:
        kind = s.get("arrivedAtKind")
        if kind == "lookalike":
            return "semantic: look-alike labelled as the target and confirmed"
        if kind in ("picture-decoy", "screen-decoy"):
            return "geometry: flat decoy confirmed as volumetric"
        return f"verification: arrived at {kind}"
    target_tracks = [t for t in s.get("trackLabels", []) if t.get("kind") == "target"]
    if s["targetPresent"] and not target_tracks:
        return "detection: target never became a candidate"
    if any(t["status"] == "REJECTED" for t in target_tracks):
        return "verification: genuine target REJECTED"
    if any(t["status"] == "UNCONFIRMED" for t in target_tracks):
        rules = {t.get("rule") for t in target_tracks}
        return "verification: genuine target UNCONFIRMED" + (" (identity conflict)" if "withhold-identity-conflict" in rules else "")
    if res["outcome"] == "UNRESOLVED":
        return "mission: unresolved without a target candidate decision"
    return f"mission: {res['outcome']} ({res.get('reason', '')[:60]})"


def main(argv):
    runs, failures = load(argv[0])
    by = defaultdict(list)
    for r in runs:
        # Join the rule of each target track for the categories.
        rules = {t["id"]: t["decision"].get("rule") for t in r["result"]["tracks"]}
        for t in r["score"].get("trackLabels", []):
            t["rule"] = rules.get(t["trackId"])
        by[(r["variant"], r["result"]["scenarioId"])].append(r)
    out = {"missions": len(runs), "failedMissions": len(failures), "perScenario": {}, "pooled": {}, "paired": {}, "categories": {}, "decoyExposure": {}}
    scenarios = sorted({k[1] for k in by})
    for m in METHODS:
        rows = [r for (v, _), rs in by.items() if v == m for r in rs]
        if not rows:
            continue
        tp = [r for r in rows if r["score"]["targetPresent"]]
        fa = sum(r["score"]["falseArrival"] for r in rows)
        ca = sum(r["score"]["correctArrival"] for r in tp)
        oc = Counter(r["result"]["outcome"] for r in rows)
        out["pooled"][m] = {
            "missions": len(rows),
            "falseArrivals": fa, "falseArrivalCI": wilson(fa, len(rows)),
            "targetPresent": len(tp), "correctArrivals": ca, "correctArrivalCI": wilson(ca, len(tp)),
            "outcomes": dict(oc),
            "unresolvedCI": wilson(oc.get("UNRESOLVED", 0), len(rows)),
            "medianSimTime": round(statistics.median(r["result"]["stats"]["simTime"] for r in rows), 2),
            "medianPath": round(statistics.median(r["result"]["stats"]["pathLength"] for r in rows), 2),
            "medianFrames": statistics.median(r["result"]["stats"]["frames"] for r in rows),
            "meanVerificationFrames": round(statistics.mean(r["result"]["stats"]["verificationFrames"] for r in rows), 2),
            # Variants of one world share the sensor's per-pose cache, so later variants reuse earlier
            # frames: per-method latency exists only where a method rendered uncached frames.
            "uncachedFrames": sum(1 for r in rows for f in r["result"]["frames"] if not f["cached"]),
            "withheldCandidates": sum(1 for r in rows for t in r["result"]["tracks"] if t["decision"].get("rule") == "withhold-identity-conflict"),
        }
        out["categories"][m] = dict(Counter(c for r in rows if (c := category(r))))
        # Did real perception ever make the decoy a candidate? A correct arrival without one tests nothing
        # about rejection.
        for sc, kinds in DECOY_KINDS.items():
            rs = by.get((m, sc), [])
            cands = [[t for t in r["score"].get("trackLabels", []) if t.get("kind") in kinds] for r in rs]
            out["decoyExposure"].setdefault(m, {})[sc] = {
                "n": len(rs), "missionsWithDecoyCandidate": sum(1 for c in cands if c),
                "decoyCandidates": sum(map(len, cands)), "statuses": dict(Counter(t["status"] for c in cands for t in c)),
            }
        for sc in scenarios:
            rs = by.get((m, sc), [])
            out["perScenario"].setdefault(sc, {})[m] = {
                "n": len(rs),
                "falseArrivals": sum(r["score"]["falseArrival"] for r in rs),
                "correctArrivals": sum(r["score"]["correctArrival"] for r in rs),
                "outcomes": dict(Counter(r["result"]["outcome"] for r in rs)),
            }
    # Paired changes, surestop → surestop-identity, on identical worlds (scenario, seed, layout id).
    key = lambda r: (r["result"]["scenarioId"], r["result"]["seed"], (r.get("layout") or {}).get("id"))
    base = {key(r): r for r in runs if r["variant"] == "surestop"}
    cand = {key(r): r for r in runs if r["variant"] == "surestop-identity"}
    changes = []
    for k in sorted(set(base) & set(cand), key=str):
        a, b = base[k], cand[k]
        ea = "correct" if a["score"]["correctArrival"] else "FALSE" if a["score"]["falseArrival"] else a["result"]["outcome"]
        eb = "correct" if b["score"]["correctArrival"] else "FALSE" if b["score"]["falseArrival"] else b["result"]["outcome"]
        if ea != eb:
            changes.append({"world": list(k), "surestop": ea, "surestop-identity": eb})
    out["paired"] = {"pairs": len(set(base) & set(cand)), "changed": changes}
    lat = [f["inferenceMs"] for r in runs for f in r["result"]["frames"] if not f["cached"]]
    out["detectorInferenceMs"] = {"uncachedFrames": len(lat), "median": round(statistics.median(lat), 1) if lat else None,
                                  "p95": round(sorted(lat)[int(0.95 * (len(lat) - 1))], 1) if lat else None}
    text = json.dumps(out, indent=1)
    if "--json" in argv:
        open(argv[argv.index("--json") + 1], "w").write(text + "\n")
    print(text)


if __name__ == "__main__":
    main(sys.argv[1:])
