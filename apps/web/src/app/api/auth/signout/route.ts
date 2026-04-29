import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, enqueueMemoryExtractionJob } from "@agents/db";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const db = createServerClient();
    const { data: sessions } = await db
      .from("agent_sessions")
      .update({
        status: "closed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("channel", "web")
      .eq("status", "active")
      .select("id,user_id");

    for (const s of sessions ?? []) {
      await enqueueMemoryExtractionJob(db, s.user_id as string, s.id as string);
    }
  }

  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`, { status: 302 });
}
