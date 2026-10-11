import { getDatabase } from "@/lib/server/db/pg";
import { withErrors } from "@/lib/server/http";
import { ensureProfile } from "@/lib/server/profile-service";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

/**
 * Retorno do Google.
 *
 * O provedor devolve um código de uso único; aqui ele vira sessão em cookie e o
 * perfil é criado se for o primeiro acesso. Depois a pessoa cai na raiz, e é o
 * app que decide entre o primeiro acesso e a tela inicial — a decisão já existe
 * e depende de `onboarded_at`, não desta rota.
 *
 * Esta rota responde com redirecionamento (e não JSON) porque quem chega aqui é
 * o navegador voltando do Google, não uma chamada do app.
 */
export async function GET(request: Request) {
  return withErrors(async () => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const erroDoProvedor = url.searchParams.get("error_description") ?? url.searchParams.get("error");

    // A pessoa cancelou na tela do Google, ou o provedor recusou.
    if (erroDoProvedor || !code) {
      const destino = new URL("/entrar", url.origin);
      destino.searchParams.set("erro", erroDoProvedor ? "google" : "sem_codigo");
      return Response.redirect(destino, 303);
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      const destino = new URL("/entrar", url.origin);
      destino.searchParams.set("erro", "sessao");
      return Response.redirect(destino, 303);
    }

    await ensureProfile(getDatabase(), data.user.id);
    return Response.redirect(new URL("/", url.origin), 303);
  });
}
