import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("commit + reveal flow produces a synced tally", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(500);

    await a.getByPlaceholder("the question").fill("Is mesh fun?");
    await a.getByRole("button", { name: "open ballot", exact: true }).click();

    await b.waitForTimeout(400);
    await a.getByRole("button", { name: "vote no", exact: true }).click();
    await b.getByRole("button", { name: "vote yes", exact: true }).click();
    await b.waitForTimeout(400);

    await a.getByRole("button", { name: "reveal all", exact: true }).click();
    await b.waitForTimeout(800); // auto-reveal on phase change

    await expect(b.locator(".ballot-tally")).toContainText("1 yes");
    await expect(b.locator(".ballot-tally")).toContainText("1 no");
  } finally {
    await cleanup();
  }
});
