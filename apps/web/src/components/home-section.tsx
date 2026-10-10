import type { RemixiconComponentType } from "@remixicon/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@workspace/ui/components/empty";
import type { ReactNode } from "react";
import { QueryState } from "@/components/query-state";

export function HomeSection({
  title,
  icon: Icon,
  count,
  pending,
  error,
  retry,
  empty,
  children,
}: {
  title: string;
  icon: RemixiconComponentType;
  count: number;
  pending: boolean;
  error?: Error | null;
  retry: () => unknown;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="home-section" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-3">
        <h2 className="text-base font-medium">{title}</h2>
      </header>
      <div className="home-card">
        {error || pending ? (
          <div className="p-3">
            <QueryState
              pending={!error && pending}
              error={error}
              retry={retry}
            />
          </div>
        ) : count > 0 ? (
          <ul className="p-2">{children}</ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon />
              </EmptyMedia>
              <EmptyDescription>{empty}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}
