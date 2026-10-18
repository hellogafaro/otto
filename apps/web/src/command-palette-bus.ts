import { create } from "zustand";

/** Whether the command palette is open; its shortcut, the rail's Search and the dialog share it. */
export const useCommandPaletteStore = create<{
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

export function openCommandPalette(): void {
  useCommandPaletteStore.getState().setOpen(true);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
