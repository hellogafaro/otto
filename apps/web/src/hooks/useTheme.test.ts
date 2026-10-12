import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();

  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme failure handling", () => {
  it("keeps a saved theme successful when legacy cleanup fails", async () => {
    const storage = createStorage({
      removeItem: () => {
        throw new Error("storage remove blocked");
      },
    });

    vi.stubGlobal("window", { localStorage: storage });
    const { readThemePreference, writeThemePreference } = await import("./useTheme");

    expect(() => writeThemePreference("dark")).not.toThrow();
    expect(readThemePreference()).toBe("dark");
  });

  it("preserves exact storage causes and operation context", async () => {
    const readCause = new Error("storage read blocked");
    const writeCause = new Error("storage quota exceeded");
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw readCause;
        },
        setItem: () => {
          throw writeCause;
        },
      }),
    });

    const { readThemePreference, ThemeStorageError, writeThemePreference } =
      await import("./useTheme");

    try {
      readThemePreference();
      expect.unreachable("expected the theme read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "otto:theme",
        cause: readCause,
      });
    }

    try {
      writeThemePreference("dark");
      expect.unreachable("expected the theme write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "otto:theme",
        theme: "dark",
        cause: writeCause,
      });
    }
  });

  it("uses Otto Paper for a fresh profile", async () => {
    vi.stubGlobal("window", { localStorage: createStorage() });

    const { readThemePreference } = await import("./useTheme");

    expect(readThemePreference()).toBe("otto-paper");
  });

  it("migrates the old system default to Otto Paper", async () => {
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: (key) => (key === "otto:theme" ? "system" : null),
      }),
    });

    const { readThemePreference } = await import("./useTheme");

    expect(readThemePreference()).toBe("otto-paper");
  });

  it("ignores the persisted retired palette preference", async () => {
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => "otto-chat",
      }),
    });

    const { readThemePreference } = await import("./useTheme");

    expect(readThemePreference()).toBe("otto-paper");
  });

  it("falls back during initial theme application and logs only safe attributes", async () => {
    const cause = new Error("private browsing storage failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw cause;
        },
      }),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
      },
    });

    await expect(import("./useTheme")).resolves.toBeDefined();

    expect(errorLog).toHaveBeenCalledWith(
      "Failed to read theme preference for otto:theme.",
      expect.objectContaining({
        operation: "read",
        storageKey: "otto:theme",
        errorTag: "ThemeStorageError",
      }),
    );
    const attributes = errorLog.mock.calls[0]?.[1];
    expect(attributes).not.toHaveProperty("cause");
    expect(JSON.stringify(attributes)).not.toContain(cause.message);
  });

  it("retries a failed storage read only after a relevant storage event", async () => {
    const cause = new Error("persistent storage failure");

    const themeGetItem = vi.fn((): string | null => {
      throw cause;
    });

    const getItem = vi.fn((key: string) => (key === "otto:theme" ? themeGetItem() : null));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    let readSnapshot: (() => void) | undefined;
    let subscribeToTheme: ((listener: () => void) => () => void) | undefined;
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: <Snapshot>(
        subscribe: (listener: () => void) => () => void,
        getSnapshot: () => Snapshot,
      ) => {
        subscribeToTheme = subscribe;
        readSnapshot = getSnapshot;

        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      removeEventListener: () => undefined,
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    readSnapshot?.();
    readSnapshot?.();

    expect(themeGetItem).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);

    const unsubscribe = subscribeToTheme?.(() => undefined);
    storageHandler?.({ key: "otto:theme" } as StorageEvent);
    readSnapshot?.();

    expect(themeGetItem).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(2);
    unsubscribe?.();
  });

  it("preserves desktop sync causes and retries after a failed cosmetic sync", async () => {
    const cause = new Error("desktop IPC unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const setTheme = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", { desktopBridge: { setTheme } });

    const { DesktopThemeSyncError, syncDesktopTheme, syncDesktopThemePreference } =
      await import("./useTheme");

    const error = await syncDesktopThemePreference({ setTheme }, "dark").then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(DesktopThemeSyncError);
    expect(error).toMatchObject({ theme: "dark", cause });

    setTheme.mockClear();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();

    expect(setTheme).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to sync the dark theme to the desktop shell.",
      expect.objectContaining({
        theme: "dark",
        errorTag: "DesktopThemeSyncError",
      }),
    );

    for (const [, attributes] of errorLog.mock.calls) {
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    }
  });
});

describe("legacy key cleanup", () => {
  function legacyThrowingStorage(initial: Record<string, string> = {}): Storage {
    const store = new Map(Object.entries(initial));

    return createStorage({
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        if (key.startsWith("ottoLegacy:")) throw new Error("legacy removal blocked");
        store.delete(key);
      },
    });
  }

  function mockReactStore() {
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: <Snapshot>(
        _subscribe: (listener: () => void) => () => void,
        getSnapshot: () => Snapshot,
      ) => getSnapshot(),
    }));
  }

  it("keeps the theme preference write when legacy cleanup throws", async () => {
    const storage = legacyThrowingStorage({ "ottoLegacy:theme": "otto-chat" });
    vi.stubGlobal("window", { localStorage: storage });

    const { writeThemePreference } = await import("./useTheme");

    expect(() => writeThemePreference("ocean")).not.toThrow();
    expect(storage.getItem("otto:theme")).toBe("ocean");
  });

  it("keeps the appearance mode write when legacy cleanup throws", async () => {
    const storage = legacyThrowingStorage();
    mockReactStore();
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });

    const { useTheme } = await import("./useTheme");

    expect(useTheme().setAppearanceMode("dark")).toBe(true);
    expect(storage.getItem("otto:theme-appearance-mode")).toBe("dark");
  });

  it.each(["light", "dark", "system"] as const)(
    "keeps saved custom data untouched when selecting %s mode",
    async (mode) => {
      const retained = {
        "otto:theme": "iris",
        "otto:themes:v1": JSON.stringify([{ id: "custom", colors: { canvas: "#ff0000" } }]),
        "otto:theme-halves:v1": JSON.stringify({ light: "grove", dark: "ocean" }),
      };

      const storage = legacyThrowingStorage(retained);
      mockReactStore();
      vi.stubGlobal("window", { localStorage: storage });
      const { useTheme } = await import("./useTheme");
      expect(useTheme().setAppearanceMode(mode)).toBe(true);
      expect(storage.getItem("otto:theme-appearance-mode")).toBe(mode);
      expect(useTheme().theme).toBe("otto-paper");

      for (const [key, value] of Object.entries(retained)) expect(storage.getItem(key)).toBe(value);

      for (const key of ["setTheme", "setThemeHalf", "clearThemeHalves", "themeHalves"]) {
        expect(useTheme()).not.toHaveProperty(key);
      }
    },
  );

  it("retains the current appearance when a new mode cannot be saved", async () => {
    const storage = createStorage();
    storage.setItem("otto:theme-appearance-mode", "light");
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };

    mockReactStore();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { localStorage: storage });
    const { useTheme } = await import("./useTheme");
    expect(useTheme().setAppearanceMode("dark")).toBe(false);
    expect(useTheme().resolvedTheme).toBe("light");
    expect(storage.getItem("otto:theme-appearance-mode")).toBe("light");
  });
});
