import { expect, test } from "@playwright/test";

test("web app renders Home with pointer behavior and keyboard theme toggle", async ({
  page,
}) => {
  expect(typeof Bun).toBe("object");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /^Good (morning|afternoon|evening), Johan$/,
    }),
  ).toBeVisible();
  const button = page.getByRole("button", { name: "Tasks", exact: true });
  await expect(button).toBeVisible();
  expect(
    await button.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("pointer");
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("d");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.evaluate(() =>
    Promise.all(
      // Only timed ones: scroll-driven fades and endless loops (a working
      // agent's shimmer) never finish.
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.timeline === document.timeline &&
            animation.effect?.getTiming().iterations !==
              Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path: "docs/evidence/generated-web-playwright.png" });
  expect(errors).toEqual([]);
});
