import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => "",
}));

import { UsagePlanLimits } from "./usage-charts";

describe("UsagePlanLimits", () => {
  it("renders the ChatGPT logo without a public asset request", () => {
    const markup = renderToStaticMarkup(
      <UsagePlanLimits
        planLimits={[
          { provider: "openai-codex", status: "ok", plan: "Pro", message: null, windows: [] },
        ]}
      />,
    );

    expect(markup).toContain("ChatGPT · Pro");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("/provider-icons/openai.svg");
  });

  it("draws each window's remaining capacity as a strip with when it resets", () => {
    const markup = renderToStaticMarkup(
      <UsagePlanLimits
        planLimits={[
          {
            provider: "openai-codex",
            status: "ok",
            plan: "Pro",
            message: null,
            windows: [
              { kind: "weekly", label: "Weekly", usedPercent: 80, resetsAt: null },
              { kind: "session", label: "5-hour", usedPercent: 5, resetsAt: null },
            ],
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Weekly: 20% left"');
    expect(markup).toContain("--left:20%");
    expect(markup).toContain("bg-warning");
    expect(markup).toContain('aria-label="5-hour: 95% left"');
    expect(markup).toContain("bg-success");
  });
});
