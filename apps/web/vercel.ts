import { matchers, routes, type VercelConfig } from "@vercel/config/v1";

const ROUTER_HOST = "app.otto.localhost";

const LATEST_ORIGIN = "https://latest.app.otto.localhost";

export const config: VercelConfig = {
  buildCommand:
    "vp run --filter @otto/web build && node ../../scripts/apply-web-brand-assets.ts production",
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@otto/scripts...' --filter '@otto/web...'",
  routes: [
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST)],
      dest: `${LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
