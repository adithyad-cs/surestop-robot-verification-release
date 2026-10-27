#!/usr/bin/env bash
# Downloads the extra Khronos glTF sample assets used only by the Phase A feasibility
# matrix (they are not shipped with the app). CC0 / CC-BY-4.0, see src/sim/assets.ts.
set -euo pipefail
cd "$(dirname "$0")/../public/assets/models"
for m in CommercialRefrigerator WaterBottle DiffuseTransmissionTeacup SheenWoodLeatherSofa; do
  [ -f "$m.glb" ] || curl -fsSL -o "$m.glb" "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/$m/glTF-Binary/$m.glb"
done
echo "optional assets present"
