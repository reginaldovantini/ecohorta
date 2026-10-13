import { flashingGuide, secretsHeader, type FirmwareIdentity, type FlashingStep } from "@/lib/collector/firmware-package";
import { MANUAL_STEPS, nextAction, setupJourney, type SetupFacts, type SetupJourney, type SetupStepId } from "@/lib/collector/setup-journey";
import { allSetupResources, type SetupResource } from "@/lib/collector/setup-resources";
import { administersSchool, isStewardOf, type Actor } from "./actor";
import { calibrationAppliesToDevice, COLLECTOR_SELECT, type CollectorRow } from "./collector-service";
import { reissueStewardCode, type CollectorConnectivity } from "./collector-registry";
import { millis, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";
import { ensureDevice, generateSecret } from "./provisioning";

/*
 * "O QUE EU FAÇO AGORA?" — a área que recebe quem está construindo um captador.
 *
 * Replicar o projeto é a diferença entre um protótipo bonito e uma rede de
 * escolas. E quem replica não é engenheiro: é um professor de biologia com um
 * tubo de PVC, três estudantes e uma placa que ele nunca viu antes.
 *
 * Este serviço existe para que essa pessoa nunca precise perguntar o que vem
 * depois. Ele junta os FATOS do banco — tem dispositivo? já falou? já calibrou? —
 * e devolve o caminho inteiro com uma única etapa acesa, o material daquela
 * etapa e a frase do que fazer agora.
 *
 * Duas coisas ele NÃO faz, de propósito:
 *
 *   não guarda a senha do Wi-Fi da escola. Ela é digitada na própria placa, na
 *   rede que a placa cria, e fica na memória dela;
 *
 *   não deixa ninguém marcar "calibrado". Montagem e identificação se marcam à
 *   mão porque a plataforma não enxerga um tubo pintado; medição, não: ou o
 *   sensor mediu, ou não mediu.
 */

interface SetupRow {
  id: string;
  school_id: string;
  code: string;
  proto_code: string | null;
  name: string;
  location: string;
  activated_at: Date | string | null;
  hotspot_ssid: string | null;
  hotspot_password: string | null;
  connectivity: CollectorConnectivity;
  school_name: string;
  school_city: string | null;
  school_state: string | null;
  marks: string[] | null;
}

export interface CollectorSetupView {
  collectorId: string;
  /** Código atual: PROTO-nnn enquanto é obra, ECO-nnn depois de habilitado. */
  code: string;
  /** O código de protótipo, quando o captador já foi habilitado. */
  protoCode: string | null;
  name: string;
  location: string;
  school: { name: string; city: string | null; state: string | null };
  journey: SetupJourney;
  /** A frase em destaque na tela. */
  nextAction: string;
  /** Nome e senha da rede do captador: configurar na instalação, socorrer no pátio. */
  network: { ssid: string; password: string } | null;
  connectivity: CollectorConnectivity;
  /** Identificação da placa, quando já existe uma registrada. */
  deviceKey: string | null;
  /** Última vez que a placa falou. `null` = nunca falou. */
  lastSeenAt: number | null;
  /** Manual e artes, cada um já sabendo se abre. */
  resources: SetupResource[];
}

export interface FirmwarePackage {
  /** Nome do arquivo que a pessoa salva na pasta do projeto. */
  fileName: string;
  /** Conteúdo de `firmware/include/secrets.h`. Contém o token em claro. */
  content: string;
  identity: FirmwareIdentity;
  guide: FlashingStep[];
  /** O token anterior deixou de valer: a placa precisa ser regravada. */
  replacedPreviousDevice: boolean;
}

const asMarks = (row: SetupRow): readonly string[] => row.marks ?? [];

/** Nome da placa, derivado do captador: estável, único e legível no monitor serial. */
export const deviceKeyFor = (collectorId: string) => `ESP32-${collectorId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/**
 * Os fatos que decidem a etapa atual. Nenhum deles é uma opinião:
 * `everConnected` é a placa tendo falado, `calibrated` é calibração ativa que
 * vale para o dispositivo de hoje (trocar o sensor derruba a anterior — é a
 * mesma regra de `calibrationAppliesToDevice`).
 */
export function setupFactsFrom(row: SetupRow, collector: CollectorRow): SetupFacts {
  return {
    registered: true,
    marked: asMarks(row),
    deviceRegistered: collector.device_id !== null,
    everConnected: millis(collector.last_seen_at) !== null,
    calibrated: calibrationAppliesToDevice(collector),
    activated: row.activated_at !== null,
  };
}

export function createCollectorSetupService({ db }: { db: Database }) {
  async function load(tx: Queryable, code: string) {
    const setup = await tx.query<SetupRow>(
      `select c.id, c.school_id, c.code, c.proto_code, c.name, c.location, c.activated_at, c.hotspot_ssid, c.hotspot_password,
              c.connectivity, s.name as school_name, s.city as school_city, s.state as school_state,
              (select array_agg(m.step::text) from public.collector_setup_marks m where m.collector_id = c.id) as marks
       from public.collectors c join public.schools s on s.id = c.school_id
       where c.code = $1`,
      [code],
    );
    const row = setup.rows[0];
    if (!row) return null;
    const collector = await tx.query<CollectorRow>(`${COLLECTOR_SELECT} where c.id = $1`, [row.id]);
    return collector.rows[0] ? { row, collector: collector.rows[0] } : null;
  }

  function view(row: SetupRow, collector: CollectorRow): CollectorSetupView {
    const journey = setupJourney(setupFactsFrom(row, collector));
    return {
      collectorId: row.id,
      code: row.code,
      // Enquanto é obra, o código de protótipo é o código atual: não há "antes" a
      // contar. Depois da habilitação, ele é a história do captador.
      protoCode: row.proto_code === row.code ? null : row.proto_code,
      name: row.name,
      location: row.location,
      school: { name: row.school_name, city: row.school_city, state: row.school_state },
      journey,
      nextAction: nextAction(journey),
      network: row.hotspot_ssid && row.hotspot_password ? { ssid: row.hotspot_ssid, password: row.hotspot_password } : null,
      connectivity: row.connectivity,
      deviceKey: collector.device_key ?? null,
      lastSeenAt: millis(collector.last_seen_at),
      resources: allSetupResources(),
    };
  }

  /**
   * Quem conduz a construção: quem administra a ESCOLA do captador, ou quem
   * digitou o código impresso dentro da caixa eletrônica dele.
   *
   * A escola entra na conta de propósito: sem ela, quem foi autorizado a
   * administrar uma escola alcançaria o tubo de qualquer outra.
   */
  const mayConduct = (actor: Actor, collectorId: string, schoolId: string) =>
    isStewardOf(actor, collectorId, schoolId);

  return {
    /** A tela inteira: caminho, etapa atual, material e o que fazer agora. */
    async journey(actor: Actor, code: string): Promise<ServiceResult<CollectorSetupView>> {
      return db.transaction(async (tx) => {
        const found = await load(tx, code);
        if (!found) return fail(404, "Captador não encontrado.");
        if (!mayConduct(actor, found.row.id, found.row.school_id)) return fail(403, "Esta área é de quem conduz a construção do captador.");
        return { ok: true, value: view(found.row, found.collector) };
      });
    },

    /**
     * Marca (ou desmarca) uma etapa feita à mão. Só montagem e identificação:
     * conexão e calibração vêm do sensor, e nenhum botão as inventa.
     */
    async markStep(actor: Actor, code: string, step: SetupStepId, done: boolean): Promise<ServiceResult<CollectorSetupView>> {
      if (!(MANUAL_STEPS as readonly string[]).includes(step)) {
        return fail(422, "Esta etapa não se marca à mão: ela vem da medição do captador.");
      }
      return db.transaction(async (tx) => {
        const found = await load(tx, code);
        if (!found) return fail(404, "Captador não encontrado.");
        if (!mayConduct(actor, found.row.id, found.row.school_id)) return fail(403, "Esta área é de quem conduz a construção do captador.");

        if (done) {
          await tx.query(
            `insert into public.collector_setup_marks (collector_id, step, marked_by) values ($1, $2, $3)
             on conflict (collector_id, step) do update set marked_at = now(), marked_by = excluded.marked_by`,
            [found.row.id, step, actor.profileId],
          );
        } else {
          await tx.query("delete from public.collector_setup_marks where collector_id = $1 and step = $2", [found.row.id, step]);
        }
        const updated = (await load(tx, code))!;
        return { ok: true, value: view(updated.row, updated.collector) };
      });
    },

    /**
     * Emite um código de responsável novo.
     *
     * O anterior para de valer na mesma hora. É a única resposta possível a
     * "perdi o código": o banco guarda só o hash, de propósito — quem digita
     * esse código passa a conduzir o captador, e credencial que se recupera é
     * credencial que vaza junto com o banco.
     */
    async reissueStewardCode(actor: Actor, code: string, pepper: string): Promise<ServiceResult<{ stewardCode: string }>> {
      return db.transaction(async (tx) => {
        const found = await load(tx, code);
        if (!found) return fail(404, "Captador não encontrado.");
        // Quem REEMITE é quem administra a escola do captador. Ser responsável
        // não basta: senão quem tem o código de hoje emitiria o de amanhã, e a
        // administração perderia o controle de quem conduz o próprio tubo.
        if (!administersSchool(actor, found.row.school_id)) {
          return fail(403, "Somente a administração da escola emite um código de responsável novo.");
        }
        const novo = await reissueStewardCode(tx, found.row.id, pepper);
        if (!novo) return fail(409, "Este captador não está ativo.");
        return { ok: true, value: { stewardCode: novo } };
      });
    },

    /**
     * Gera o programa desta placa: um `secrets.h` com a identidade do captador e
     * o passo a passo da gravação.
     *
     * Gerar de novo troca o token — não há como mostrar o anterior, porque o
     * banco só guarda o hash. Se já existe uma placa falando, isso a cala até
     * ser regravada, e por isso exige confirmação explícita em vez de acontecer
     * por um toque sem aviso.
     */
    async issueFirmware(
      actor: Actor,
      code: string,
      options: { apiBaseUrl: string; pepper: string; confirmReplacement?: boolean },
    ): Promise<ServiceResult<FirmwarePackage>> {
      const found = await db.transaction(async (tx) => load(tx, code));
      if (!found) return fail(404, "Captador não encontrado.");
      if (!mayConduct(actor, found.row.id, found.row.school_id)) return fail(403, "Esta área é de quem conduz a construção do captador.");
      const { row, collector } = found;
      if (!row.hotspot_ssid || !row.hotspot_password) return fail(409, "Este captador foi cadastrado antes da rede de configuração.");

      const falou = millis(collector.last_seen_at) !== null;
      if (falou && !options.confirmReplacement) {
        return fail(
          409,
          "Este captador já tem uma placa enviando dados. Gerar um programa novo faz a placa atual parar até ser regravada.",
        );
      }

      const deviceKey = collector.device_key ?? deviceKeyFor(row.id);
      const token = generateSecret();
      await ensureDevice(db, { collectorId: row.id, deviceKey, isSimulated: false, token, pepper: options.pepper });

      const identity: FirmwareIdentity = {
        collectorCode: row.code,
        deviceKey,
        deviceToken: token,
        apiBaseUrl: options.apiBaseUrl.replace(/\/$/, ""),
        hotspotSsid: row.hotspot_ssid,
        hotspotPassword: row.hotspot_password,
      };
      return {
        ok: true,
        value: {
          fileName: "secrets.h",
          content: secretsHeader(identity),
          identity,
          guide: flashingGuide(identity),
          replacedPreviousDevice: falou,
        },
      };
    },
  };
}

export type CollectorSetupService = ReturnType<typeof createCollectorSetupService>;
