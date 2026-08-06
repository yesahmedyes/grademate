import { cn } from "@/lib/utils";

/** Neutral pulsing placeholder. Size it with the same classes as the real element. */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div style={style} className={cn("animate-pulse rounded-lg bg-panel", className)} />;
}

/** Breadcrumb + page title, shared by every route skeleton. */
export function PageHeadSkeleton({ titleWidth = "w-64" }: { titleWidth?: string }) {
  return (
    <>
      <Skeleton className="h-4 w-28 rounded-full" />
      <Skeleton className={cn("mt-3 h-8 rounded-xl", titleWidth)} />
    </>
  );
}

/** Matches the -space-x-2 avatar stacks on ClassCard and the work page. */
export function AvatarStackSkeleton({ count = 4, size = 28 }: { count?: number; size?: number }) {
  return (
    <span className="flex items-center -space-x-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          style={{ width: size, height: size }}
          className="shrink-0 rounded-full ring-2 ring-white"
        />
      ))}
    </span>
  );
}
