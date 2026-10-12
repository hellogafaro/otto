import { describe, expect, it } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import mainSource from "./main.tsx?raw";

describe("React Grab runtime boundary", () => {
  it("loads the React Grab overlay only in development", () => {
    expect(mainSource).toMatch(/import\.meta\.env\.DEV[\s\S]*import\(["']react-grab["']\)/);
    expect(packageJson.dependencies).not.toHaveProperty("react-grab");
    expect(packageJson.devDependencies).toHaveProperty("react-grab");
  });
});
