import { NextResponse } from "next/server";
import { getJob } from "@/lib/batch";

export const runtime = "nodejs";

/** Poll a batch job's status and per-file results. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "That batch was not found. It may have expired (jobs reset on restart)." },
      { status: 404 },
    );
  }
  return NextResponse.json(job);
}
