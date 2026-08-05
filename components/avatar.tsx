"use client";

import { useState } from "react";
import { accentFor, cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const accent = accentFor(name);
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // Google avatar URLs live on lh3.googleusercontent.com — plain img avoids next/image host config.
      // referrerPolicy="no-referrer" is required: Google user-content returns 403/429 when a
      // cross-origin Referer header is sent, which otherwise leaves every avatar broken.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("rounded-full object-cover ring-2 ring-white", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-navy ring-2 ring-white select-none",
        accent.soft,
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </span>
  );
}
