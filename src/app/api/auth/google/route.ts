import { jsonError, jsonOk, withErrors } from "@/lib/server/http";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

/**
 * Início do login com Google.
 *
 * O servidor pede ao Supabase o endereço de autorização e devolve para o app
 * redirecionar. O `redirectTo` aponta para a nossa rota de retorno, que é quem
 * troca o código por sessão — o navegador nunca vê segredo nenhum.
 *
 * A URL de retorno é derivada da requisição, e não de uma constante, para o
 * fluxo funcionar igual em localhost, na prévia e em produção. Ela ainda precisa
 * estar autorizada no Google Cloud Console.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const supabase = await createSupabaseServerClient();
    const origin = new URL(request.url).origin;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/api/auth/callback`,
        // Pede o e-mail e o perfil básico. Nada além disso é necessário.
        scopes: "email profile",
      },
    });

    if (error || !data.url) {
      // Acontece quando o provedor Google ainda não foi ativado no Supabase.
      return jsonError(503, "Entrada pelo Google indisponível no momento.");
    }
    return jsonOk({ url: data.url });
  });
}
