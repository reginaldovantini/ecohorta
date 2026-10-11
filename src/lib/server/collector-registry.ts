import { createHash, randomBytes, randomInt } from "node:crypto";
import { nominalCapacityLiters } from "@/lib/collector/volume-calibration";
import { DEFAULT_DISTANCE_SENSOR, isDistanceSensorModel, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import type { Queryable } from "./db/types";

/*
 * CADASTRO DE CAPTADORES — operação de administração, invisível no app do usuário.
 *
 * Três coisas nascem aqui e nunca mais mudam:
 *   1. o CÓDIGO, sequencial dentro da escola (EC-001, EC-002, ...). Não é digitado:
 *      quem cadastra informa a LOCALIZAÇÃO, que é o que a pessoa lê no app. O código
 *      é só identificação técnica (URL, firmware, etiqueta);
 *   2. o TOKEN DO QR, colado no tubo. Quem lê entra na escola daquele captador e
 *      pode fazer missão nele;
 *   3. o CÓDIGO DE RESPONSÁVEL, impresso para guardar DENTRO da caixa eletrônica.
 *      Quem abre a caixa e digita o código passa a calibrar e configurar aquele
 *      captador. Só o hash é guardado — como já acontece com o token do dispositivo.
 *
 * A capacidade informada aqui é ESTIMADA pela geometria do tubo. A capacidade que o
 * app usa passa a ser a medida, assim que a calibração daquele captador é aceita
 * (docs/CALIBRACAO.md). Captador recém-cadastrado não entrega litros nem aparece em
 * missão até ser calibrado.
 */

/**
 * Prefixo do código. Cada um tem a PRÓPRIA sequência dentro da escola, para que o
 * captador da simulação não ocupe o número do físico:
 *   EC-nnn  → captador físico (ESP32 + sensor)
 *   SIM-nnn → captador da simulação (dispositivo virtual)
 */
export const COLLECTOR_PREFIXES = ["EC", "SIM"] as const;
export type CollectorPrefix = (typeof COLLECTOR_PREFIXES)[number];
const MAX_SEQ = 999;

/** Sem 0/O e 1/I: o código é lido de um papel dentro da caixa, muitas vezes com pouca luz. */
const STEWARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STEWARD_GROUPS = 3;
const STEWARD_GROUP_SIZE = 4;

export const formatCollectorCode = (seq: number, prefix: CollectorPrefix = "EC") => `${prefix}-${String(seq).padStart(3, "0")}`;

export const hashStewardCode = (code: string, pepper: string) => createHash("sha256").update(`steward:${pepper}:${normalizeStewardCode(code) ?? code}`).digest("hex");

export const generateQrToken = () => randomBytes(16).toString("hex");

/** Ex.: "H7KQ-3M9P-TR24". Gerado uma vez, mostrado uma vez, guardado só como hash. */
export function generateStewardCode() {
  const groups: string[] = [];
  for (let g = 0; g < STEWARD_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < STEWARD_GROUP_SIZE; i++) group += STEWARD_ALPHABET[randomInt(0, STEWARD_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

/** Aceita o código digitado com ou sem hífen, em qualquer caixa. `null` se não reconhecer. */
export function normalizeStewardCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== STEWARD_GROUPS * STEWARD_GROUP_SIZE) return null;
  if (![...compact].every((character) => STEWARD_ALPHABET.includes(character))) return null;
  return compact.match(/.{4}/g)!.join("-");
}

/**
 * Próximo número da escola. Trava a linha da escola para que dois cadastros
 * simultâneos não recebam o mesmo número; a unique (school_id, seq) é a rede de segurança.
 */
export async function nextCollectorSeq(tx: Queryable, schoolId: string, prefix: CollectorPrefix = "EC"): Promise<number> {
  await tx.query("select 1 from public.schools where id = $1 for update", [schoolId]);
  const { rows } = await tx.query<{ next: number | string | null }>(
    "select max(seq) + 1 as next from public.collectors where school_id = $1 and prefix = $2",
    [schoolId, prefix],
  );
  const next = Number(rows[0]?.next ?? 1) || 1;
  if (next > MAX_SEQ) throw new Error(`Esta escola já tem ${MAX_SEQ} captadores cadastrados.`);
  return next;
}

export interface CollectorRegistrationInput {
  schoolId: string;
  /** O que a pessoa lê no app: onde o tubo está instalado. */
  location: string;
  /** Nome amigável; sem nome, usa a localização. */
  name?: string | null;
  nominalDiameterMm: number;
  nominalUsefulHeightMm: number;
  reserveLiters: number;
  /** "EC" (físico, padrão) ou "SIM" (simulação). Cada um numera por conta própria. */
  prefix?: CollectorPrefix;
  distanceSensor?: DistanceSensorModel | string | null;
  createdBy: string | null;
  /** Segredo do ambiente usado no hash do código de responsável. */
  pepper: string;
}

export interface CollectorRegistration {
  id: string;
  prefix: CollectorPrefix;
  seq: number;
  code: string;
  name: string;
  location: string;
  /** Capacidade estimada pela geometria, substituída pela calibração. */
  estimatedCapacityLiters: number;
  distanceSensor: DistanceSensorModel;
  /** Vai no QR colado no tubo. */
  qrToken: string;
  /** Mostrado UMA vez, para imprimir e guardar dentro da caixa eletrônica. */
  stewardCode: string;
}

/**
 * Cadastra um captador na escola. Devolve o código de responsável em claro uma única
 * vez: o banco guarda só o hash, e não há como recuperá-lo depois — só gerar outro.
 */
export async function registerCollector(tx: Queryable, input: CollectorRegistrationInput): Promise<CollectorRegistration> {
  const location = input.location.trim();
  if (location.length < 2) throw new Error("Informe onde o captador será instalado.");
  const name = (input.name ?? "").trim() || location;

  const estimated = nominalCapacityLiters({ diameterMm: input.nominalDiameterMm, usefulHeightMm: input.nominalUsefulHeightMm });
  if (estimated === null || !(estimated > 0)) throw new Error("Informe diâmetro e altura útil do tubo.");
  if (input.reserveLiters < 0 || input.reserveLiters >= estimated) {
    throw new Error("A reserva precisa ser menor que a capacidade estimada.");
  }

  const sensor = isDistanceSensorModel(input.distanceSensor) ? input.distanceSensor : DEFAULT_DISTANCE_SENSOR;
  const prefix = input.prefix ?? "EC";
  const seq = await nextCollectorSeq(tx, input.schoolId, prefix);
  const code = formatCollectorCode(seq, prefix);
  const qrToken = generateQrToken();
  const stewardCode = generateStewardCode();

  const { rows } = await tx.query<{ id: string }>(
    `insert into public.collectors
       (school_id, prefix, seq, code, name, location, capacity_liters, reserve_liters, nominal_diameter_mm,
        nominal_useful_height_mm, distance_sensor, qr_token, steward_code_hash, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning id`,
    [
      input.schoolId,
      prefix,
      seq,
      code,
      name,
      location,
      Math.round(estimated * 1000) / 1000,
      input.reserveLiters,
      input.nominalDiameterMm,
      input.nominalUsefulHeightMm,
      sensor,
      qrToken,
      hashStewardCode(stewardCode, input.pepper),
      input.createdBy,
    ],
  );
  const id = rows[0]!.id;
  // Sem dispositivo ainda: o estado nasce vazio e o captador fica OFFLINE até o ESP32 falar.
  await tx.query("insert into public.collector_state (collector_id) values ($1) on conflict (collector_id) do nothing", [id]);

  return {
    id,
    prefix,
    seq,
    code,
    name,
    location,
    estimatedCapacityLiters: Math.round(estimated * 1000) / 1000,
    distanceSensor: sensor,
    qrToken,
    stewardCode,
  };
}

export interface ScanResult {
  collectorId: string;
  code: string;
  name: string;
  location: string;
  schoolId: string;
  scanId: string;
  /** A leitura trouxe esta pessoa para a escola do captador — a primeira ou mais uma. */
  joinedSchool: boolean;
}

/**
 * Leitura do QR do tubo. Registra a presença e, se a pessoa ainda não tem escola,
 * vincula-a à escola daquele captador — é assim que alguém entra numa escola.
 */
export async function scanCollector(tx: Queryable, profileId: string, qrToken: string): Promise<ScanResult | null> {
  const token = qrToken.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(token)) return null;

  const { rows } = await tx.query<{ id: string; code: string; name: string; location: string; school_id: string }>(
    "select id, code, name, location, school_id from public.collectors where qr_token = $1 and active",
    [token],
  );
  const collector = rows[0];
  if (!collector) return null;

  // Ler o QR é o que liga a pessoa a uma escola — e ela pode pertencer a várias.
  // `returning` em vez de rowCount: a interface Queryable do projeto expõe só as linhas.
  const ingressou = await tx.query<{ profile_id: string }>(
    `insert into public.school_members (profile_id, school_id, joined_via_collector) values ($1, $2, $3)
     on conflict (profile_id, school_id) do nothing
     returning profile_id`,
    [profileId, collector.school_id, collector.id],
  );
  // A escola que a pessoa está vendo só muda quando ela ainda não tinha nenhuma:
  // ler o tubo de outra escola não deve tirá-la de onde ela estava.
  await tx.query("update public.profiles set school_id = $2 where id = $1 and school_id is null", [profileId, collector.school_id]);
  const scan = await tx.query<{ id: string }>(
    "insert into public.collector_scans (collector_id, profile_id) values ($1, $2) returning id",
    [collector.id, profileId],
  );

  return {
    collectorId: collector.id,
    code: collector.code,
    name: collector.name,
    location: collector.location,
    schoolId: collector.school_id,
    scanId: scan.rows[0]!.id,
    joinedSchool: ingressou.rows.length > 0,
  };
}

/*
 * PRESENÇA FÍSICA — por que a leitura é exigida a cada missão.
 *
 * Abrir a válvula molha o chão de verdade. Se bastasse tocar num botão, qualquer
 * pessoa logada esvaziaria o tubo de casa, por brincadeira ou por engano. A leitura
 * do QR colado no tubo é a prova de que quem pediu a água está na frente dele.
 *
 * Para a prova valer, o servidor exige quatro coisas — a interface não decide nada
 * disso, porque qualquer uma delas pode ser burlada no navegador:
 *   1. a leitura existe e é DESTA pessoa;
 *   2. é DESTE captador (ler o QR do tubo A não libera o tubo B);
 *   3. é RECENTE (vale poucos minutos);
 *   4. ainda NÃO foi usada — uma leitura autoriza uma liberação, e o índice único
 *      em device_commands.scan_id é a garantia final, mesmo em duas abas abertas.
 */

/** Quanto tempo uma leitura continua valendo. A câmera abre junto com a missão: segundos, não horas. */
export const SCAN_VALIDITY_MS = 5 * 60_000;

export type ScanRejection = "not_found" | "other_person" | "other_collector" | "expired" | "already_used";

export const SCAN_REJECTION_MESSAGE: Record<ScanRejection, string> = {
  not_found: "Leitura não reconhecida",
  other_person: "Esta leitura é de outra pessoa",
  other_collector: "Este QR é de outro captador",
  expired: "A leitura expirou — leia junto ao captador",
  already_used: "Esta leitura já foi usada",
};

export interface ScanCheck {
  scanId: string;
  profileId: string;
  collectorId: string;
  nowMs: number;
}

/** `null` quando a leitura autoriza a liberação; caso contrário, o motivo da recusa. */
export async function checkScan(tx: Queryable, check: ScanCheck): Promise<ScanRejection | null> {
  const { rows } = await tx.query<{ profile_id: string; collector_id: string; scanned_at: Date | string; used: boolean }>(
    `select s.profile_id, s.collector_id, s.scanned_at,
            exists (select 1 from public.device_commands c where c.scan_id = s.id) as used
     from public.collector_scans s where s.id = $1`,
    [check.scanId],
  );
  const scan = rows[0];
  if (!scan) return "not_found";
  if (scan.profile_id !== check.profileId) return "other_person";
  if (scan.collector_id !== check.collectorId) return "other_collector";
  if (scan.used) return "already_used";
  const scannedAt = scan.scanned_at instanceof Date ? scan.scanned_at.getTime() : new Date(scan.scanned_at).getTime();
  if (!Number.isFinite(scannedAt) || check.nowMs - scannedAt > SCAN_VALIDITY_MS) return "expired";
  return null;
}

/**
 * Adesão como responsável, com o código impresso dentro da caixa eletrônica.
 * Comparação por hash: o código em claro nunca está no banco.
 */
export async function claimStewardship(
  tx: Queryable,
  profileId: string,
  collectorId: string,
  code: string,
  pepper: string,
): Promise<boolean> {
  const normalized = normalizeStewardCode(code);
  if (!normalized) return false;

  const { rows } = await tx.query<{ steward_code_hash: string | null }>(
    "select steward_code_hash from public.collectors where id = $1 and active",
    [collectorId],
  );
  const stored = rows[0]?.steward_code_hash;
  if (!stored || stored !== hashStewardCode(normalized, pepper)) return false;

  await tx.query(
    `insert into public.collector_stewards (collector_id, profile_id) values ($1, $2)
     on conflict (collector_id, profile_id) do nothing`,
    [collectorId, profileId],
  );
  return true;
}
