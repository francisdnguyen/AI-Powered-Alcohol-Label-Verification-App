/**
 * Agent dispositions for the review queue, persisted in the browser. Prototype-scale only:
 * localStorage is per-browser and unsuitable for real auditing — production would record
 * dispositions server-side against the COLA record. Kept deliberately tiny and client-only.
 */

export type Disposition = "pending" | "approved" | "rejected" | "needs-info";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  "needs-info": "Needs info",
};

const KEY = "ttb-dispositions";

export function loadDispositions(): Record<string, Disposition> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Guard against corrupt/tampered storage (a JSON primitive or array): callers assign into
    // this object, which would throw on a non-object. Self-heal to an empty map instead.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, Disposition>;
  } catch {
    return {};
  }
}

export function getDisposition(id: string): Disposition {
  return loadDispositions()[id] ?? "pending";
}

export function setDisposition(id: string, value: Disposition): void {
  if (typeof window === "undefined") return;
  const all = loadDispositions();
  if (value === "pending") {
    delete all[id];
  } else {
    all[id] = value;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
    // Let other open tabs / components refresh.
    window.dispatchEvent(new Event("ttb-dispositions-changed"));
  } catch {
    /* storage full or blocked — non-fatal for a prototype */
  }
}
