/*
 * QUANDO O CAPTADOR CALA.
 *
 * A internet da escola cai, o roteador fica num armário que alguém desliga, a
 * rede do pátio não alcança o tubo. O captador segue captando água enquanto
 * houver aula — só não consegue contar. E é exatamente aí que a água
 * transborda, porque ninguém foi avisado.
 *
 * Então, offline, a plataforma faz duas coisas e nenhuma terceira:
 *
 *   1. diz desde quando ele está calado. A última medição REAL continua na tela,
 *      com a hora em que foi feita. Dado velho rotulado é informação; dado velho
 *      disfarçado de atual é mentira;
 *
 *   2. estima o que deve ter lá dentro, a partir da média de litros por hora que
 *      ele mesmo aprendeu medindo (`learnedInflowLitersPerHour`), e chama alguém
 *      para ir até o captador.
 *
 * A estimativa NUNCA vira litro de verdade. Ela não entra em impacto, não entra
 * em ranking, não conclui missão: quem conclui missão é o volume medido pelo
 * sensor, e para isso o captador precisa estar falando — por isso a missão
 * offline começa com o estudante ligando o ponto de acesso do celular.
 * O campo `countsForImpact: false` existe para que isso seja impossível de
 * esquecer em quem for usar este módulo.
 */

import { fillRatio, getLevelState } from "./level-state";
import { schoolHoursBetween, type SchoolSchedule } from "./school-hours";

/** Depois disso sem telemetria, o captador está offline (mesmo limite do servidor). */
export const OFFLINE_AFTER_MS = 15_000;

/**
 * Tempo máximo de silêncio em que ainda faz sentido estimar.
 *
 * As horas de escola fechada já saem da conta (`schoolHoursBetween`), mas dois
 * dias de média aprendida continua sendo esticar: uma semana fria com o
 * ar-condicionado pouco ligado, um feriado no meio, e a média deixa de valer.
 * Passado isso a plataforma prefere dizer "não sei" a mostrar um número bonito
 * e errado.
 */
export const ESTIMATE_HORIZON_MS = 48 * 3_600_000;

const MS_PER_HOUR = 3_600_000;

export interface OfflineInput {
  /** Última telemetria recebida. `null` = a placa nunca falou. */
  lastSeenAt: number | null;
  /** Último volume MEDIDO pelo sensor. */
  lastVolumeLiters: number | null;
  capacityLiters: number;
  /** Média de entrada aprendida medindo, em litros por hora. */
  learnedInflowLitersPerHour: number;
  /**
   * Quando o ar-condicionado daquele bloco funciona.
   *
   * Sem ele a conta inventaria água de fim de semana. Opcional porque captador
   * cadastrado antes desta regra não informou horário nenhum — aí vale o padrão.
   */
  acSchedule?: SchoolSchedule;
  nowMs: number;
}

export type EstimateConfidence = "estimativa" | "sem_estimativa";

export interface OfflineEstimate {
  offlineForMs: number;
  /** "há 3 horas", "há 2 dias" — como aparece na tela. */
  offlineFor: string;
  /** O último número real, e quando foi medido. */
  lastMeasuredLiters: number | null;
  /** Litros estimados agora. `null` quando não há base honesta para estimar. */
  estimatedLiters: number | null;
  /** Nunca some da tela ao lado do número estimado. */
  label: "ESTIMATIVA";
  confidence: EstimateConfidence;
  /** Pela estimativa, já é hora de alguém ir até lá. */
  callToAction: boolean;
  /** O que a tela diz. Uma frase, sem jargão. */
  message: string;
  /** Lembrete de contrato: estimativa não é litro captado. */
  countsForImpact: false;
}

/** "há 40 minutos", "há 3 horas", "há 2 dias" — unidade que uma pessoa usa falando. */
export function describeSilence(ms: number): string {
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return "há segundos";
  if (minutos < 60) return `há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * O que mostrar de um captador calado. `null` quando ele está falando: aí a tela
 * mostra a medição, e não há nada a estimar.
 */
export function offlineEstimate(input: OfflineInput): OfflineEstimate | null {
  if (input.lastSeenAt === null) return null;
  const offlineForMs = input.nowMs - input.lastSeenAt;
  if (offlineForMs < OFFLINE_AFTER_MS) return null;

  const offlineFor = describeSilence(offlineForMs);
  const base = input.lastVolumeLiters;
  const rate = input.learnedInflowLitersPerHour;
  const semEstimativa = base === null || !(rate > 0) || offlineForMs > ESTIMATE_HORIZON_MS || !(input.capacityLiters > 0);

  if (semEstimativa) {
    return {
      offlineForMs,
      offlineFor,
      lastMeasuredLiters: base,
      estimatedLiters: null,
      label: "ESTIMATIVA",
      confidence: "sem_estimativa",
      // Sem estimativa, ainda assim vale a visita: ninguém sabe o que há no tubo.
      callToAction: offlineForMs > ESTIMATE_HORIZON_MS,
      message:
        base === null
          ? `Sem conexão ${offlineFor}. Este captador ainda não tem medição registrada.`
          : `Sem conexão ${offlineFor}. A última medição foi de ${base.toFixed(1)} L e não dá para estimar o que há agora.`,
      countsForImpact: false,
    };
  }

  /*
   * Só as horas de ESCOLA ABERTA entram na conta.
   *
   * O tubo enche quando o ar-condicionado está ligado, e ele só está ligado
   * quando há aula. Multiplicar a vazão pelo silêncio inteiro inventaria água
   * de fim de semana: a placa que cala na sexta às 17h voltaria no domingo
   * "estimando" 48 horas de entrada num tubo onde não caiu uma gota.
   */
  const captando = schoolHoursBetween(input.lastSeenAt, input.nowMs, input.acSchedule);
  const estimated = Math.min(input.capacityLiters, base! + (rate * captando) / MS_PER_HOUR);
  const { urgency } = getLevelState(fillRatio(estimated, input.capacityLiters));
  const cheio = urgency !== "normal";
  return {
    offlineForMs,
    offlineFor,
    lastMeasuredLiters: base,
    estimatedLiters: Math.round(estimated * 10) / 10,
    label: "ESTIMATIVA",
    confidence: "estimativa",
    callToAction: cheio,
    message: cheio
      ? `Sem conexão ${offlineFor}. Pela média que ele aprendeu, já deve estar perto de cheio — vale ir até lá.`
      : `Sem conexão ${offlineFor}. Pela média que ele aprendeu, deve ter cerca deste volume agora.`,
    countsForImpact: false,
  };
}

/*
 * A MISSÃO NO CAPTADOR OFFLINE.
 *
 * A estimativa chama a pessoa até o tubo. Chegando lá, ela precisa de internet
 * para o captador — não para ela. O celular dela vira essa internet: ponto de
 * acesso com o nome e a senha que o app mostra, que são os mesmos que a placa
 * já conhece (src/lib/server/collector-registry.ts).
 *
 * O que acontece depois é o fluxo normal, sem atalho nenhum: a placa conecta,
 * envia a distância, o servidor converte pela calibração e a missão conclui pelo
 * volume MEDIDO. A estimativa serviu para trazer a pessoa até aqui, e para nada
 * mais.
 */

export interface HotspotRescue {
  ssid: string;
  password: string;
  /** Passos curtos, do jeito que se diz a alguém em pé no pátio. */
  steps: string[];
}

export function hotspotRescue(network: { ssid: string; password: string }): HotspotRescue {
  return {
    ssid: network.ssid,
    password: network.password,
    steps: [
      "Abra as configurações do seu celular.",
      `Ligue o ponto de acesso com o nome ${network.ssid}.`,
      `Use a senha ${network.password}.`,
      "Fique perto do captador por um minuto: ele entra sozinho.",
    ],
  };
}
