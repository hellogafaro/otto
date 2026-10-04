import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { createContext, type ReactNode, useContext, useState } from "react";

type Question = {
  /** A question in sentence case, e.g. "Delete “brand-notes.md”?". */
  title: string;
  /** One line on what happens, e.g. "This can't be undone.". */
  description: string;
  /** The action's word, e.g. "Delete". */
  action: string;
  /** Red, for actions that destroy something. */
  destructive?: boolean;
};

type Pending = Question & { resolve: (yes: boolean) => void };

const ConfirmContext = createContext<(question: Question) => Promise<boolean>>(
  async () => false,
);

// One alert dialog for the whole app: an action that needs a yes (Delete)
// asks with `useConfirm()` and waits. The stock shadcn alert dialog, small:
// the question, one line, Cancel and the action (red when it destroys).
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // The question stays while the dialog fades out; only `open` flips.
  const [pending, setPending] = useState<Pending>();
  const [open, setOpen] = useState(false);
  const answer = (yes: boolean) => {
    pending?.resolve(yes);
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
      <AlertDialog open={open} onOpenChange={(open) => !open && answer(false)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? "destructive" : "default"}
              onClick={() => answer(true)}
            >
              {pending?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
