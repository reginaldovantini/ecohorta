import webpush from "web-push";
import type { Actor } from "./actor";
import { type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * O AVISO QUE CHEGA SEM O APLICATIVO ABERTO.
 *
 * O captador enche durante a aula, porque é quando o ar-condicionado está
 * ligado. Numa manhã de calor o tubo passa de 95% e a água começa a escorrer
 * pelo dreno — e até agora só descobria isso quem abrisse o aplicativo por
 * acaso. A missão de resgate existia e ninguém era chamado para ela.
 *
 * Quatro contenções moram aqui, e sem elas um aviso útil vira perseguição:
 *
 *   1. SÓ COM O TUBO ENCHENDO. O tubo que ficou quase cheio na sexta continua
 *      quase cheio no domingo, e ninguém pode fazer nada a respeito. Avisar
 *      assim mesmo faria o celular tocar de seis em seis horas o fim de semana
 *      inteiro — e a pessoa desligaria o canal, perdendo o aviso de segunda.
 *
 *      O sinal não é o calendário: é a ÁGUA SUBINDO. O ar-condicionado só liga
 *      com gente na escola, então nível subindo é prova de que há alguém lá
 *      para agir. Isso acerta o sábado letivo — quatro ou cinco por ano — sem
 *      que ninguém precise manter uma lista de exceções em dia.
 *   2. SILÊNCIO ENTRE AVISOS. Telemetria chega a cada três segundos. Sem
 *      intervalo, "o tubo está cheio" viraria um aviso a cada três segundos.
 *   3. SÓ QUEM PERTENCE À ESCOLA. O aviso é sobre um tubo específico; mandar
 *      para a rede inteira seria barulho para quem não pode agir.
 *   4. ENDEREÇO MORTO SE APAGA. Celular trocado, app desinstalado, inscrição
 *      expirada — o serviço de push responde 404 ou 410, e insistir com um
 *      endereço morto é gastar tempo de requisição para sempre.
 */

/** Quanto tempo de silêncio entre dois avisos do mesmo tipo, para o mesmo captador. */
export const ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

export type AlertKind = "attention" | "critical";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function configure(): boolean {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  const assunto = process.env.VAPID_SUBJECT;
  if (!publica || !privada || !assunto) return false;
  webpush.setVapidDetails(assunto, publica, privada);
  return true;
}

/** As notificações estão configuradas neste ambiente? */
export const pushConfigured = () => Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

/**
 * Guarda a inscrição de um aparelho.
 *
 * Pela chave do endereço: o mesmo celular reinstalando o aplicativo gera um
 * endereço novo, e o antigo para de responder sozinho. Reinscrever atualiza as
 * chaves e o dono — um aparelho emprestado passa a avisar quem está usando.
 */
export async function saveSubscription(db: Queryable, actor: Actor, input: unknown): Promise<ServiceResult<void>> {
  const dados = input as PushSubscriptionInput | null;
  const endpoint = typeof dados?.endpoint === "string" ? dados.endpoint.trim() : "";
  const p256dh = typeof dados?.keys?.p256dh === "string" ? dados.keys.p256dh : "";
  const auth = typeof dados?.keys?.auth === "string" ? dados.keys.auth : "";
  if (endpoint.length < 20 || p256dh.length < 10 || auth.length < 10) return fail(422, "Inscrição de notificação inválida.");

  await db.query(
    `insert into public.push_subscriptions (endpoint, profile_id, p256dh, auth, last_seen_at)
     values ($1, $2, $3, $4, now())
     on conflict (endpoint) do update set profile_id = excluded.profile_id, p256dh = excluded.p256dh,
       auth = excluded.auth, last_seen_at = now()`,
    [endpoint, actor.profileId, p256dh, auth],
  );
  return { ok: true, value: undefined };
}

export async function removeSubscription(db: Queryable, actor: Actor, endpoint: unknown): Promise<ServiceResult<void>> {
  if (typeof endpoint !== "string" || !endpoint) return fail(422, "Informe a inscrição a remover.");
  await db.query("delete from public.push_subscriptions where endpoint = $1 and profile_id = $2", [endpoint, actor.profileId]);
  return { ok: true, value: undefined };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Para onde o toque na notificação leva. */
  url: string;
  /** Avisos com a mesma etiqueta se substituem na bandeja, em vez de empilhar. */
  tag: string;
}

/**
 * Envia para todos os aparelhos de uma escola.
 *
 * Erros de um aparelho não derrubam os outros: cada envio é independente, e um
 * endereço morto some do banco em vez de ser tentado para sempre.
 */
export async function sendToSchool(db: Queryable, schoolId: string, message: PushMessage): Promise<number> {
  if (!configure()) return 0;

  const { rows } = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select s.endpoint, s.p256dh, s.auth
     from public.push_subscriptions s
     join public.school_members m on m.profile_id = s.profile_id
     where m.school_id = $1`,
    [schoolId],
  );
  if (rows.length === 0) return 0;

  const corpo = JSON.stringify(message);
  const mortos: string[] = [];
  let entregues = 0;

  await Promise.all(
    rows.map(async (inscricao) => {
      try {
        await webpush.sendNotification(
          { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
          corpo,
          { TTL: 60 * 60 },
        );
        entregues++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: o navegador desfez a inscrição. Insistir seria gastar tempo
        // de requisição com um endereço que nunca mais vai responder.
        if (status === 404 || status === 410) mortos.push(inscricao.endpoint);
      }
    }),
  );

  if (mortos.length > 0) {
    await db.query("delete from public.push_subscriptions where endpoint = any($1::text[])", [mortos]);
  }
  return entregues;
}

/**
 * Este captador já avisou isto há pouco?
 *
 * Marca o envio na mesma consulta que decide, para dois ciclos de telemetria
 * simultâneos não mandarem dois avisos. Devolve `true` apenas para quem
 * conseguiu marcar — e é esse que envia.
 */
export async function claimAlert(db: Queryable, collectorId: string, kind: AlertKind, nowMs: number): Promise<boolean> {
  const { rows } = await db.query<{ collector_id: string }>(
    `insert into public.collector_alerts (collector_id, kind, sent_at) values ($1, $2, $3)
     on conflict (collector_id, kind) do update set sent_at = $3
     where public.collector_alerts.sent_at < $4
     returning collector_id`,
    [collectorId, kind, new Date(nowMs), new Date(nowMs - ALERT_COOLDOWN_MS)],
  );
  return rows.length > 0;
}

/** O nível voltou ao normal: o próximo aviso daquele tipo pode acontecer. */
export async function clearAlerts(db: Queryable, collectorId: string): Promise<void> {
  await db.query("delete from public.collector_alerts where collector_id = $1", [collectorId]);
}

/** O texto do aviso. Curto: ele é lido na tela de bloqueio, de relance. */
export function alertMessage(kind: AlertKind, collectorCode: string, freeLiters: number): PushMessage {
  const litros = `${freeLiters.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L`;
  return kind === "critical"
    ? {
        title: "O captador vai transbordar",
        body: `${collectorCode} está quase cheio e já tem ${litros} para usar. Uma missão agora evita o desperdício.`,
        url: "/missoes",
        tag: `collector-${collectorCode}`,
      }
    : {
        title: "Água esperando no captador",
        body: `${collectorCode} tem ${litros} disponíveis. Dá para cumprir uma missão.`,
        url: "/missoes",
        tag: `collector-${collectorCode}`,
      };
}

/**
 * Avisa a escola sobre o nível do captador, se for o caso.
 *
 * Fica fora da transação da telemetria de propósito: mandar notificação é
 * conversar com servidores de terceiros, e isso não pode segurar uma transação
 * que grava a leitura do sensor.
 */
export async function notifyLevel(
  db: Database,
  input: {
    collectorId: string;
    collectorCode: string;
    schoolId: string;
    kind: AlertKind | null;
    freeLiters: number;
    nowMs: number;
    /** O nível está subindo? É a prova de que há alguém na escola para agir. */
    rising: boolean;
  },
): Promise<void> {
  if (!pushConfigured()) return;
  if (input.kind === null) {
    await clearAlerts(db, input.collectorId);
    return;
  }
  /*
   * Tubo parado, aviso guardado.
   *
   * A marca NÃO é lançada aqui de propósito: gastar o silêncio de seis horas
   * com a escola fechada deixaria o aviso calado justamente na manhã de
   * segunda, quando ele serviria.
   */
  if (!input.rising) return;
  if (!(await claimAlert(db, input.collectorId, input.kind, input.nowMs))) return;
  await sendToSchool(db, input.schoolId, alertMessage(input.kind, input.collectorCode, input.freeLiters));
}
