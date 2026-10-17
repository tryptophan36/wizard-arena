import ArenaShell from "@/components/ArenaShell";
import { Suspense } from "react";

export default function PracticePage() {
  return <Suspense fallback={<main className="arena-shell arena-practice" aria-busy="true" />}><ArenaShell mode="practice" /></Suspense>;
}
