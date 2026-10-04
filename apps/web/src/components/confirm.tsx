import { RiDeleteBinLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { toast } from "@workspace/ui/components/sonner";
import { Spinner } from "@workspace/ui/components/spinner";
import { createContext, type ReactNode, useContext, useState } from "react";

type Question = {
  /** A short question, like the toasts: "Delete file?". */
  title: string;
  /** One plain sentence on what happens: "This can't be undone.". */
  description: string;
  /** The action's word, kept while it runs: "Delete". */
  action: string;
  /** Red, with the bin, for actions that destroy something. */
  destructive?: boolean;
  /** The work itself; the dialog stays open with a spinner until it ends. */
  run?: () => Promise<void> | void;
};

type Pending = Question & { resolve: (yes: boolean) => void };

const ConfirmContext = createContext<(question: Question) => Promise<boolean>>(
  async () => false,
);

// One alert dialog for the whole app, the stock shadcn one (its destructive
// example: small, the red bin, the question, one line, Cancel and the
// action). `useConfirm()` asks and waits: the action keeps its label and
// shows a spinner while `run` works, the dialog closes when it is done, and
// the caller then says so with a toast. A failure keeps it open and says so.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // The question stays while the dialog fades out; only `open` flips.
  const [pending, setPending] = useState<Pending>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    if (busy) return;
    pending?.resolve(false);
    setOpen(false);
  };
  const act = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run?.();
    } catch {
      toast.error("Something went wrong");
      return;
    } finally {
      setBusy(false);
    }
    pending.resolve(true);
    setOpen(false);
  };

  return (
    <ConfirmContext
      value={(question) =>
        new Promise((resolve) => {
          setPending({ ...question, resolve });
          setOpen(true);
        })
      }
    >
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !next && cancel()}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            {pending?.destructive && (
              <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                <RiDeleteBinLine />
              </AlertDialogMedia>
            )}
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={act}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {pending?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
