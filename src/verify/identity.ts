// Identity-conflict evidence (experimental, opt-in: method "surestop-identity"). A detection of a class
// that is a plausible alternative identity for the same object, localised at a candidate's position,
// contradicts the candidate's target-class detections. Repeated target-class labels plus volumetric
// geometry do not establish identity when the detector itself also names the object as something else.
// Robot-facing: inputs are detector classes, scores, boxes and depth back-projections only.

/**
 * COCO classes that are plausible alternative identities for a target class. One entry, chosen from the
 * diagnosed development failure (docs/experiments/identity-conflict/DESIGN.md): COCO-SSD labels a vase
 * holding flowers "potted plant" in some views and "vase" in others. Supporting surfaces (tables,
 * shelves) are deliberately absent: an object standing on them is not a conflict.
 */
export const CONFUSABLE_CLASSES: Readonly<Record<string, readonly string[]>> = {
  "potted plant": ["vase"],
};

export function confusableClasses(targetClass: string): readonly string[] {
  return CONFUSABLE_CLASSES[targetClass] ?? [];
}
