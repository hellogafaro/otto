import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export function AuthSurfaceShell({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <div
      data-auth-surface
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10 text-foreground sm:px-6"
    >
      <main className="flex w-full max-w-sm flex-col gap-5">
        <img
          src="/icon.png"
          alt="Otto"
          width={36}
          height={36}
          className="size-9 rounded-(--control-radius)"
        />
        <section className="flex flex-col gap-8">{children}</section>
        {footer ? (
          <div className="text-xs leading-relaxed text-muted-foreground">{footer}</div>
        ) : null}
      </main>
    </div>
  );
}

/** Otto: Every secondary action on an auth screen is a full-width ghost button under the primary one. */
export function AuthSecondaryButton(
  props: Omit<ComponentProps<typeof Button>, "variant" | "type">,
) {
  return <Button type="button" variant="ghost" {...props} />;
}

export function AuthSurfaceSection({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>;
}
