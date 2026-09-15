import { jsonOk, withErrors } from "@/lib/server/http";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

export async function POST() {
  return withErrors(async () => {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return jsonOk({ ok: true });
  });
}
