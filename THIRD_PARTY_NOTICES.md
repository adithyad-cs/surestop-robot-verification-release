# Third-party notices

**Project licence:** the SureStop source code has **no project licence yet**. The owners have not
chosen one. Until they do, no reuse rights are granted for the project's own code. The
third-party material below stays under its own licences.

Full licence texts are in [`LICENSES/`](LICENSES/):

| File | Contents |
|---|---|
| `Apache-2.0.txt` | Apache License 2.0, from https://www.apache.org/licenses/LICENSE-2.0.txt (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`). Byte-identical to the `LICENSE` in the TensorFlow.js repository |
| `OFL-1.1-Geist.txt` | SIL Open Font License 1.1 with the Geist copyright line, copied from the `geist` 1.8.1 package |
| `MIT-bundled-libraries.txt` | The MIT licence files of the JavaScript libraries bundled into the app, copied from `node_modules` |

## 3-D assets: Khronos glTF Sample Assets

- **Source:** https://github.com/KhronosGroup/glTF-Sample-Assets
- **Files:** `public/assets/models/`, unmodified.
- **Licences:** CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) and CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/).

| File | Licence | Attribution |
|---|---|---|
| DiffuseTransmissionPlant.glb | CC0-1.0 (original asset) + CC-BY-4.0 (materials) | Original by Rico Cilliers (CC0); materials © 2024 Eric Chadwick / Darmstadt Graphics Group GmbH, CC BY 4.0 |
| GlassVaseFlowers.glb | CC0-1.0 | Eric Chadwick (vase), Rico Cilliers (flowers) |
| SheenChair.glb | CC0-1.0 | Eric Chadwick / Wayfair, LLC |
| ChairDamaskPurplegold.glb | CC-BY-4.0 | © 2021 Eric Chadwick / Wayfair, CC BY 4.0 |
| GlamVelvetSofa.glb | CC-BY-4.0 | © 2021 Eric Chadwick / Wayfair, LLC, CC BY 4.0 |
| SpecularSilkPouf.glb | CC-BY-4.0 | © 2023 Eric Chadwick / Wayfair, LLC, CC BY 4.0 |

**Images derived from the plant.** The poster, display and photo-board images seen in the
simulation, and the landing-page frames in `public/media/`, are renders of
`DiffuseTransmissionPlant.glb` produced by this app. They are derived from that asset and
carry its attribution.

**Phase A assets that are not shipped.** The Phase A feasibility study also rendered
`SheenWoodLeatherSofa.glb` (CC0 original; CC-BY-4.0 improvements by Eric Chadwick / Darmstadt
Graphics Group) and `CommercialRefrigerator.glb` (CC-BY-4.0; Sean Thomas, Eric Chadwick /
Darmstadt Graphics Group). Their results are in `docs/feasibility/`. The files themselves were
never committed, are not redistributed, and are no longer referenced by the asset registry.

## Detector: TensorFlow.js COCO-SSD

- `@tensorflow-models/coco-ssd` 2.2.3, Apache-2.0 (https://github.com/tensorflow/tfjs-models).
- The weights in `public/models/coco-ssd/lite_mobilenet_v2/` are the unmodified
  `ssdlite_mobilenet_v2` TF.js graph model published by the TensorFlow.js team at
  `https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/`, distributed
  under Apache-2.0.
- `public/tfjs-wasm/*.wasm` are the unmodified binaries from `@tensorflow/tfjs-backend-wasm`
  4.22.0, Apache-2.0.
- TensorFlow.js 4.22.0 (`tfjs-core`, `tfjs-converter`, `tfjs-backend-cpu`, `tfjs-backend-webgl`,
  `tfjs-backend-wasm`), Apache-2.0, © Google LLC.
- Bundled helpers under Apache-2.0: `long` 4.0.0 and `@swc/helpers`.
- Full licence text: `LICENSES/Apache-2.0.txt`. The `tensorflow/tfjs` and
  `tensorflow/tfjs-models` repositories have no `NOTICE` file (checked 2026-10-20).

## Fonts

- Geist Sans and Geist Mono, from the `geist` 1.8.1 package. Copyright (c) 2023 Vercel, in
  collaboration with basement.studio.
- Licensed under the SIL Open Font License 1.1 (`LICENSES/OFL-1.1-Geist.txt`).
- The fonts are bundled, unmodified, into the build by `next/font`.

## Libraries bundled into the web app

| Library | Licence |
|---|---|
| three.js 0.186.1 | MIT, © three.js authors |
| React and React DOM 19.2.9, scheduler | MIT, © Meta Platforms, Inc. and affiliates |
| Next.js 16.3.8 runtime | MIT, © Vercel, Inc. |
| styled-jsx | MIT |
| seedrandom 3.0.5 | MIT, © David Bau |
| TensorFlow.js, `long`, `@swc/helpers` | Apache-2.0 (see above) |

The MIT licence texts are in `LICENSES/MIT-bundled-libraries.txt`. Development-only tools
(ESLint, TypeScript, Vitest, Playwright, esbuild) are not distributed with the app; see
`package.json` and `package-lock.json`.
