import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadVerdicts, getVerdict, setVerdict, clearVerdict, type StoredVerdict } from "./verdicts";
import type { ReviewResult } from "./matcher";

const KEY = "ttb-verdicts";

const review: ReviewResult = {
  fields: [],
  summary: { match: 5, mismatch: 0, missing: 0, review: 1, total: 6 },
  overall: "attention",
};

function sampleVerdict(): StoredVerdict {
  return {
    recommendation: { level: "review", label: "Needs agent review", reason: "1 field needs a closer look." },
    review,
    verifiedAt: 1_700_000_000_000,
    totalMs: 3200,
    model: "claude-haiku-4-5",
  };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("verdicts", () => {
  it("returns empty / undefined when nothing is stored", () => {
    expect(loadVerdicts()).toEqual({});
    expect(getVerdict("app-x")).toBeUndefined();
  });

  it("round-trips a stored verdict", () => {
    const v = sampleVerdict();
    setVerdict("app-1", v);
    expect(getVerdict("app-1")).toEqual(v);
    expect(loadVerdicts()).toEqual({ "app-1": v });
  });

  it("overwrites an existing verdict for the same application", () => {
    setVerdict("app-1", sampleVerdict());
    const newer = { ...sampleVerdict(), verifiedAt: 1_700_000_100_000 };
    setVerdict("app-1", newer);
    expect(getVerdict("app-1")?.verifiedAt).toBe(1_700_000_100_000);
  });

  it("clears a stored verdict", () => {
    setVerdict("app-1", sampleVerdict());
    clearVerdict("app-1");
    expect(getVerdict("app-1")).toBeUndefined();
    expect(loadVerdicts()).toEqual({});
  });

  it("self-heals corrupt (non-object) storage without throwing", () => {
    window.localStorage.setItem(KEY, "true");
    expect(loadVerdicts()).toEqual({});
    expect(() => setVerdict("app-2", sampleVerdict())).not.toThrow();
    expect(getVerdict("app-2")).toEqual(sampleVerdict());
  });
});
