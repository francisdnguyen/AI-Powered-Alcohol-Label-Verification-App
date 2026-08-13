import { NextResponse } from "next/server";
import { getBudgetStatus } from "@/lib/budget";

export const runtime = "nodejs";

/** Current Claude-spend status against the $5 cap, for a UI indicator. */
export async function GET() {
  return NextResponse.json(getBudgetStatus());
}
