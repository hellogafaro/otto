import { describe, expect, it } from "@effect/vitest";

import { ProjectId, type ChannelBinding } from "@otto/contracts";
import {
  canChangeChannelProject,
  channelReconnectProject,
  channelBindingNeedsProject,
  channelFailureReason,
  channelPickerProjectId,
  channelRestoreProjectId,
  channelProviderLabel,
  channelRepairAction,
  channelRepairLabel,
} from "./channel-presentation.ts";
import { createTranslator } from "./i18n/index.ts";
import { zhCNCatalog } from "./i18n/zh-cn.ts";

describe("channel presentation", () => {
  it("derives one repair action from status and failure category", () => {
    const projectId = ProjectId.make("project-1");
    const live = [{ id: projectId }];

    const at = (
      status: ChannelBinding["status"],
      failureCategory?: ChannelBinding["failureCategory"],
    ) => channelRepairAction({ status, projectId, failureCategory }, live);

    expect(at("connecting")).toBe("wait");
    expect(at("connected")).toBe("none");
    expect(at("connected", "delivery-unknown")).toBe("check-delivery");
    expect(at("connected", "credentials")).toBe("update-credentials");
    expect(at("connected", "network")).toBe("reconnect");
    expect(at("disconnected")).toBe("connect");
    expect(at("disconnected", "credentials")).toBe("update-credentials");
    expect(at("needs-reconnect", "network")).toBe("reconnect");
    expect(at("needs-reconnect", "credentials")).toBe("update-credentials");
    expect(at("failed", "credentials")).toBe("update-credentials");
    expect(at("failed", "delivery-unknown")).toBe("check-delivery");
    expect(at("failed", "network")).toBe("reconnect");
    expect(at("failed", "restore")).toBe("reconnect");
    expect(at("failed", "project")).toBe("choose-project");
    expect(at("blocked")).toBe("choose-project");
    expect(at("not-live")).toBe("configure-public-url");
    expect(
      channelRepairAction({ status: "failed", projectId, failureCategory: "credentials" }, []),
    ).toBe("choose-project");
    expect(
      channelRepairAction({ status: "failed", projectId, failureCategory: "delivery-unknown" }, []),
    ).toBe("choose-project");
    expect(
      channelRepairAction({ status: "failed", projectId, failureCategory: "credentials" }),
    ).toBe("update-credentials");
    expect(channelRepairLabel("none")).toBeNull();
    expect(channelRepairLabel("update-credentials")).toBe("Update credentials");
    expect(channelRepairLabel(at("failed", "delivery-unknown"))).toBe("Check the channel");
  });

  it("restores a failed reassignment to a live project", () => {
    const live = ProjectId.make("project-live");
    const gone = ProjectId.make("project-gone");
    const target = ProjectId.make("project-target");

    const projects = [
      { id: live, title: "Workspace" },
      { id: target, title: "Target" },
    ];

    expect(channelRestoreProjectId(live, target, projects)).toBe(live);
    expect(channelRestoreProjectId(gone, target, projects)).toBe(target);
    expect(channelRestoreProjectId(undefined, target, projects)).toBe(target);
  });

  it("asks for a live project when the binding is blocked or its project is gone", () => {
    const live = ProjectId.make("project-live");
    const gone = ProjectId.make("project-gone");
    const projects = [{ id: live, title: "Workspace" }];
    expect(channelBindingNeedsProject({ status: "connected", projectId: live }, projects)).toBe(
      false,
    );
    expect(channelBindingNeedsProject({ status: "blocked", projectId: live }, projects)).toBe(true);
    expect(channelBindingNeedsProject({ status: "connected", projectId: gone }, projects)).toBe(
      true,
    );
    expect(channelBindingNeedsProject({ status: "failed" }, projects)).toBe(true);
  });

  it("picks the explicit choice, then the running project, then a live hint", () => {
    const first = ProjectId.make("project-1");
    const second = ProjectId.make("project-2");
    const gone = ProjectId.make("project-gone");
    const liveProjects = [{ id: first }, { id: second }];
    const running = { status: "connected" as const, projectId: first };
    expect(
      channelPickerProjectId({ selected: second, binding: running, hint: first, liveProjects }),
    ).toBe(second);
    expect(
      channelPickerProjectId({ selected: gone, binding: running, hint: second, liveProjects }),
    ).toBe(first);
    expect(
      channelPickerProjectId({
        selected: null,
        binding: { status: "blocked", projectId: gone },
        hint: second,
        liveProjects,
      }),
    ).toBe(second);
    expect(
      channelPickerProjectId({ selected: undefined, binding: undefined, hint: gone, liveProjects }),
    ).toBeNull();
    expect(
      channelPickerProjectId({ selected: null, binding: undefined, hint: null, liveProjects: [] }),
    ).toBeNull();
  });

  it("allows a project change only to a different live project or to repair a blocked or orphaned binding", () => {
    const first = ProjectId.make("project-1");
    const second = ProjectId.make("project-2");
    const liveProjects = [{ id: first }, { id: second }];
    const running = { status: "connected" as const, projectId: first };
    expect(canChangeChannelProject(running, first, liveProjects)).toBe(false);
    expect(canChangeChannelProject(running, second, liveProjects)).toBe(true);
    expect(canChangeChannelProject(running, null, liveProjects)).toBe(false);
    expect(canChangeChannelProject(running, ProjectId.make("gone"), liveProjects)).toBe(false);
    expect(
      canChangeChannelProject({ status: "blocked", projectId: first }, first, liveProjects),
    ).toBe(true);
    expect(
      canChangeChannelProject({ status: "disconnected", projectId: first }, second, liveProjects),
    ).toBe(false);
    const deleted = ProjectId.make("deleted");
    expect(
      canChangeChannelProject({ status: "disconnected", projectId: deleted }, second, liveProjects),
    ).toBe(true);
    expect(
      canChangeChannelProject(
        { status: "disconnected", projectId: undefined },
        second,
        liveProjects,
      ),
    ).toBe(true);
  });

  it("labels every advertised provider", () => {
    expect([
      channelProviderLabel("telegram"),
      channelProviderLabel("imessage"),
      channelProviderLabel("whatsapp"),
      channelProviderLabel("slack"),
      channelProviderLabel("discord"),
    ]).toEqual(["Telegram", "iMessage", "WhatsApp", "Slack", "Discord"]);
  });
});

describe("channelFailureReason", () => {
  it("names the provider and the rejected credential", () => {
    expect(channelFailureReason("credentials", "telegram")).toBe(
      "Telegram rejected the bot token.",
    );
    expect(channelFailureReason("credentials", "slack")).toBe(
      "Slack rejected the bot token or app token.",
    );
    expect(channelFailureReason("credentials", "discord")).toBe("Discord rejected the bot token.");
    expect(channelFailureReason("credentials", "whatsapp")).toBe(
      "WhatsApp rejected the access token.",
    );
    expect(channelFailureReason("credentials", "imessage")).toBe(
      "Photon rejected the connection credentials.",
    );
  });

  it("explains every other category the server sends", () => {
    expect(channelFailureReason("network", "discord")).toBe(
      "Could not reach Discord. Check the network and try again.",
    );
    expect(channelFailureReason("project", "telegram")).toBe(
      "The project for this channel is unavailable. Choose another project.",
    );
    expect(channelFailureReason("delivery-unknown", "slack")).toBe(
      "A reply may not have reached Slack. Check the chat before replying again.",
    );
    expect(channelFailureReason("restore", "whatsapp")).toBe(
      "WhatsApp did not reconnect after a restart. Reconnect to resume.",
    );
  });

  it("translates with the caller's catalog", () => {
    const zh = createTranslator("zh-CN", zhCNCatalog).t;
    expect(channelFailureReason("credentials", "telegram", zh)).toBe("Telegram 拒绝了机器人令牌。");
    expect(channelFailureReason("network", "slack", zh)).toBe(
      "无法连接到 Slack。请检查网络后重试。",
    );
  });
});

describe("channelReconnectProject", () => {
  it("reconnects a disconnected channel into a different picked live project", () => {
    const first = ProjectId.make("first");
    const second = ProjectId.make("second");
    const liveProjects = [{ id: first }, { id: second }];
    const disconnected = { status: "disconnected" as const, projectId: first };
    expect(channelReconnectProject(disconnected, second, liveProjects)).toBe(second);
    expect(channelReconnectProject(disconnected, first, liveProjects)).toBeNull();
    expect(channelReconnectProject(disconnected, null, liveProjects)).toBeNull();
    expect(channelReconnectProject(disconnected, ProjectId.make("gone"), liveProjects)).toBeNull();
    expect(
      channelReconnectProject(
        { status: "needs-reconnect", projectId: first },
        second,
        liveProjects,
      ),
    ).toBeNull();
  });
});
