import { buildStickerPdf } from "@/lib/collector/qr-sticker";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { isAdministrator, isStewardOf } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, withErrors } from "@/lib/server/http";

/**
 * PDF do adesivo do captador, para imprimir e colar no tubo.
 *
 * Só administração e quem é responsável pelo captador. O arquivo carrega o token
 * do QR, e quem tem o token pode fazer missão naquele tubo de qualquer lugar —
 * então ele não é público, mesmo sendo "só um adesivo".
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/sticker">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;

    const { code } = await ctx.params;
    const normalizado = normalizeCollectorCode(code);
    if (!normalizado || !auth.actor.schoolId) return jsonError(404, "Captador não encontrado.");

    const { rows } = await getDatabase().query<{
      id: string;
      code: string;
      location: string;
      qr_token: string;
      school_name: string;
    }>(
      `select c.id, c.code, c.location, c.qr_token, s.name as school_name
       from public.collectors c
       join public.schools s on s.id = c.school_id
       where c.code = $1 and c.school_id = $2`,
      [normalizado, auth.actor.schoolId],
    );
    const captador = rows[0];
    if (!captador) return jsonError(404, "Captador não encontrado.");
    if (!isAdministrator(auth.actor) && !isStewardOf(auth.actor, captador.id)) {
      return jsonError(403, "Somente a administração e quem é responsável pelo captador imprimem o adesivo.");
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(_request.url).origin).replace(/\/$/, "");
    const pdf = buildStickerPdf({
      url: `${base}/q/${captador.qr_token}`,
      code: captador.code,
      location: captador.location,
      schoolName: captador.school_name,
    });

    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="adesivo-${captador.code}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
