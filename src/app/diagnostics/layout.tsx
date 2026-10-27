import { notFound } from "next/navigation";

// Internal harnesses for batch experiments (/diagnostics/mission) and the Phase A perception
// study (/diagnostics/perception). They are not part of the public app: a production build
// includes them only when built with SURESTOP_DIAGNOSTICS=1 (see README, "Reproduce
// experiments"). `next dev` always serves them.
export default function DiagnosticsLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.SURESTOP_DIAGNOSTICS !== "1") notFound();
  return children;
}
