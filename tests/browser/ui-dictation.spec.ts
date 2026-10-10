import { register } from "./account";
import { expect, test } from "./live-app";

declare global {
  interface Window {
    dictationFixture: {
      streams: MediaStream[];
      calls: number;
      mode:
        | "normal"
        | "denied"
        | "delayed"
        | "constructor-error"
        | "start-error";
      release?: () => void;
      recorder?: MediaRecorder;
      contexts?: AudioContext[];
    };
  }
}

test.use({
  launchOptions: {
    executablePath: process.env.OTTO_TEST_CHROMIUM,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("controlled Chrome capture startup, byte bound and transcription unmount cleanup", async ({
  page,
  fixture,
}) => {
  await page.addInitScript(() => {
    const state = {
      streams: [] as MediaStream[],
      contexts: [] as AudioContext[],
      calls: 0,
      mode: "normal" as Window["dictationFixture"]["mode"],
      recorder: undefined as MediaRecorder | undefined,
    };
    window.dictationFixture = state;
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.calls++;
      const stream = await capture(constraints);
      state.streams.push(stream);
      return stream;
    };
    const Recorder = window.MediaRecorder;
    window.MediaRecorder = class extends Recorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        if (state.mode === "constructor-error")
          throw new DOMException(
            "Controlled constructor error",
            "NotSupportedError",
          );
        super(stream, options);
        state.recorder = this;
      }
      start(timeslice?: number) {
        if (state.mode === "start-error")
          throw new DOMException("Controlled start error", "NotSupportedError");
        super.start(timeslice);
      }
    };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        state.contexts.push(this);
      }
    };
  });
  await register(page, fixture, "Dictation Bounds Fixture");
  await page.goto("/chats/new");
  let requests = 0;
  let release = () => {};
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/transcriptions", async (route) => {
    requests++;
    await response;
    await route
      .fulfill({ json: { text: "Stale controlled transcript" } })
      .catch(() => {});
  });
  const dictate = page.getByRole("button", { name: "Dictate", exact: true });
  const released = () =>
    page.evaluate(
      () =>
        window.dictationFixture.streams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === "ended"),
        ) &&
        (window.dictationFixture.contexts ?? []).every(
          (context) => context.state === "closed",
        ),
    );
  for (const mode of ["constructor-error", "start-error"] as const) {
    await page.evaluate((next) => {
      window.dictationFixture.mode = next;
    }, mode);
    await expect(dictate).toBeEnabled();
    await dictate.press("Enter");
    await expect(
      page.getByText("Unable to record audio", { exact: true }).first(),
    ).toBeVisible();
    await expect(dictate).toBeEnabled();
    await expect.poll(released).toBe(true);
    expect(requests).toBe(0);
  }
  await page.evaluate(() => {
    window.dictationFixture.mode = "normal";
  });
  await dictate.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(3);
  await page.evaluate(() =>
    window.dictationFixture.recorder?.dispatchEvent(
      new BlobEvent("dataavailable", {
        data: new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]),
      }),
    ),
  );
  await expect(
    page.getByText("The recording is too long to transcribe", { exact: true }),
  ).toBeVisible();
  await expect(dictate).toBeEnabled();
  await expect.poll(released).toBe(true);
  expect(requests).toBe(0);
  await dictate.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(4);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Transcribing", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  release();
  await expect.poll(released).toBe(true);
  await expect(
    page.getByText("Stale controlled transcript", { exact: true }),
  ).toHaveCount(0);
});

test("controlled fake-audio Chrome capture, literal transcript, send and reload persist", async ({
  page,
  fixture,
  browser,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationFixture = { streams: [], calls: 0, mode: "normal" };
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.dictationFixture.calls++;
      const stream = await capture(constraints);
      window.dictationFixture.streams.push(stream);
      return stream;
    };
  });
  await register(page, fixture, "Dictation Fixture Owner");
  const anonymous = await browser.newContext();
  try {
    const denied = await anonymous.request.post(
      `${fixture.apiOrigin}/api/transcriptions`,
      {
        headers: { Origin: fixture.origin, "Content-Type": "audio/webm" },
        data: "controlled audio",
      },
    );
    expect(denied.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  const wrongOrigin = await page.request.post("/api/transcriptions", {
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "audio/webm",
    },
    data: "controlled audio",
  });
  expect(wrongOrigin.status()).toBe(403);
  await page.goto("/chats/new");
  await page
    .getByRole("button", { name: "With: Participants", exact: true })
    .click();
  await page.getByRole("option", { name: /Dictation Fixture Owner$/ }).click();
  await page.keyboard.press("Escape");
  const text = "Controlled dictation <b>stays literal</b>";
  let bytes = 0;
  await page.route("**/api/transcriptions", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toContain("audio/webm");
    const captured = route.request().postDataBuffer();
    bytes = captured?.byteLength ?? 0;
    if (captured)
      await Bun.write(
        testInfo.outputPath("controlled-captured.webm"),
        captured,
      );
    await route.fulfill({ json: { text } });
  });
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(1);
  await page.waitForTimeout(600);
  await page.screenshot({
    path: testInfo.outputPath("controlled-capture.png"),
  });
  await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
  const composer = page.getByRole("textbox", {
    name: "Write your first message",
    exact: true,
  });
  await expect(composer).toHaveText(text);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(25 * 1024 * 1024);
  expect(await page.evaluate(() => window.dictationFixture.calls)).toBe(1);
  expect(
    await page.evaluate(() =>
      window.dictationFixture.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("controlled-transcript.png"),
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL((url) => /\/chats\/[0-9a-f-]{36}$/.test(url.pathname));
  await expect(
    page.getByRole("log").getByText(text, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("log").getByText(text, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("controlled-saved-reload.png"),
  });
});

test("controlled Chrome denied, cancel, pending permission, recorder and transcription errors release resources", async ({
  page,
  fixture,
}) => {
  await page.addInitScript(() => {
    window.dictationFixture = { streams: [], calls: 0, mode: "normal" };
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const state = window.dictationFixture;
      state.calls++;
      if (state.mode === "denied")
        throw new DOMException("Controlled denial", "NotAllowedError");
      if (state.mode === "delayed")
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      const stream = await capture(constraints);
      state.streams.push(stream);
      return stream;
    };
    const Recorder = window.MediaRecorder;
    window.MediaRecorder = class extends Recorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        window.dictationFixture.recorder = this;
      }
    };
  });
  await register(page, fixture, "Dictation Error Fixture");
  await page.goto("/chats/new");
  let requests = 0;
  await page.route("**/api/transcriptions", async (route) => {
    requests++;
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  const dictate = page.getByRole("button", { name: "Dictate", exact: true });
  const cancel = page.getByRole("button", {
    name: "Cancel dictation",
    exact: true,
  });
  const released = () =>
    page.evaluate(() =>
      window.dictationFixture.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    );
  await page.evaluate(() => {
    window.dictationFixture.mode = "denied";
  });
  await dictate.click();
  await expect(
    page.getByText("Allow microphone access to dictate", { exact: true }),
  ).toBeVisible();
  await expect(dictate).toBeEnabled();
  expect(requests).toBe(0);

  await page.evaluate(() => {
    window.dictationFixture.mode = "delayed";
  });
  await dictate.click();
  await cancel.click();
  await page.evaluate(() => window.dictationFixture.release?.());
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(1);
  await expect.poll(released).toBe(true);
  expect(requests).toBe(0);

  await page.evaluate(() => {
    window.dictationFixture.mode = "normal";
  });
  await dictate.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(2);
  await cancel.click();
  await expect.poll(released).toBe(true);
  expect(requests).toBe(0);

  await dictate.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(3);
  await page.evaluate(() =>
    window.dictationFixture.recorder?.dispatchEvent(new Event("error")),
  );
  await expect(
    page.getByText("Unable to record audio", { exact: true }),
  ).toBeVisible();
  await expect.poll(released).toBe(true);
  await expect(dictate).toBeEnabled();
  expect(requests).toBe(0);

  await dictate.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(4);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
  await expect(
    page.getByText("Unable to transcribe", { exact: true }),
  ).toBeVisible();
  await expect.poll(released).toBe(true);
  await expect(dictate).toBeEnabled();
  expect(requests).toBe(1);
  await expect(
    page.getByRole("textbox", {
      name: "Write your first message",
      exact: true,
    }),
  ).toBeEmpty();

  await page.evaluate(() => {
    window.dictationFixture.mode = "delayed";
  });
  await dictate.press("Enter");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.evaluate(() => window.dictationFixture.release?.());
  await expect
    .poll(() => page.evaluate(() => window.dictationFixture.streams.length))
    .toBe(5);
  await expect.poll(released).toBe(true);
  expect(requests).toBe(1);
});
