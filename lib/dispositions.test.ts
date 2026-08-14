import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDispositions, getDisposition, setDisposition } from "./dispositions";

const KEY = "ttb-dispositions";

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

describe("dispositions", () => {
  it("defaults to empty / pending when nothing is stored", () => {
    expect(loadDispositions()).toEqual({});
    expect(getDisposition("app-x")).toBe("pending");
  });

  it("round-trips a set value", () => {
    setDisposition("app-1", "approved");
    expect(getDisposition("app-1")).toBe("approved");
    expect(loadDispositions()).toEqual({ "app-1": "approved" });
  });

  it("setting pending deletes the key", () => {
    setDisposition("app-1", "rejected");
    setDisposition("app-1", "pending");
    expect(loadDispositions()).toEqual({});
    expect(getDisposition("app-1")).toBe("pending");
  });

  it("self-heals corrupt (non-object) storage without throwing", () => {
    window.localStorage.setItem(KEY, "true");
    expect(loadDispositions()).toEqual({});
    expect(() => setDisposition("app-2", "approved")).not.toThrow();
    expect(getDisposition("app-2")).toBe("approved");
  });
});
