import styles from "./StatusBadge.module.css";

const GLYPH: Record<string, string> = {
  CONFIRMED: "●",
  REJECTED: "✕",
  UNCONFIRMED: "◌",
  PENDING: "…",
  ARRIVED: "●",
  NOT_FOUND: "○",
  UNRESOLVED: "◌",
  NAV_FAILURE: "!",
  ABORTED: "■",
  VOLUMETRIC: "▲",
  FLAT: "▬",
  INCONCLUSIVE: "?",
};

const TONE: Record<string, string> = {
  CONFIRMED: "good",
  ARRIVED: "good",
  VOLUMETRIC: "good",
  REJECTED: "bad",
  FLAT: "bad",
  NAV_FAILURE: "bad",
  PENDING: "warn",
  UNCONFIRMED: "warn",
  UNRESOLVED: "warn",
  INCONCLUSIVE: "warn",
};

export default function StatusBadge({ status, title }: { status: string; title?: string }) {
  return (
    <span className={styles.badge} data-tone={TONE[status] ?? "neutral"} title={title}>
      <span aria-hidden="true">{GLYPH[status] ?? "·"}</span>
      {status.replace("_", " ")}
    </span>
  );
}
