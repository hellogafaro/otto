import { RiArrowDownSLine } from "@remixicon/react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { toast } from "@workspace/ui/components/sonner";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useDebounced } from "@/components/debounce";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { createSettingsAttempt } from "./creation-attempt";

export function Group({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-medium">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="-mx-4 flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 [&>[data-slot=item]+[data-slot=item]]:border-t-border">
        {children}
      </div>
    </section>
  );
}
export function Row({
  title,
  description,
  media,
  render,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  media?: ReactNode;
  render?: ReactElement;
  children?: ReactNode;
}) {
  return (
    <Item render={render} className="rounded-none px-[15px]">
      {media && <ItemMedia>{media}</ItemMedia>}
      <ItemContent className="gap-0.5">
        <ItemTitle>{title}</ItemTitle>
        {description && (
          <ItemDescription className="text-xs">{description}</ItemDescription>
        )}
      </ItemContent>
      {children && <ItemActions>{children}</ItemActions>}
    </Item>
  );
}
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Partial<Record<T, string>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const current = options[value] ?? "Unavailable";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="compact"
            disabled={disabled}
            aria-label={`${label}: ${current}`}
            className="min-w-32 justify-between"
          />
        }
      >
        {current}
        <RiArrowDownSLine data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const key = (Object.keys(options) as T[]).find(
              (key) => key === next,
            );
            if (key && typeof options[key] === "string") onChange(key);
          }}
        >
          {(Object.keys(options) as T[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key} closeOnClick>
              {options[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Settings saves serialize per row; the acknowledged value advances only after success. */
export function useAutosave<T>(
  initial: T,
  save: (value: T) => unknown | Promise<unknown>,
  message = "Settings saved",
) {
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const draft = useRef(initial);
  const acknowledged = useRef(JSON.stringify(initial));
  const previousInitial = useRef(JSON.stringify(initial));
  const running = useRef(false);
  const latestSave = useRef(save);
  latestSave.current = save;
  const initialJson = JSON.stringify(initial);
  useEffect(() => {
    if (initialJson === previousInitial.current) return;
    previousInitial.current = initialJson;
    if (
      !running.current &&
      JSON.stringify(draft.current) === acknowledged.current
    ) {
      acknowledged.current = initialJson;
      draft.current = initial;
      setValue(initial);
    }
  }, [initialJson, initial]);
  const persist = async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      while (JSON.stringify(draft.current) !== acknowledged.current) {
        const next = draft.current;
        const json = JSON.stringify(next);
        setPending(true);
        await latestSave.current(next);
        acknowledged.current = json;
        toast.success(message, { id: "settings-saved" });
      }
    } catch (cause) {
      const failure = settingsError(cause);
      setError(failure);
      toast.error(failure.message, { id: "settings-saved" });
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  const debounced = useDebounced(() => {
    void persist();
  });
  const change = (next: T) => {
    draft.current = next;
    setValue(next);
    setPending(
      JSON.stringify(next) !== acknowledged.current || running.current,
    );
    debounced.run(next);
  };
  return {
    value,
    change,
    flush: debounced.flush,
    pending,
    error,
    retry: () => {
      void persist();
    },
  };
}
export function settingsError(cause: unknown): Error {
  if (cause instanceof TypeError)
    return new Error(
      "Unable to confirm the request. Check current settings before retrying; the change may already have been saved.",
    );
  return cause instanceof Error
    ? cause
    : new Error("Unable to save. Try again.");
}
export function useSettingsAction() {
  const { invalidate } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const running = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const perform = async (work: () => Promise<unknown>, message?: string) => {
    if (!active.current || running.current) return false;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await work();
      await invalidate();
      if (message && active.current)
        toast.success(message, { id: "settings-saved" });
      return active.current;
    } catch (cause) {
      const failure = settingsError(cause);
      setError(failure);
      toast.error(failure.message, { id: "settings-saved" });
      // Lost acknowledgments and stale fences require an authoritative readback.
      await invalidate().catch(() => {
        setError(
          new Error(
            `${failure.message} Unable to refresh current settings. Reload before retrying.`,
          ),
        );
      });
      return false;
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { pending, error, perform, isActive: () => active.current };
}
export function useSettingsCreation() {
  const action = useSettingsAction();
  const attempt = useRef(createSettingsAttempt());
  return {
    ...action,
    blocked: attempt.current.blocked,
    reset: attempt.current.reset,
    create: <T,>(
      request: () => Promise<{
        ok: boolean;
        status: number;
        json(): Promise<T>;
      }>,
    ) => attempt.current.send(request, read),
  };
}
export function SaveState({
  pending,
  error,
  retry,
}: {
  pending?: boolean;
  error?: Error | null;
  retry?: () => unknown;
}) {
  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <span>{error.message}</span>
        {retry && (
          <Button size="compact" variant="outline" onClick={() => retry()}>
            Retry
          </Button>
        )}
      </div>
    );
  if (pending)
    return (
      <span role="status" className="text-xs text-muted-foreground">
        Saving
      </span>
    );
  return null;
}
export function SettingsInput({
  label,
  initial,
  save,
  disabled = false,
  maxLength = 200,
}: {
  label: string;
  initial: string;
  save: (value: string) => Promise<unknown>;
  disabled?: boolean;
  maxLength?: number;
}) {
  const state = useAutosave(initial, save);
  return (
    <div className="flex flex-col items-end gap-2">
      <Input
        className="w-56 max-w-full"
        aria-label={label}
        value={state.value}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={Boolean(state.error)}
        onChange={(event) => state.change(event.target.value)}
        onBlur={state.flush}
      />
      <SaveState {...state} />
    </div>
  );
}
export function SettingsDialog({
  title,
  description,
  open,
  onOpenChange,
  pending,
  error,
  submitLabel = "Create",
  submitDisabled = false,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error?: Error | null;
  submitLabel?: string;
  submitDisabled?: boolean;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[85svh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && !submitDisabled) void onSubmit();
          }}
        >
          <fieldset disabled={pending}>
            <FieldGroup>{children}</FieldGroup>
          </fieldset>
          <SaveState error={error} />
          {submitDisabled && !pending && (
            <p role="alert" className="text-sm">
              Creation cannot be repeated. Close this dialog and check the
              current records; the request may already have created one.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || submitDisabled}>
              {pending ? "Working" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function SettingsField({
  label,
  description,
  ...props
}: ComponentProps<typeof Input> & { label: string; description?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

/** URL state is read with domain allowlists; each page is at most 100 rows. */
export function useSettingsList<S extends string>(
  sorts: Record<S, string>,
  defaultSort: NoInfer<S>,
) {
  const location = useLocation();
  const router = useRouter();
  const params = new URLSearchParams(location.searchStr);
  const sort =
    (Object.keys(sorts) as S[]).find((key) => key === params.get("sort")) ??
    defaultSort;
  const order: "asc" | "desc" = params.get("order") === "desc" ? "desc" : "asc";
  const query = (params.get("query") ?? "").slice(0, 200);
  const after = params.get("after")?.slice(0, 4096) || undefined;
  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(location.searchStr);
    next.delete("after");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.history.push(`${location.pathname}${next.size ? `?${next}` : ""}`);
  };
  return {
    sort,
    order,
    query,
    after,
    update,
    params,
    request: { sort, order, query: query || undefined, after, limit: "100" },
  };
}
/** Page-specific filters only (role, archive, type); there is no search or sort toolbar. */
export function SettingsFilters({ children }: { children?: ReactNode }) {
  return children ? (
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  ) : null;
}
export function SettingsPaging({
  next,
  after,
  change,
}: {
  next?: string | null;
  after?: string;
  change: (after?: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {after && (
        <Button variant="outline" size="compact" onClick={() => change()}>
          First page
        </Button>
      )}
      {next && (
        <Button variant="outline" size="compact" onClick={() => change(next)}>
          Next page
        </Button>
      )}
    </div>
  );
}
