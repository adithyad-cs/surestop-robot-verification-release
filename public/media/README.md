Frames captured from a real SureStop mission in this app via `scripts/console-shot.mjs`
(scenario `photo-board-decoy`, held-out seed 1001, method `surestop`, WASM backend, 2026-10-19).
Boxes are the actual COCO-SSD outputs on those pixels; the depth images are the simulated range
sensor with its noise model; the dashed box is the region sampled for evidence.
- frame-board*.jpg: frame 2, candidate C1 (life-size photo board), score 0.97, relief 0 mm → FLAT.
- frame-plant*.jpg: frame 28, candidate C2 (3-D plant), score 0.98, relief 164 mm → VOLUMETRIC.
