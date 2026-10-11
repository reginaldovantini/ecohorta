import { z } from "zod";
import { DISTANCE_SENSOR_MODELS } from "@/lib/collector/distance-sensors";
import { registerCollector } from "@/lib/server/collector-registry";
import { isAdministrator } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/*
 * Cadastro de captador — operação de administração, invisível no app do usuário.
 *
 * Ninguém digita o código: ele é sequencial dentro da escola. O que se informa é
 * a LOCALIZAÇÃO, que é o que a pessoa lê no app para saber a que tubo ir.
 */
const bodySchema = z.object({
  location: z.string().trim().min(2, "Informe onde o captador será instalado.").max(80),
  name: z.string().trim().min(2).max(60).nullable().optional(),
  nominalDiameterMm: z.number().positive().max(1000),
  nominalUsefulHeightMm: z.number().positive().max(5000),
  reserveLiters: z.number().min(0).max(100),
  distanceSensor: z.enum(DISTANCE_SENSOR_MODELS).optional(),
});

export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!isAdministrator(auth.actor)) return jsonError(403, "Somente a administração cadastra captadores.");
    if (!auth.actor.schoolId) return jsonError(409, "Esta conta ainda não está vinculada a uma escola.");

    const pepper = process.env.IOT_TOKEN_PEPPER;
    if (!pepper || pepper.length < 32) return jsonError(503, "IOT_TOKEN_PEPPER não configurado no servidor.");

    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;

    try {
      const criado = await getDatabase().transaction((tx) =>
        registerCollector(tx, { ...body.data, schoolId: auth.actor.schoolId!, createdBy: auth.actor.profileId, pepper }),
      );
      // O código de responsável aparece UMA vez: o banco guarda só o hash.
      return jsonOk(
        {
          code: criado.code,
          location: criado.location,
          name: criado.name,
          estimatedCapacityLiters: criado.estimatedCapacityLiters,
          distanceSensor: criado.distanceSensor,
          stewardCode: criado.stewardCode,
        },
        201,
      );
    } catch (error) {
      return jsonError(422, error instanceof Error ? error.message : "Não foi possível cadastrar o captador.");
    }
  });
}
