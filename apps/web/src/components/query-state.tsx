import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";

export function QueryState({
  pending,
  error,
  retry,
}: {
  pending?: boolean;
  error?: Error | null;
  retry?: () => unknown;
}) {
  if (pending)
    return (
      <div
        className="flex flex-col gap-3 p-5"
        role="status"
        aria-label="Loading"
      >
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col items-start gap-3 p-5" role="alert">
        <p>{error.message}</p>
        {retry && (
          <Button variant="outline" onClick={() => retry()}>
            Retry
          </Button>
        )}
      </div>
    );
  return null;
}
