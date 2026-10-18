import { describe, expect, it, vi } from "@effect/vitest";
import {
  fileDropHandlers,
  type WorkspaceFileDragEvent,
  type WorkspaceFileDropHost,
} from "./workspace-file-drop";

function makeDragEvent(options?: {
  types?: string[];
  files?: File[];
  movedWithinTarget?: boolean;
}) {
  const preventDefault = vi.fn();

  const event = {
    dataTransfer: {
      types: options?.types ?? ["Files"],
      files: options?.files ?? [],
      dropEffect: "none",
    },
    relatedTarget: options?.movedWithinTarget ? ({} as EventTarget) : null,
    currentTarget: {
      contains: () => options?.movedWithinTarget ?? false,
    },
    preventDefault,
  } satisfies WorkspaceFileDragEvent;

  return { event, preventDefault };
}

function makeHost() {
  const setDragActive = vi.fn();
  const addFiles = vi.fn();
  const host = { setDragActive, addFiles } satisfies WorkspaceFileDropHost;

  return { host, setDragActive, addFiles };
}

describe("fileDropHandlers", () => {
  it("activates the target for an external file drag", () => {
    const { host, setDragActive } = makeHost();
    const { event, preventDefault } = makeDragEvent();

    fileDropHandlers(host).onDragEnter(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setDragActive).toHaveBeenCalledWith(true);
  });

  it("ignores non-file drags", () => {
    const { host, setDragActive } = makeHost();
    const { event, preventDefault } = makeDragEvent({ types: ["text/plain"] });

    fileDropHandlers(host).onDragOver(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(setDragActive).not.toHaveBeenCalled();
  });

  it("does not flicker when the drag moves between children", () => {
    const { host, setDragActive } = makeHost();
    const { event } = makeDragEvent({ movedWithinTarget: true });

    const handlers = fileDropHandlers(host);
    handlers.onDragEnter(event);
    handlers.onDragLeave(event);

    expect(setDragActive).not.toHaveBeenCalled();
  });

  it("forwards dropped files and clears the active state", () => {
    const file = new File(["contents"], "example.txt", { type: "text/plain" });
    const { host, setDragActive, addFiles } = makeHost();
    const { event } = makeDragEvent({ files: [file] });

    fileDropHandlers(host).onDrop(event);

    expect(setDragActive).toHaveBeenCalledWith(false);
    expect(addFiles).toHaveBeenCalledWith([file]);
  });
});
