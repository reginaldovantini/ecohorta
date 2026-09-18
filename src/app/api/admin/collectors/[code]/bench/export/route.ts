import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { getBenchService } from "@/lib/server/benches";
import { jsonError, withErrors } from "@/lib/server/http";

const KINDS = ["readings", "observations", "validations"] as const;

/** CSV para análise em planilha: ?tipo=readings|observations|validations&horas=24 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/admin/collectors/[code]/bench/export">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const kind = KINDS.find((item) => item === request.nextUrl.searchParams.get("tipo"));
    if (!kind) return jsonError(422, "Informe tipo=readings, observations ou validations.");
    const hours = Number(request.nextUrl.searchParams.get("horas") ?? "24");
    const result = await getBenchService().exportCsv(auth.actor, code, kind, Number.isFinite(hours) ? hours : 24);
    if (!result.ok) return jsonError(result.status, result.message);
    const filename = `${code.toUpperCase()}-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(`﻿${result.value}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
