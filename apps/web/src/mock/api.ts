// Stands in for a server round trip (UI-only for now), so pending states such
// as a dialog's spinner show as they will.
export const request = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 700));
