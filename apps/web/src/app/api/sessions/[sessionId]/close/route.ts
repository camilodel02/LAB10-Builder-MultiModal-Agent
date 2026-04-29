import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, enqueueMemoryExtractionJob } from "@agents/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServerClient();
  const { data: session } = await db
    .from("agent_sessions")
    .update({
      status: "closed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .select("id,user_id")
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await enqueueMemoryExtractionJob(db, user.id, sessionId);
  return NextResponse.json({ ok: true });
}
