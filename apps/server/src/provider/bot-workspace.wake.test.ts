import { describe, expect, it, vi } from "vite-plus/test";
import { makebotWorkspaceTestSupport } from "./test-support/bot-workspace.ts";

const { setup } = makebotWorkspaceTestSupport();

describe("Boat computer waking", () => {
  it("resumes a computer Boat stopped while its turn waited, then sends the command again", async () => {
    const { ResponseError } = await import("@boatdev/sdk");
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    const archived = { ...current, sandbox: { ...current.sandbox, state: "archived" as const } };

    const resume = vi
      .spyOn(client, "resume")
      .mockResolvedValue({ ok: true, type: "sandbox.resumed", id: "boat-id", status: "ready" });

    const command = vi
      .spyOn(client, "command")
      .mockRejectedValueOnce(new ResponseError(new Response(null, { status: 409 })))
      .mockResolvedValue({
        ok: true,
        type: "command.finished",
        success: true,
        exitCode: 0,
        stdout: "done",
        stderr: "",
        timedOut: false,
      });

    get.mockResolvedValueOnce(archived).mockResolvedValueOnce(archived);
    expect((await session.run("true", [])).stdout).toBe("done");
    expect(resume).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledTimes(2);

    // A conflict on a running computer is Boat's answer, not a stop: it is not retried.
    command.mockRejectedValueOnce(new ResponseError(new Response(null, { status: 409 })));
    await expect(session.run("true", [])).rejects.toBeInstanceOf(ResponseError);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("shares one resume between calls that find the computer stopped together", async () => {
    const { ResponseError } = await import("@boatdev/sdk");
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    const archived = { ...current, sandbox: { ...current.sandbox, state: "archived" as const } };

    const resume = vi
      .spyOn(client, "resume")
      .mockResolvedValue({ ok: true, type: "sandbox.resumed", id: "boat-id", status: "ready" });

    vi.spyOn(client, "command")
      .mockRejectedValueOnce(new ResponseError(new Response(null, { status: 409 })))
      .mockRejectedValueOnce(new ResponseError(new Response(null, { status: 409 })))
      .mockResolvedValue({
        ok: true,
        type: "command.finished",
        success: true,
        exitCode: 0,
        stdout: "done",
        stderr: "",
        timedOut: false,
      });

    get
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(archived);
    const results = await Promise.all([session.run("true", []), session.run("true", [])]);
    expect(results.map((result) => result.stdout)).toEqual(["done", "done"]);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("reports Boat's own message when a stopped computer cannot start", async () => {
    const { ResponseError } = await import("@boatdev/sdk");
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    const archived = { ...current, sandbox: { ...current.sandbox, state: "archived" as const } };

    vi.spyOn(client, "command").mockRejectedValue(
      new ResponseError(new Response(null, { status: 409 })),
    );

    vi.spyOn(client, "resume").mockRejectedValue(
      new ResponseError(
        Response.json({ message: "Rate limit hit: 200 sandbox starts per day." }, { status: 429 }),
        "Response returned an error code",
      ),
    );

    get.mockResolvedValueOnce(archived).mockResolvedValueOnce(archived);
    await expect(session.run("true", [])).rejects.toThrow(
      "Boat: Rate limit hit: 200 sandbox starts per day.",
    );
  });

  it("keeps a running computer up for the full auto-stop and never wakes a stopped one", async () => {
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    const update = vi.spyOn(client, "update").mockResolvedValue({} as never);
    const resume = vi.spyOn(client, "resume");

    await session.keepAlive!();
    expect(update).toHaveBeenCalledWith({
      sandboxId: "boat-id",
      updateSandboxRequest: { ttlSeconds: 900 },
    });

    update.mockClear();
    get.mockResolvedValueOnce({ ...current, sandbox: { ...current.sandbox, state: "archived" } });
    await session.keepAlive!();
    expect(update).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
