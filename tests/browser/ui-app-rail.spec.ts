import { register } from "./account";
import { expect, test } from "./live-app";

test.use({
  launchOptions: { executablePath: process.env.OTTO_TEST_CHROMIUM },
});

test("the first Otto mark opens Home without changing the rail", async ({
  page,
  fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await register(page, fixture, "Rail Owner");
  await page.goto("/tasks");
  const rail = page.getByRole("navigation", { name: "App navigation" });
  await expect(rail).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rail-light.png") });
  const home = rail.getByRole("button", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("href", "/");
  await expect(home.locator('svg[aria-hidden="true"] path')).toHaveCount(6);
  expect(
    await rail
      .locator("a[aria-label], button[aria-label]")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Home",
    "Search",
    "Tasks",
    "Projects",
    "Chats",
    "Schedules",
    "Library",
    "Open profile menu",
  ]);
  expect((await rail.boundingBox())?.width).toBe(48);
  expect((await home.boundingBox())?.width).toBe(32);
  expect((await home.boundingBox())?.height).toBe(32);
  expect((await home.locator("svg").boundingBox())?.width).toBe(20);
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await expect(
    rail.getByRole("button", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await home.focus();
  await page.keyboard.press("Tab");
  await expect(
    rail.getByRole("button", { name: "Search", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog").getByPlaceholder("Search"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await home.hover();
  const tooltip = page.locator('[data-slot="tooltip-content"]');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("Home");
  await page.screenshot({ path: testInfo.outputPath("rail-tooltip.png") });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(home).toHaveClass(/bg-secondary/);
  await rail.screenshot({
    path: testInfo.outputPath("rail-home-selected.png"),
  });
  await page.reload();
  await expect(home).toHaveAttribute("aria-current", "page");
  await rail.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL("/tasks");
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await expect(home).toHaveClass(/text-muted-foreground/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.mouse.move(1000, 500);
  await page.screenshot({ path: testInfo.outputPath("rail-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(home).toBeVisible();
  expect((await rail.boundingBox())?.width).toBe(48);
  expect((await home.boundingBox())?.width).toBe(32);
  await home.click();
  await expect(page).toHaveURL("/");
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(home).toHaveClass(/bg-secondary/);
  await expect(
    rail.getByRole("button", { name: "Tasks", exact: true }),
  ).not.toHaveClass(/bg-secondary/);
  await page.screenshot({
    path: testInfo.outputPath("rail-mobile.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
