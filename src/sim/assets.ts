// Catalogue of third-party 3D assets. `groundTruthClass` is evaluator/scenario-side
// metadata only. Robot-facing modules (perception, verify, baselines) must never import it.

export interface AssetSpec {
  id: string;
  url: string;
  /** Height (m) the model is scaled to, measured floor to top. */
  height: number;
  /** Rotation about +Y applied after load so that the model's "front" faces +Z. */
  yaw?: number;
  groundTruthClass: string;
  title: string;
  licence: string;
  attribution: string;
  source: string;
}

// Not shipped: the Phase A feasibility study (docs/feasibility, PERCEPTION_FEASIBILITY.md) also
// rendered SheenWoodLeatherSofa and CommercialRefrigerator, from local copies of the Khronos
// glTF Sample Assets that were never committed. WaterBottle and DiffuseTransmissionTeacup
// were downloaded but not used. To re-run those rows, download the models from
// https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models (CC0 / CC-BY 4.0; see
// THIRD_PARTY_NOTICES.md) into public/assets/models/ and add entries here.

const KHRONOS = "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models";

export const ASSETS: Record<string, AssetSpec> = {
  plant: {
    id: "plant",
    url: "/assets/models/DiffuseTransmissionPlant.glb",
    height: 0.95,
    groundTruthClass: "potted plant",
    title: "Diffuse Transmission Plant",
    licence: "CC0-1.0 (original asset) + CC-BY-4.0 (materials)",
    attribution: "Rico Cilliers (original, CC0); Eric Chadwick / Darmstadt Graphics Group (materials, CC-BY 4.0)",
    source: `${KHRONOS}/DiffuseTransmissionPlant`,
  },
  vaseFlowers: {
    id: "vaseFlowers",
    url: "/assets/models/GlassVaseFlowers.glb",
    height: 0.6,
    groundTruthClass: "vase",
    title: "Glass Vase with Flowers",
    licence: "CC0-1.0",
    attribution: "Eric Chadwick (vase), Rico Cilliers (flowers)",
    source: `${KHRONOS}/GlassVaseFlowers`,
  },
  sheenChair: {
    id: "sheenChair",
    url: "/assets/models/SheenChair.glb",
    height: 0.69,
    groundTruthClass: "chair",
    title: "Sheen Chair",
    licence: "CC0-1.0",
    attribution: "Eric Chadwick / Wayfair, LLC",
    source: `${KHRONOS}/SheenChair`,
  },
  damaskChair: {
    id: "damaskChair",
    url: "/assets/models/ChairDamaskPurplegold.glb",
    height: 0.69,
    groundTruthClass: "chair",
    title: "Chair Damask Purplegold",
    licence: "CC-BY-4.0",
    attribution: "Eric Chadwick / Wayfair",
    source: `${KHRONOS}/ChairDamaskPurplegold`,
  },
  velvetSofa: {
    id: "velvetSofa",
    url: "/assets/models/GlamVelvetSofa.glb",
    height: 0.79,
    groundTruthClass: "couch",
    title: "Glam Velvet Sofa",
    licence: "CC-BY-4.0",
    attribution: "Eric Chadwick / Wayfair, LLC",
    source: `${KHRONOS}/GlamVelvetSofa`,
  },
  pouf: {
    id: "pouf",
    url: "/assets/models/SpecularSilkPouf.glb",
    height: 0.42,
    groundTruthClass: "pouf (no COCO class)",
    title: "Specular Silk Pouf",
    licence: "CC-BY-4.0",
    attribution: "Eric Chadwick / Wayfair, LLC",
    source: `${KHRONOS}/SpecularSilkPouf`,
  },
};
