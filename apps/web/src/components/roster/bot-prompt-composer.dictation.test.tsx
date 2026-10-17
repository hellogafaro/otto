import type { TestProps } from "../test-support/react-tree";
import type { DictationDraft } from "@otto/client-runtime/dictation";
import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test-support/react-tree";
import { reactHookHarness as hooks } from "../../test/react-hook-harness";

type Session = ReturnType<typeof import("@otto/client-runtime/dictation").createDictationSession>;

type DictationInput = {
  readonly getDraft: () => Omit<DictationDraft, "identity">;
  readonly applyDraft: (draft: DictationDraft) => void;
};

const fake = vi.hoisted(() => ({
  session: null as Session | null,
  input: null as DictationInput | null,
  transcribe: vi.fn<() => Promise<string>>(),
}));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => {},
    useId: () => "id",
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("motion/react", () => ({
  AnimatePresence: () => null,
  motion: { div: () => null },
  useReducedMotion: () => true,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));

vi.mock("../../state/server", () => ({ primaryServerKeybindingsAtom: Symbol("keybindings") }));

vi.mock("./bot-prompt-command-menu", () => ({ BotPromptCommandMenu: () => null }));

vi.mock("../../composer-draft-store", () => ({ hydrateImagesFromPersisted: () => [] }));

vi.mock("../../lib/image-compression", () => ({ compressImageForStash: vi.fn() }));

vi.mock("../../prompt-stash-store", () => ({
  MAX_STASH_ENTRIES: 10,
  partitionStashAttachments: vi.fn(),
  usePromptStashStore: <T,>(
    selector: (store: {
      entries: [];
      stashEntry: () => void;
      takeEntry: () => void;
      finalizeEntryImages: () => void;
    }) => T,
  ) =>
    selector({
      entries: [],
      stashEntry: vi.fn(),
      takeEntry: vi.fn(),
      finalizeEntryImages: vi.fn(),
    }),
}));

vi.mock("./roster-store", () => ({
  useRosterStore: <T,>(selector: (store: { bots: [] }) => T) => selector({ bots: [] }),
}));

vi.mock("./bot-composer-model-control", () => ({ BotComposerModelControl: () => null }));

vi.mock("./bot-prompt-mentions", () => ({
  BotPromptMentionHighlights: () => null,
  BotPromptMentionMenu: () => null,
  useBotPromptMentionNames: () => [],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// The real session runs behind the environment binding: capture succeeds, transcription fails.
vi.mock("../../lib/use-environment-composer-dictation", async () => {
  const { createDictationSession, dictationControlStatus } =
    await import("@otto/client-runtime/dictation");

  const identity = { environmentId: "environment", threadId: "Scout", draftId: "Scout" };

  return {
    useEnvironmentComposerDictation: (input: DictationInput & { generation: number }) => {
      fake.input = input;
      const draft = () => ({ identity: { ...identity, generation: 0 }, ...fake.input!.getDraft() });
      fake.session ??= createDictationSession({
        capture: async () => ({
          stop: async () => ({
            bytes: new Uint8Array([1]),
            mediaType: "audio/webm",
            durationMs: 900,
          }),
          dispose: () => {},
        }),
        transcribe: fake.transcribe,
        updateDraft: (update) => fake.input!.applyDraft(update(draft())),
        schedule: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
        cancelSchedule: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
      });
      const session = fake.session;

      return {
        status: dictationControlStatus(session.status),
        unavailableReason: null,
        errorMessage: session.status === "error" ? "Transcription failed. Try again." : null,
        onStart: () => session.start(draft()),
        onRelease: () => session.finish(),
        onCancel: () => session.cancel(),
        stream: null,
        onRetry: session.canRetry ? () => void session.retry() : null,
      };
    },
  };
});

import { DictationControls, type DictationControlsProps } from "../chat/dictation-controls";
import { BotPromptComposer } from "./bot-prompt-composer";
import type { BotPromptAttachment } from "./bot-prompt-attachments";

type Element = ReactElement<TestProps>;

function render() {
  hooks.beginRender();
  const tree = BotPromptComposer({ botName: "Scout", disabled: false, onSubmit: vi.fn() });
  const slot = visitElements(tree, (element) => element.type === DictationControls);

  // Render the send-slot controls in the same pass so their hooks keep stable slots.
  const controls = isValidElement<DictationControlsProps>(slot)
    ? DictationControls(slot.props)
    : null;

  const find = (label: string) =>
    visitElements([tree, controls], (element) => element.props["aria-label"] === label);

  return {
    textarea: visitElements(tree, (element) => element.type === "textarea") as Element,
    fileInput: visitElements(tree, (element) => element.props.type === "file") as Element,
    attachments: () =>
      (visitElements(tree, (element) => Array.isArray(element.props.attachments)) as Element).props
        .attachments as BotPromptAttachment[],
    find,
  };
}

beforeEach(() => {
  hooks.reset();
  fake.session = null;
  fake.input = null;
  fake.transcribe = vi.fn(async () => {
    throw new Error("Transcription failed. Try again.");
  });
});

describe("BotPromptComposer dictation failure", () => {
  it("keeps typed text and attachments when a failed dictation is retried", async () => {
    const view = render();
    (view.textarea.props.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "Summarize the attached notes" },
    });
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    (
      view.fileInput.props.onChange as (event: {
        currentTarget: { files: File[]; value: string };
      }) => void
    )({
      currentTarget: { files: [file], value: "" },
    });
    const seeded = render();
    expect(seeded.find("Send message")).not.toBeNull();
    const [attachment] = seeded.attachments();
    expect(attachment?.file).toBe(file);

    // A draft shows Send, so drive the composer's session directly, as a hold that began earlier would.
    await fake.session!.start({
      identity: {
        environmentId: "environment",
        threadId: "Scout",
        draftId: "Scout",
        generation: 0,
      },
      ...fake.input!.getDraft(),
    });
    await fake.session!.finish();
    expect(fake.session!.status).toBe("error");

    // The failure's toast retries; the slot goes back to Send for the typed draft.
    const failed = render();
    expect(failed.find("Send message")?.props.disabled).toBe(false);
    expect(failed.find("Start dictation")).toBeNull();

    fake.transcribe.mockResolvedValueOnce("and the slides");
    await fake.session!.retry();
    expect(fake.transcribe).toHaveBeenCalledTimes(2);
    const retried = render();
    expect(retried.textarea.props.value).toBe("Summarize the attached notes and the slides");
    expect(retried.attachments()[0]).toBe(attachment);
  });

  it("turns + into a cancel button while dictating", async () => {
    const view = render();
    expect(view.find("Cancel dictation")).toBeNull();

    (view.find("Start dictation")!.props.onClick as (event: { detail: number }) => void)({
      detail: 0,
    });
    await vi.waitFor(() => expect(fake.session!.status).toBe("recording"));

    const recording = render();
    expect(recording.find("Attach file")).toBeNull();
    (recording.find("Cancel dictation")!.props.onClick as () => void)();
    expect(fake.session!.status).toBe("cancelled");
    expect(render().find("Attach file")).not.toBeNull();
  });
});
