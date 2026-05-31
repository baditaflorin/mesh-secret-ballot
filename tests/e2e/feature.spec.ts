import { expect, test, type Page } from "@playwright/test";
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

/**
 * Read the live Yjs doc on a page and return the commit-reveal state for the
 * current ballot key, plus a flat JSON dump of the WHOLE doc. This is how the
 * privacy assertion inspects what bytes peer B can actually see.
 */
async function readDoc(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __ballotRoom?: {
        doc: {
          getMap: (k: string) => Map<string, unknown> & { size: number };
          toJSON: () => unknown;
        };
        key: string;
      };
    };
    const h = w.__ballotRoom;
    if (!h) throw new Error("test handle window.__ballotRoom not present");
    const commits = h.doc.getMap(`${h.key}:commits`);
    const reveals = h.doc.getMap(`${h.key}:reveals`);
    const commitEntries: Record<string, string> = {};
    commits.forEach((v, k) => (commitEntries[k] = v as string));

    // Serialize ONLY the two vote sub-maps — the surface that must stay
    // vote-free during the commit phase. (The unrelated `question` text map is
    // user content and deliberately excluded.)
    const voteMapsJson = JSON.stringify({
      commits: (commits as unknown as { toJSON: () => unknown }).toJSON(),
      reveals: (reveals as unknown as { toJSON: () => unknown }).toJSON(),
    });

    // Compute the UNSALTED hashes an attacker would precompute for a 2-outcome
    // vote, to prove the published commitment isn't one of them (i.e. is salted).
    const enc = new TextEncoder();
    const sha = async (s: string) => {
      const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
      return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
    };
    const unsalted = {
      yes: await sha("yes"),
      no: await sha("no"),
      voteYes: await sha(JSON.stringify({ vote: "yes" })),
      voteNo: await sha(JSON.stringify({ vote: "no" })),
    };

    return {
      commitCount: commits.size,
      revealCount: reveals.size,
      commitHashes: Object.values(commitEntries),
      voteMapsJson,
      unsalted,
    };
  });
}

/**
 * Load-bearing privacy assertion: during the COMMIT phase, the shared doc must
 * contain only salted commitment hashes — no plaintext vote — and after reveal
 * BOTH peers must compute the same tally.
 *
 * Catches a regression where the vote leaks (e.g. an implementation that writes
 * `{vote:"yes"}` into the shared doc at commit time, or hashes the bare vote
 * with no salt so the 2-outcome commitment is trivially brute-forceable).
 */
test("commit phase leaks no plaintext vote; both peers agree on the revealed tally", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(500);

    await a.getByPlaceholder("the question").fill("Approve the budget?");
    await a.getByRole("button", { name: "open ballot", exact: true }).click();
    await b.waitForTimeout(400);

    // Both peers commit their (opposite) votes.
    await a.getByRole("button", { name: "vote no", exact: true }).click();
    await b.getByRole("button", { name: "vote yes", exact: true }).click();

    // Wait until both commitments have propagated into peer B's shared doc.
    // (Awareness/peer-count isn't reliably synced over BroadcastChannel in the
    // headless harness, so we wait on the CRDT commit map, not the chip text.)
    await b.waitForFunction(() => {
      const w = window as unknown as {
        __ballotRoom?: { doc: { getMap: (k: string) => { size: number } }; key: string };
      };
      const h = w.__ballotRoom;
      return !!h && h.doc.getMap(`${h.key}:commits`).size === 2;
    });

    // --- PRIVACY ASSERTION (commit phase, before any reveal) ---
    // Read the shared doc from peer B's process — what an honest curious peer
    // (or a network observer of the CRDT) can actually see.
    const seen = await readDoc(b);

    // Two commitment hashes are present; zero reveals so far.
    expect(seen.commitCount).toBe(2);
    expect(seen.revealCount).toBe(0);

    // The vote sub-maps must NOT contain the plaintext vote in any form: no
    // `vote` key, and neither `yes` nor `no` appears anywhere in commits/reveals.
    expect(seen.voteMapsJson).not.toContain("vote");
    expect(seen.voteMapsJson).not.toContain("yes");
    expect(seen.voteMapsJson).not.toContain("no");

    // Each published commitment must be a real 64-hex-char SHA-256 digest AND
    // must NOT equal any unsalted hash of the 2 possible votes — i.e. it is
    // salted, so a curious peer cannot brute-force the vote from the 2 options.
    const unsalted = new Set(Object.values(seen.unsalted));
    expect(seen.commitHashes).toHaveLength(2);
    for (const h of seen.commitHashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(unsalted.has(h)).toBe(false);
    }
    // The two voters chose opposite options, yet (salted) their commitments
    // are distinct random-looking digests — no structure leaks the vote.
    expect(seen.commitHashes[0]).not.toEqual(seen.commitHashes[1]);

    // --- TALLY ASSERTION (after reveal, identical on both peers) ---
    await a.getByRole("button", { name: "reveal all", exact: true }).click();
    await b.waitForTimeout(800); // auto-reveal fires on phase change

    for (const page of [a, b]) {
      await expect(page.locator(".ballot-tally")).toContainText("1 yes");
      await expect(page.locator(".ballot-tally")).toContainText("1 no");
      await expect(page.locator(".ballot-tally")).toContainText("2 of 2 revealed");
    }

    // After reveal the doc legitimately now contains the votes (2 reveals).
    const after = await readDoc(b);
    expect(after.revealCount).toBe(2);
  } finally {
    await cleanup();
  }
});
