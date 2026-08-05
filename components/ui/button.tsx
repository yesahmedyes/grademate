import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-coral text-white hover:bg-coral-deep shadow-[0_6px_16px_-6px_rgba(233,124,82,0.55)]",
  navy: "bg-navy text-white hover:bg-navy-soft",
  outline: "border border-ink/15 bg-white text-ink hover:bg-panel",
  ghost: "text-ink/70 hover:bg-panel hover:text-ink",
} as const;

const sizes = {
  sm: "h-8 px-3.5 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-sm",
} as const;

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}
