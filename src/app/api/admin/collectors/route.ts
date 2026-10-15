import { z } from "zod";
import { DISTANCE_SENSOR_MODELS } from "@/lib/collector/distance-sensors";
import { CONNECTIVITY_MODES, registerCollector } from "@/lib/server/collector-registry";
import { registerSchool, setEnrolledStudents, UF_LIST } from "@/lib/server/school-registry";
import { isAdministrator } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/*
 * Cadastro de captador — operação de administração, invisível no app do usuário.
 *
 * Ninguém digita o código: ele é sequencial dentro da escola, e nasce PROTO
 * porque um tubo que ainda não mede nada não é um captador da escola. O ECO-nnn
 * vem quando a calibração é aceita.
 *
 * Aqui também entra a ESCOLA, com município e estado. Escalar é cadastrar
 * captadores em escolas novas, então o cadastro aceita uma escola que ainda não
 * existe — e só a administração da plataforma pode criá-la. Um administrador de
 * uma escola cadastra captador na escola dele, e em nenhuma outra.
 */
const schoolSchema = z.object({
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.enum(UF_LIST),
});

const bodySchema = z.object({
  location: z.string().trim().min(2, "Informe onde o captador será instalado.").max(80),
  name: z.string().trim().min(2).max(60).nullable().optional(),
  nominalDiameterMm: z.number().positive().max(1000),
  nominalUsefulHeightMm: z.number().positive().max(5000),
  reserveLiters: z.number().min(0).max(100),
  distanceSensor: z.enum(DISTANCE_SENSOR_MODELS).optional(),
  connectivity: z.enum(CONNECTIVITY_MODES).optional(),
  /** Escola já cadastrada. Sem isso e sem `school`, usa a escola de quem cadastra. */
  schoolId: z.string().uuid().optional(),
  /** Escola nova, com município e estado. Só a administração da plataforma. */
  school: schoolSchema.optional(),
  /**
   * Quantos estudantes a escola tem matriculados.
   *
   * Pedido aqui, na primeira etapa, porque é a única hora em que quem responde
   * é quem sabe — e porque sem ele o alcance do projeto fica sem denominador:
   * "280 missões" pode ser a escola inteira ou uma turma.
   */
  enrolledStudents: z.number().int().min(1).max(200_000).optional(),
  /**
   * Quando o ar-condicionado daquele bloco funciona.
   *
   * A água vem de UM aparelho: numa escola grande, o bloco das salas e o da
   * administração não ligam no mesmo horário. Omitido, herda o da escola.
   */
  acSchedule: z
    .object({
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      startMinutes: z.number().int().min(0).max(1439),
      endMinutes: z.number().int().min(1).max(1440),
    })
    .refine((valor) => valor.endMinutes > valor.startMinutes, { message: "O fim do expediente vem depois do início." })
    .optional(),
});

export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { actor } = auth;
    if (!isAdministrator(actor)) return jsonError(403, "Somente a administração cadastra captadores.");

    const pepper = process.env.IOT_TOKEN_PEPPER;
    if (!pepper || pepper.length < 32) return jsonError(503, "IOT_TOKEN_PEPPER não configurado no servidor.");

    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const { school, schoolId, enrolledStudents, ...collector } = body.data;

    if ((school || (schoolId && schoolId !== actor.schoolId)) && !actor.platformAdmin) {
      return jsonError(403, "Somente a administração da plataforma cadastra captadores em outras escolas.");
    }
    if (!school && !schoolId && !actor.schoolId) return jsonError(409, "Informe a escola do captador.");

    try {
      const criado = await getDatabase().transaction(async (tx) => {
        const alvo = school ? (await registerSchool(tx, school)).id : (schoolId ?? actor.schoolId!);
        if (enrolledStudents !== undefined) await setEnrolledStudents(tx, alvo, enrolledStudents);
        return registerCollector(tx, { ...collector, schoolId: alvo, createdBy: actor.profileId, pepper });
      });
      // O código de responsável e a senha da rede aparecem para quem cadastrou:
      // o primeiro é impresso e guardado dentro da caixa, o segundo o app mostra
      // depois a quem precisar socorrer o captador offline. Do código de
      // responsável, o banco guarda só o hash — não há como mostrá-lo de novo.
      return jsonOk(
        {
          code: criado.code,
          location: criado.location,
          name: criado.name,
          estimatedCapacityLiters: criado.estimatedCapacityLiters,
          distanceSensor: criado.distanceSensor,
          stewardCode: criado.stewardCode,
          network: criado.network,
          connectivity: criado.connectivity,
        },
        201,
      );
    } catch (error) {
      return jsonError(422, error instanceof Error ? error.message : "Não foi possível cadastrar o captador.");
    }
  });
}
