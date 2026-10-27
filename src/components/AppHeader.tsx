"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppHeader.module.css";

const NAV = [
  { href: "/console", label: "Mission Control" },
  { href: "/lab", label: "Verification Lab" },
  { href: "/method", label: "Method" },
];

export default function AppHeader({ status }: { status?: React.ReactNode }) {
  const path = usePathname();
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="SureStop home">
        <span className={styles.mark} aria-hidden="true" />
        <span>SureStop</span>
      </Link>
      <nav aria-label="Primary" className={styles.nav}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={styles.link} aria-current={path === n.href ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className={styles.status}>{status}</div>
    </header>
  );
}
