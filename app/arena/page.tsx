import ArenaShell from "@/components/ArenaShell";
import { Suspense } from "react";

export default function ArenaPage() {
  return <Suspense fallback={<main className="arena-shell" aria-busy="true" />}><ArenaShell /></Suspense>;
}
