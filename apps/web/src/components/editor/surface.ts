// Same surface as the dropdown menus (preset: inverted, translucent, blurred),
// for editor popovers that have no shadcn component. `isolate` + z-50 give the
// blur layer its own stacking context, as the menu positioner does.
export const menuSurface =
  "dark relative isolate z-50 rounded-lg bg-popover/70 p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150";
