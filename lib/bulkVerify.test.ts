import { afterEach, describe, expect, it, vi } from "vitest";

// Browser-only collaborators — stub the pieces that need a canvas/localStorage, keep the rest real.
// downscaleImage would need a canvas; setVerdict would need localStorage. chunkBySize is pure, so we
// keep the actual implementation (bulkVerify imports it) via importActual.
vi.mock("./imageClient", async (importActual) => {
  const actual = await importActual<typeof import("./imageClient")>();
  return { ...actual, downscaleImage: async (f: File) => f };
});
const setVerdict = vi.fn();
vi.mock("./verdicts", () => ({ setVerdict: (...a: unknown[]) => setVerdict(...a) }));

/** A successful label-image fetch returning a tiny PNG blob. */
function labelResponse(): Response {
  return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), { status: 200 });
}
function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

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
      return Promise.reject(abortError());
    });

    const summary = await bulkVerify(targets, controller.signal);

    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBe(0);
    expect(setVerdict).not.toHaveBeenCalled();
  });

  it("treats an AbortError during the /api/batch POST as cancelled, not failed", async () => {
    // Labels fetch fine (phase 1); the chunk POST is what gets aborted (phase 2) — the realistic
    // single-chunk cancel, where the user hits Cancel while the one /api/batch request is in flight.
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/batch")) return Promise.reject(abortError());
      return Promise.resolve(labelResponse());
    });

    const summary = await bulkVerify(targets);

    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.approve + summary.review + summary.reject + summary.image).toBe(0);
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

  it("surfaces genuine failures even when cancelled before anything verified", () => {
    expect(summarize({ ...base, failed: 2, cancelled: true })).toBe(
      "Verification cancelled — 2 could not be checked.",
    );
  });

  it("surfaces failures alongside verdicts that landed before the cancel", () => {
    const msg = summarize({ ...base, approve: 1, failed: 1, cancelled: true });
    expect(msg).toContain("verified 1 label first");
    expect(msg).toContain("1 could not be checked");
  });
});
