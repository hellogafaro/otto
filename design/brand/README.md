# Otto brand sources

- `otto-mark.svg` is the six-blade mark. It uses `currentColor`, so the surface sets its color.
- `otto-app-icon.svg` is the 1024px glass app icon and the master for every raster icon.
- Rule: the mark is never the primary or brand color, only foreground-dark or light (`text-foreground`, or `text-background` on inverted surfaces). The app icon is the only colored version.
- `bun scripts/generate-brand-assets.ts` regenerates all icons (app, installer, web, in-page marks) from these two files. Do not edit the generated files by hand.
