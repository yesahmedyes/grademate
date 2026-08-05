import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Cycle of pastel accent pairs used for class cards, icon tiles, bars. */
export const ACCENTS = [
  { text: "text-coral", bg: "bg-coral", soft: "bg-coral-soft", border: "border-coral/40" },
  { text: "text-sky", bg: "bg-sky", soft: "bg-sky-soft", border: "border-sky/40" },
  { text: "text-butter", bg: "bg-butter", soft: "bg-butter-soft", border: "border-butter/40" },
  { text: "text-leaf", bg: "bg-leaf", soft: "bg-leaf-soft", border: "border-leaf/40" },
  { text: "text-lilac", bg: "bg-lilac", soft: "bg-lilac-soft", border: "border-lilac/40" },
] as const;

export function accentFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** A tiny concurrency limiter (avoids the ESM-only p-limit dep). */
export function limiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
