import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import {
  resolveEarlyLinuxElectronOptions,
  resolveEarlyLinuxPasswordStorePreference,
} from "./DesktopEarlyElectronStartup.ts";

describe("DesktopEarlyElectronStartup", () => {
  const joinPath = NodePath.posix.join;

  it("reads the persisted linux password-store preference before Electron is ready", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: { OTTO_LEGACY_HOME: "/home/user/.ottoLegacy-test" },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: (path) => {
        assert.equal(path, "/home/user/.ottoLegacy-test/userdata/desktop-settings.json");

        return JSON.stringify({ linuxPasswordStore: "kwallet6" });
      },
    });

    assert.equal(preference, "kwallet6");
  });

  it("accepts JSONC in the early desktop settings file", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: { OTTO_LEGACY_HOME: "/home/user/.ottoLegacy-test" },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: () => `{
        // manually edited setting
        "linuxPasswordStore": "gnome-libsecret",
      }`,
    });

    assert.equal(preference, "gnome-libsecret");
  });

  it("falls back to auto when the early settings document is missing or invalid", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: {},
      homeDirectory: "/home/user",
      joinPath,
      readFileString: () => {
        throw new Error("missing");
      },
    });

    assert.equal(preference, "auto");
  });

  it("preserves absolute root paths when resolving early settings", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: { OTTO_LEGACY_HOME: "/" },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: (path) => {
        assert.equal(path, "/userdata/desktop-settings.json");

        return JSON.stringify({ linuxPasswordStore: "kwallet6" });
      },
    });

    assert.equal(preference, "kwallet6");
  });

  it("resolves the early linux Electron switches", () => {
    const options = resolveEarlyLinuxElectronOptions({
      env: {
        OTTO_LEGACY_HOME: "/home/user/.ottoLegacy-test",
        XDG_CURRENT_DESKTOP: "niri",
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: (path) => {
        assert.equal(path, "/home/user/.ottoLegacy-test/userdata/desktop-settings.json");

        return JSON.stringify({ linuxPasswordStore: "auto" });
      },
    });

    assert.deepEqual(options, {
      linuxWmClass: "otto-dev",
      passwordStore: "gnome-libsecret",
    });
  });

  it("keeps implicit development state under ~/.otto/dev when OTTO_LEGACY_HOME is unset", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: (path) => {
        assert.equal(path, "/home/user/.otto/dev/desktop-settings.json");

        return JSON.stringify({ linuxPasswordStore: "kwallet" });
      },
    });

    assert.equal(preference, "kwallet");
  });

  it("treats whitespace-only OTTO_LEGACY_HOME as unconfigured in development", () => {
    const preference = resolveEarlyLinuxPasswordStorePreference({
      env: {
        OTTO_LEGACY_HOME: "   ",
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      },
      homeDirectory: "/home/user",
      joinPath,
      readFileString: (path) => {
        assert.equal(path, "/home/user/.otto/dev/desktop-settings.json");

        return JSON.stringify({ linuxPasswordStore: "gnome-libsecret" });
      },
    });

    assert.equal(preference, "gnome-libsecret");
  });
});
