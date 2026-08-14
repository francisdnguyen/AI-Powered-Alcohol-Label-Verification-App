import { notFound } from "next/navigation";
import { getApplication } from "@/lib/applications";
import { ReviewClient } from "./ReviewClient";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApplication(id);
  if (!app) notFound();
  return <ReviewClient app={app} />;
}
