import { createHash, randomBytes, randomInt } from "node:crypto";
import { nominalCapacityLiters } from "@/lib/collector/volume-calibration";
import { DEFAULT_DISTANCE_SENSOR, isDistanceSensorModel, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import type { Queryable } from "./db/types";

/*
 * CADASTRO DE CAPTADORES — operação de administração, invisível no app do usuário.
 *
 * Três coisas nascem aqui e nunca mais mudam:
 *   1. o TOKEN DO QR, colado no tubo. Quem lê entra na escola daquele captador e
 *      pode fazer missão nele;
 *   2. o CÓDIGO DE RESPONSÁVEL, impresso para guardar DENTRO da caixa eletrônica.
 *      Quem abre a caixa e digita o código passa a calibrar e configurar aquele
 *      captador. Só o hash é guardado — como já acontece com o token do dispositivo;
 *   3. a REDE DO CAPTADOR (nome e senha), que serve duas vezes: é a rede que o ESP32
 *      cria para ser configurado, e é a rede que um estudante liga no celular para
 *      atender o captador quando a internet da escola falha.
 *
 * O CÓDIGO, por outro lado, MUDA UMA VEZ — e de propósito.
 *
 * Um tubo recém-cadastrado ainda não mede nada: é uma obra. Ele nasce PROTO-nnn e só
 * assume o sequencial da escola, ECO-nnn, quando a calibração é aceita. Quem habilita
 * um captador na plataforma é quem consegue calibrá-lo, e o número ECO é a prova
 * disso — por isso não é dado antes. Assim, a escola que tem "ECO-001 a ECO-004" tem
 * quatro captadores medindo de verdade, e não quatro tubos no pátio.
 *
 * A capacidade informada aqui é ESTIMADA pela geometria do tubo. A capacidade que o
 * app usa passa a ser a medida, assim que a calibração daquele captador é aceita
 * (docs/CALIBRACAO.md). Captador recém-cadastrado não entrega litros nem aparece em
 * missão até ser calibrado.
 */

/**
 * Prefixo do código. Cada um tem a PRÓPRIA sequência dentro da escola, para que um
 * protótipo abandonado — ou o captador da simulação — não ocupe o número de um
 * captador que mede de verdade:
 *   PROTO-nnn → em construção: cadastrado, ainda sem calibração aceita
 *   ECO-nnn   → captador da rede: calibrado, medindo, aparecendo em missão
 *   SIM-nnn   → captador da simulação (dispositivo virtual, uso administrativo)
 */
export const COLLECTOR_PREFIXES = ["ECO", "PROTO", "SIM"] as const;
export type CollectorPrefix = (typeof COLLECTOR_PREFIXES)[number];

/** Prefixo de quem acaba de ser cadastrado: ninguém nasce ECO. */
export const INITIAL_PREFIX = "PROTO";

const MAX_SEQ = 999;

/** Sem 0/O e 1/I: o código é lido de um papel dentro da caixa, muitas vezes com pouca luz. */
const STEWARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STEWARD_GROUPS = 3;
const STEWARD_GROUP_SIZE = 4;

export const formatCollectorCode = (seq: number, prefix: CollectorPrefix = "ECO") => `${prefix}-${String(seq).padStart(3, "0")}`;

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

/*
 * A REDE DO CAPTADOR — um nome e uma senha, dois usos.
 *
 * Uso 1, na instalação: o ESP32 liga e cria essa rede. Quem está na frente dele
 * conecta o celular nela, aparece a lista de Wi-Fi do lugar, escolhe a da escola e
 * digita a senha. A senha da escola fica na memória da placa — nunca num arquivo,
 * nunca neste banco.
 *
 * Uso 2, quando a internet da escola falha: o estudante liga o ponto de acesso do
 * próprio celular com ESTE nome e ESTA senha, e o captador entra nele sozinho —
 * porque já os conhece. Sem isso, atender um captador offline exigiria configurar
 * a placa no pátio, no sol, pelo celular.
 *
 * Por isso o nome é curto: alguém vai DIGITAR isso na tela de ponto de acesso do
 * celular. E por isso ele não contém o código do captador: o código muda quando o
 * captador é habilitado (PROTO → ECO), e a placa já estaria gravada.
 *
 * A senha fica legível no banco de propósito: ela é combinada entre a placa e quem
 * está na frente dela, e o app precisa mostrá-la ao estudante. Ela não protege dado
 * nenhum — a telemetria vai por HTTPS com o token do dispositivo, que continua
 * guardado só como hash.
 */

/** Etiqueta de 4 caracteres que nomeia a rede. Mesmo alfabeto sem 0/O e 1/I. */
const NETWORK_TAG_SIZE = 4;

export interface CollectorNetwork {
  ssid: string;
  password: string;
}

/** Ex.: `{ ssid: "EcoHorta-7KQ3", password: "horta7kq3mp" }`. */
export function generateCollectorNetwork(): CollectorNetwork {
  let tag = "";
  for (let i = 0; i < NETWORK_TAG_SIZE; i++) tag += STEWARD_ALPHABET[randomInt(0, STEWARD_ALPHABET.length)];
  // 12 caracteres minúsculos: WPA2 exige 8, e quem digita está no pátio, no celular.
  let rest = "";
  for (let i = 0; i < 3; i++) rest += STEWARD_ALPHABET[randomInt(0, STEWARD_ALPHABET.length)];
  return { ssid: `EcoHorta-${tag}`, password: `horta${tag}${rest}`.toLowerCase() };
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
export async function nextCollectorSeq(tx: Queryable, schoolId: string, prefix: CollectorPrefix = "ECO"): Promise<number> {
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
  /** Padrão "PROTO": só vira ECO ao ser habilitado. "SIM" é a simulação. */
  prefix?: CollectorPrefix;
  /** Como este captador se conecta. Escola sem rede nenhuma usa "hotspot_only". */
  connectivity?: CollectorConnectivity;
  distanceSensor?: DistanceSensorModel | string | null;
  createdBy: string | null;
  /** Segredo do ambiente usado no hash do código de responsável. */
  pepper: string;
}

/** Pela rede da escola, ou só pelo celular de quem vai atender a missão. */
export const CONNECTIVITY_MODES = ["school_network", "hotspot_only"] as const;
export type CollectorConnectivity = (typeof CONNECTIVITY_MODES)[number];

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
  /** Nome e senha da rede do captador: configuração e resgate offline. */
  network: CollectorNetwork;
  connectivity: CollectorConnectivity;
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
  const prefix = input.prefix ?? INITIAL_PREFIX;
  // ECO não se cadastra: ele se conquista calibrando (ver activateCollector). O banco
  // também recusa, pela restrição `activated_is_eco`; aqui a recusa tem explicação.
  if (prefix === "ECO") throw new Error("O código ECO é atribuído quando a calibração é aceita, não no cadastro.");
  const seq = await nextCollectorSeq(tx, input.schoolId, prefix);
  const code = formatCollectorCode(seq, prefix);
  const qrToken = generateQrToken();
  const stewardCode = generateStewardCode();
  const network = generateCollectorNetwork();
  const connectivity = input.connectivity ?? "school_network";

  /*
   * A válvula do captador é a ESFÉRICA MOTORIZADA, e isso não é mais uma
   * escolha de cada escola: é o que o manual manda instalar e o que o firmware
   * aciona pelo relé. Deixar o padrão do banco ('undefined') faria o aplicativo
   * avisar o estudante de que "a válvula está em validação" num captador cuja
   * válvula abre e fecha sozinha.
   */
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.collectors
       (school_id, prefix, seq, code, proto_code, name, location, capacity_liters, reserve_liters, nominal_diameter_mm,
        nominal_useful_height_mm, distance_sensor, qr_token, steward_code_hash, created_by,
        hotspot_ssid, hotspot_password, connectivity, valve_kind)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'motorized_ball')
     returning id`,
    [
      input.schoolId,
      prefix,
      seq,
      code,
      prefix === "PROTO" ? code : null,
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
      network.ssid,
      network.password,
      connectivity,
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
    network,
    connectivity,
  };
}

/*
 * HABILITAR UM CAPTADOR — o momento em que ele entra na rede.
 *
 * Isto não é um botão. É a consequência de a calibração ter sido aceita, chamada
 * de dentro da mesma transação que a aceitou (src/lib/server/calibration-service.ts):
 * ou o captador passa a medir e a ter número, ou nada aconteceu.
 *
 * É idempotente de propósito. Recalibrar um captador já habilitado acontece toda
 * vez que se troca um sensor, e nessas horas ele não pode ganhar um número novo:
 * ECO-002 é ECO-002 para sempre, inclusive no adesivo colado no tubo.
 */

export interface CollectorActivation {
  /** O número que o captador passa a ter: ECO-nnn. */
  code: string;
  seq: number;
  /** O código de protótipo que ele deixa de usar. */
  previousCode: string;
}

/** `null` quando não havia nada a fazer: já habilitado, ou captador de simulação. */
export async function activateCollector(tx: Queryable, collectorId: string): Promise<CollectorActivation | null> {
  const { rows } = await tx.query<{ school_id: string; prefix: CollectorPrefix; code: string; activated_at: Date | string | null }>(
    "select school_id, prefix, code, activated_at from public.collectors where id = $1",
    [collectorId],
  );
  const collector = rows[0];
  if (!collector || collector.activated_at !== null || collector.prefix !== "PROTO") return null;

  const seq = await nextCollectorSeq(tx, collector.school_id, "ECO");
  const code = formatCollectorCode(seq, "ECO");
  await tx.query(
    "update public.collectors set prefix = 'ECO', seq = $2, code = $3, activated_at = now() where id = $1",
    [collectorId, seq, code],
  );
  return { code, seq, previousCode: collector.code };
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


// O vocabulário da leitura é compartilhado com a tela (src/lib/collector/scan.ts):
// este módulo fala com o banco e com node:crypto, e nada disso pode atravessar
// para o pacote que roda no celular.
export { SCAN_REJECTION_MESSAGE, SCAN_VALIDITY_MS, type ScanRejection } from "@/lib/collector/scan";
import { SCAN_VALIDITY_MS, type ScanRejection } from "@/lib/collector/scan";

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
 * Emite um código de responsável NOVO para o captador.
 *
 * Existe porque o código aparece uma vez só e some: o banco guarda o hash, e
 * nem a administração consegue lê-lo de volta. Isso é desenho, não descuido —
 * quem digita esse código passa a conduzir a construção e a calibração do
 * captador, e credencial recuperável é credencial que vaza junto com o banco.
 *
 * Então não se recupera: reemite-se. O código anterior deixa de valer no mesmo
 * instante, e o papel guardado dentro da caixa precisa ser trocado. Quem já
 * aderiu continua responsável — a adesão é uma linha em `collector_stewards`,
 * não uma consequência contínua do código.
 */
export async function reissueStewardCode(tx: Queryable, collectorId: string, pepper: string): Promise<string | null> {
  const stewardCode = generateStewardCode();
  const { rows } = await tx.query<{ id: string }>(
    "update public.collectors set steward_code_hash = $2, updated_at = now() where id = $1 and active returning id",
    [collectorId, hashStewardCode(stewardCode, pepper)],
  );
  return rows.length === 1 ? stewardCode : null;
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
