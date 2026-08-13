import { NextResponse } from "next/server";
import { listApplications } from "@/lib/applications";

export const runtime = "nodejs";

/** Lightweight list of mock COLA applications for the "match against application" picker. */
export async function GET() {
  return NextResponse.json({ applications: listApplications() });
}
