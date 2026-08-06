"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

/**
 * Immediate click feedback for a <Link>. Must be rendered as a descendant of the
 * Link it reports on — useLinkStatus reads the navigation state from it.
 * Swaps in a spinner while the destination's RSC payload is in flight.
 */
export function LinkPending({
  children,
  size = 16,
  className,
}: {
  children: React.ReactNode;
  size?: number;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 size={size} className={`animate-spin ${className ?? ""}`} /> : <>{children}</>;
}
