import { buildDocumentPdf } from "@/lib/collector/document-pdf";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { DEFAULT_DISTANCE_SENSOR, isDistanceSensorModel } from "@/lib/collector/distance-sensors";
import { constructionGuideDocument, firmwareGuideDocument, type GuideContext } from "@/lib/collector/setup-guides";
import { isStewardOf } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, withErrors } from "@/lib/server/http";

/*
 * Os manuais deste captador, em PDF.
 *
 * Gerados na hora, com as medidas do tubo da escola e o sensor que ela escolheu.
 * Um arquivo estático na pasta seria mais simples e estaria errado no dia em que
 * alguém trocasse o sensor — e ninguém reimprime um manual que não avisa que
 * mudou.
 *
 * Nenhum segredo entra aqui: o token do dispositivo mora só no arquivo
 * secrets.h, que a tela entrega uma vez. O guia circula, é impresso e fica em
 * cima da mesa da sala de informática.
 */
const GUIDES = {
  construcao: { build: constructionGuideDocument, file: "manual-construcao" },
  firmware: { build: firmwareGuideDocument, file: "manual-gravacao" },
} as const;

type GuideId = keyof typeof GUIDES;
const isGuideId = (value: string): value is GuideId => value in GUIDES;

interface Row {
  id: string;
  code: string;
  location: string;
  distance_sensor: string | null;
  nominal_diameter_mm: number | null;
  nominal_useful_height_mm: number | null;
  reserve_liters: string | number;
  hotspot_ssid: string | null;
  hotspot_password: string | null;
  school_name: string;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/guides/[guide]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;

    const { code, guide } = await ctx.params;
    // `?abrir=1`: mostrar no navegador em vez de baixar. No celular é a
    // diferença entre o manual aparecer e sumir numa pasta de downloads.
    const abrir = new URL(_request.url).searchParams.get("abrir") === "1";
    if (!isGuideId(guide)) return jsonError(404, "Manual não encontrado.");
    const normalizado = normalizeCollectorCode(code);
    if (!normalizado || !auth.actor.schoolId) return jsonError(404, "Captador não encontrado.");

    const { rows } = await getDatabase().query<Row>(
      `select c.id, c.code, c.location, c.distance_sensor, c.nominal_diameter_mm, c.nominal_useful_height_mm,
              c.reserve_liters, c.hotspot_ssid, c.hotspot_password, s.name as school_name
       from public.collectors c join public.schools s on s.id = c.school_id
       where c.code = $1 and c.school_id = $2`,
      [normalizado, auth.actor.schoolId],
    );
    const captador = rows[0];
    if (!captador) return jsonError(404, "Captador não encontrado.");
    if (!isStewardOf(auth.actor, captador.id, auth.actor.schoolId)) {
      return jsonError(403, "Esta área é de quem conduz a construção do captador.");
    }

    const context: GuideContext = {
      collectorCode: captador.code,
      schoolName: captador.school_name,
      location: captador.location,
      distanceSensor: isDistanceSensorModel(captador.distance_sensor) ? captador.distance_sensor : DEFAULT_DISTANCE_SENSOR,
      nominalDiameterMm: captador.nominal_diameter_mm ?? 100,
      nominalUsefulHeightMm: captador.nominal_useful_height_mm ?? 1500,
      reserveLiters: Number(captador.reserve_liters ?? 0),
      // Captador cadastrado antes da rede de configuração não tem hotspot; o
      // manual diz isso em vez de imprimir "null" ao lado de "senha".
      hotspotSsid: captador.hotspot_ssid ?? "(gerada ao cadastrar o captador)",
      hotspotPassword: captador.hotspot_password ?? "(gerada ao cadastrar o captador)",
    };

    const { build, file } = GUIDES[guide];
    const pdf = buildDocumentPdf(build(context));
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${abrir ? "inline" : "attachment"}; filename="${file}-${captador.code}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
