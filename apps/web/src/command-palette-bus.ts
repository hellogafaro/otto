import { create } from "zustand";

/** Tabs the palette can be asked to open on. The shortcut and the rail stay on All. */
export type CommandPaletteOpenTab = "all" | "chats";

/** Whether the command palette is open; its shortcut, the rail's Search and the dialog share it. */
export const useCommandPaletteStore = create<{
  readonly open: boolean;
  readonly tab: CommandPaletteOpenTab;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
  readonly openOn: (tab: CommandPaletteOpenTab) => void;
}>((set) => ({
  open: false,
  tab: "all",
  setOpen: (open) => set({ open }),
  toggle: () =>
    set((state) => ({
      open: !state.open,
      ...(state.open ? {} : { tab: "all" as const }),
    })),
  openOn: (tab) => set({ open: true, tab }),
}));

export function openCommandPalette(tab: CommandPaletteOpenTab = "all"): void {
  useCommandPaletteStore.getState().openOn(tab);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
