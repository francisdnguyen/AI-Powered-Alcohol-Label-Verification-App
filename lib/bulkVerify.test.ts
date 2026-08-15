import { afterEach, describe, expect, it, vi } from "vitest";

// Browser-only collaborators — stub them out so the client verify path runs under the node test env.
// downscaleImage would need a canvas; setVerdict would need localStorage. Neither is what we test here.
vi.mock("./imageClient", () => ({ downscaleImage: async (f: File) => f }));
const setVerdict = vi.fn();
vi.mock("./verdicts", () => ({ setVerdict: (...a: unknown[]) => setVerdict(...a) }));

import { bulkVerify, summarize, type BulkVerifySummary } from "./bulkVerify";

const targets = [
  { id: "a", labelImage: "/labels/a.png" },
  { id: "b", labelImage: "/labels/b.png" },
];

afterEach(() => {
  vi.restoreAllMocks();
  setVerdict.mockClear();
});

describe("bulkVerify cancellation", () => {
  it("returns immediately, marked cancelled, when the signal is already aborted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const summary = await bulkVerify(targets, AbortSignal.abort());

    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setVerdict).not.toHaveBeenCalled();
  });

  it("treats an AbortError during a label fetch as cancelled, not failed", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      // Simulate the browser rejecting the in-flight fetch once the caller aborts.
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const summary = await bulkVerify(targets, controller.signal);

    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBe(0);
    expect(setVerdict).not.toHaveBeenCalled();
  });

  it("still counts a genuine (non-abort) fetch failure as failed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));

    const summary = await bulkVerify(targets);

    expect(summary.cancelled).toBe(false);
    expect(summary.failed).toBe(2);
  });
});

describe("summarize (cancelled)", () => {
  const base: BulkVerifySummary = {
    approve: 0,
    review: 0,
    reject: 0,
    image: 0,
    failed: 0,
    cancelled: false,
  };

  it("reads plainly when cancelled before anything verified", () => {
    expect(summarize({ ...base, cancelled: true })).toBe("Verification cancelled.");
  });

  it("credits verdicts that landed before the cancel", () => {
    const msg = summarize({ ...base, approve: 2, review: 1, cancelled: true });
    expect(msg).toContain("Cancelled");
    expect(msg).toContain("verified 3 labels");
    expect(msg).toContain("2 ready");
    expect(msg).toContain("1 need review");
  });
});
