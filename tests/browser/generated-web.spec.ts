import { expect, test } from "@playwright/test";

test("generated preset renders with pointer behavior and keyboard theme toggle", async ({
  page,
}) => {
  expect(typeof Bun).toBe("object");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Project ready!" }),
  ).toBeVisible();
  const button = page.getByRole("button", { name: "Button", exact: true });
  await expect(button).toBeVisible();
  expect(
    await button.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("pointer");
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("d");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("d");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path: "docs/evidence/generated-web-playwright.png" });
  expect(errors).toEqual([]);
});
