/*
 * QUANDO A ESCOLA ESTÁ ABERTA — E POR QUE ISSO DECIDE TANTA COISA.
 *
 * O captador não enche sozinho: ele enche quando o ar-condicionado está
 * ligado, e o ar-condicionado só está ligado quando há aula. De madrugada, no
 * fim de semana e no feriado a escola está fechada, o aparelho desligado, e
 * dentro do tubo não entra uma gota.
 *
 * Isso tem duas consequências práticas, e as duas eram erros antes deste
 * módulo existir:
 *
 *   1. AVISO. O tubo que ficou quase cheio na sexta continua quase cheio no
 *      domingo. Sem esta conta, o intervalo entre avisos faria o celular de um
 *      estudante tocar de seis em seis horas, o fim de semana inteiro, sobre
 *      algo que ele não tem como resolver — e ele desligaria o canal, perdendo
 *      também o aviso de segunda-feira.
 *
 *   2. ESTIMATIVA OFFLINE. Se a placa cala na sexta às 17h, estimar 48 horas de
 *      entrada contínua inventa água que não entrou. A estimativa precisa
 *      contar só as horas em que a escola esteve aberta.
 *
 * O horário é um PADRÃO, não uma verdade universal: escola com turno noturno
 * ou sábado letivo pede outro. Quando a segunda escola da rede tiver turno
 * diferente, isto vira configuração dela — o formato já está pronto para isso.
 */

export interface SchoolSchedule {
  /** Fuso da escola. A plataforma roda em UTC; a escola, não. */
  timeZone: string;
  /** Dias letivos. 0 = domingo, 6 = sábado. */
  weekdays: readonly number[];
  /** Início do primeiro turno, em minutos desde a meia-noite local. */
  startMinutes: number;
  /** Fim do último turno, em minutos desde a meia-noite local (exclusivo). */
  endMinutes: number;
}

/** Ajuda a escrever o horário como ele é dito: `hhmm(7, 10)` é "sete e dez". */
export const hhmm = (hora: number, minuto = 0) => hora * 60 + minuto;

/**
 * O chute razoável para quem ainda não informou o seu: dias úteis, 7h às 17h30.
 *
 * É PADRÃO, nunca verdade: a Clarinda funciona das 7h10 às 16h30, e a próxima
 * escola da rede pode ter turno noturno, meio período ou sábado letivo. O
 * horário de cada escola vive no banco, e a tela da administração existe para
 * corrigi-lo. Este valor só aparece quando ninguém informou nada.
 *
 * Sábado letivo — quatro ou cinco por ano na Clarinda — NÃO vira calendário de
 * exceções: lista de exceção é lista que alguém esquece de atualizar. Nesses
 * dias quem diz que a escola está aberta é a própria água subindo no tubo: o
 * ar-condicionado só liga com gente dentro (ver `notifyLevel`).
 */
export const DEFAULT_SCHOOL_SCHEDULE: SchoolSchedule = {
  timeZone: "America/Campo_Grande",
  weekdays: [1, 2, 3, 4, 5],
  startMinutes: hhmm(7),
  endMinutes: hhmm(17, 30),
};

/** O horário como a tela o escreve: "7h10 às 16h30, de segunda a sexta". */
export function describeSchedule(schedule: SchoolSchedule): string {
  const hora = (minutos: number) => {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  };
  const NOMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const dias = [...schedule.weekdays].sort((a, b) => a - b);
  const sequencia = dias.every((dia, i) => i === 0 || dia === dias[i - 1]! + 1);
  const quando =
    dias.length === 0
      ? "sem dias letivos"
      : dias.length === 1
        ? NOMES[dias[0]!]!
        : sequencia
          ? `de ${NOMES[dias[0]!]} a ${NOMES[dias[dias.length - 1]!]}`
          : dias.map((dia) => NOMES[dia]).join(", ");
  return `${hora(schedule.startMinutes)} às ${hora(schedule.endMinutes)}, ${quando}`;
}

const DIAS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Dia da semana e minuto do dia no fuso da escola, sem depender do fuso do servidor. */
function localParts(ms: number, timeZone: string): { weekday: number; minutes: number } {
  const formatador = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const partes = formatador.formatToParts(new Date(ms));
  const dia = partes.find((parte) => parte.type === "weekday")?.value.toLowerCase() ?? "";
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value ?? "0");
  const minuto = Number(partes.find((parte) => parte.type === "minute")?.value ?? "0");
  return { weekday: DIAS.indexOf(dia as (typeof DIAS)[number]), minutes: hora * 60 + minuto };
}

/** A escola está aberta neste instante, pelo horário padrão dela? */
export function withinSchoolHours(ms: number, schedule: SchoolSchedule = DEFAULT_SCHOOL_SCHEDULE): boolean {
  const { weekday, minutes } = localParts(ms, schedule.timeZone);
  if (weekday < 0 || !schedule.weekdays.includes(weekday)) return false;
  return minutes >= schedule.startMinutes && minutes < schedule.endMinutes;
}

/**
 * Passo da varredura de `schoolHoursBetween`.
 *
 * Cinco minutos: fino o bastante para que o erro máximo seja irrelevante
 * diante de uma estimativa de litros por hora — e para não atropelar um turno
 * que começa às 7h10 —, e grosso o bastante para percorrer dois dias em menos
 * de seiscentas iterações. Somar fatias é mais
 * simples — e muito mais difícil de errar — do que construir "07h locais" num
 * fuso com horário de verão.
 */
const STEP_MS = 5 * 60_000;

/**
 * Quanto tempo de escola ABERTA existe entre dois instantes.
 *
 * É o que multiplica a vazão aprendida na estimativa offline: contar as horas
 * de porta fechada inventaria água que o ar-condicionado desligado não
 * produziu.
 */
export function schoolHoursBetween(startMs: number, endMs: number, schedule: SchoolSchedule = DEFAULT_SCHOOL_SCHEDULE): number {
  if (!(endMs > startMs)) return 0;
  let aberta = 0;
  for (let instante = startMs; instante < endMs; instante += STEP_MS) {
    const fatia = Math.min(STEP_MS, endMs - instante);
    if (withinSchoolHours(instante, schedule)) aberta += fatia;
  }
  return aberta;
}
