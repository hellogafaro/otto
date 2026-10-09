import type { RemixiconComponentType } from "@remixicon/react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import type { ReactNode } from "react";
import { QueryState } from "@/components/query-state";
import { Count } from "@/components/task-meta";

export function HomeSection({
  title,
  icon: Icon,
  count,
  pending,
  error,
  retry,
  empty,
  emptyAction,
  action,
  children,
}: {
  title: string;
  icon: RemixiconComponentType;
  count: number;
  pending: boolean;
  error?: Error | null;
  retry: () => unknown;
  empty: string;
  emptyAction: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="home-section" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-3">
        <h2 className="text-base font-medium">{title}</h2>
        <div className="flex min-w-0 items-center gap-3">
          {!pending && !error && count > 0 && <Count>{count}</Count>}
          {(count > 0 || pending || error) && action}
        </div>
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
              <EmptyTitle>No {title.toLowerCase()}</EmptyTitle>
              <EmptyDescription>{empty}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {action}
              {emptyAction}
            </EmptyContent>
          </Empty>
        )}
      </div>
    </section>
  );
}
