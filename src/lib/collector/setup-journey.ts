/*
 * O CAMINHO DE UM CAPTADOR NOVO.
 *
 * Replicar o projeto é construir mais captadores. Quem faz isso costuma ser um
 * professor que nunca programou, e entre "quero montar um" e "a escola tem mais
 * um captador na rede" existem seis etapas. Sem um fio condutor, a pessoa trava
 * na primeira dúvida e o tubo vira enfeite no pátio.
 *
 * Este módulo é esse fio. Ele responde a uma pergunta só, e sempre a mesma:
 * O QUE EU FAÇO AGORA?
 *
 * Duas regras de desenho:
 *
 *   1. O estado vem de FATOS, não de botões. Se o ESP32 enviou leitura, a
 *      conexão funciona — não adianta alguém marcar "conectei" se não conectou.
 *      Só montagem e personalização são marcadas à mão, porque a plataforma não
 *      tem como ver um tubo pintado.
 *
 *   2. Uma etapa por vez. As seguintes aparecem bloqueadas, com o motivo: ver o
 *      caminho inteiro tranquiliza, e saber por que ainda não dá evita a
 *      sensação de erro.
 */

export const SETUP_STEPS = ["cadastro", "montagem", "personalizacao", "firmware", "conexao", "calibracao"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/**
 * Etapas que alguém marca como feitas: a plataforma não enxerga um tubo montado
 * nem um tubo pintado. Todas as outras vem de fato observado, e nenhum botão as
 * alcança — o enum `setup_step` do banco também aceita 'firmware', de quando a
 * gravação era marcada à mão; hoje ela vem do cadastro da placa e esse valor
 * simplesmente não é usado.
 */
export const MANUAL_STEPS = ["montagem", "personalizacao"] as const;

export type StepState = "done" | "current" | "locked";

export interface SetupStep {
  id: SetupStepId;
  /** Título curto, do jeito que aparece na lista. */
  title: string;
  /** Uma frase sobre o que acontece nesta etapa. */
  summary: string;
  state: StepState;
  /** O que fazer agora, quando esta é a etapa atual. */
  action: string | null;
  /** Por que ainda não dá, quando está bloqueada. */
  blockedBy: string | null;
}

export interface SetupFacts {
  /** O captador existe no banco. */
  registered: boolean;
  /** Etapas marcadas à mão por quem montou. */
  marked: readonly string[];
  /** Um dispositivo foi registrado e tem token. */
  deviceRegistered: boolean;
  /** O ESP32 já enviou pelo menos uma leitura: a conexão funciona. */
  everConnected: boolean;
  /** Existe calibração aceita e válida para o dispositivo atual. */
  calibrated: boolean;
  /** Já entrou na rede da escola e assumiu ECO-nnn. */
  activated: boolean;
}

const DESCRICAO: Record<SetupStepId, { title: string; summary: string; action: string }> = {
  cadastro: {
    title: "Cadastro",
    summary: "Escola, município, estado e onde o tubo vai ficar instalado.",
    action: "Preencher os dados do captador",
  },
  montagem: {
    title: "Montagem do protótipo",
    summary: "O manual mostra o tubo, o sensor, a caixa eletrônica e a torneira, peça por peça.",
    action: "Baixar o manual e montar o captador",
  },
  personalizacao: {
    title: "Personalização",
    summary: "Artes para colar no tubo e o adesivo com o QR Code da missão.",
    action: "Baixar as artes e o adesivo",
  },
  firmware: {
    title: "Programa do ESP32",
    summary: "O código já vem preparado para ESTE captador. É copiar e gravar na placa.",
    action: "Baixar o programa e gravar na placa",
  },
  conexao: {
    title: "Conexão",
    summary: "O ESP32 cria a própria rede para você escolher o Wi-Fi da escola.",
    action: "Conectar o captador à internet",
  },
  calibracao: {
    title: "Calibração",
    summary: "Água medida de verdade: 0, 1, 2, 3 litros e o nível máximo.",
    action: "Calibrar com volumes conhecidos",
  },
};

/** Motivo pelo qual cada etapa espera a anterior. Escrito para quem está travado. */
const BLOQUEIO: Record<SetupStepId, string> = {
  cadastro: "",
  montagem: "Cadastre o captador primeiro.",
  personalizacao: "Monte o captador antes de personalizá-lo.",
  firmware: "O programa é gerado depois da montagem.",
  conexao: "Grave o programa no ESP32 antes de conectar.",
  calibracao: "A calibração precisa do captador conectado, enviando leituras.",
};

/** Uma etapa está cumprida? Fatos primeiro; marcação à mão só onde não há fato. */
function cumprida(step: SetupStepId, facts: SetupFacts): boolean {
  switch (step) {
    case "cadastro":
      return facts.registered;
    case "montagem":
    case "personalizacao":
      return facts.marked.includes(step);
    case "firmware":
      // Gerar o programa registra a placa no banco: é isso que a plataforma
      // observa. Gravar de fato só se comprova na etapa seguinte, quando a placa
      // fala — e uma placa falando prova as duas coisas de uma vez.
      return facts.deviceRegistered || facts.everConnected;
    case "conexao":
      return facts.everConnected;
    case "calibracao":
      return facts.calibrated;
  }
}

export interface SetupJourney {
  steps: SetupStep[];
  /** Etapa em que a pessoa está agora. `null` quando acabou. */
  currentStep: SetupStepId | null;
  /** Quantas das seis etapas estão cumpridas. */
  completed: number;
  total: number;
  /** O captador já atende missões. */
  live: boolean;
}

/**
 * O caminho inteiro, com a etapa atual destacada.
 *
 * A etapa atual é a primeira não cumprida — e não "a próxima na ordem". Quem
 * voltar atrás (trocou o sensor, recalibrou) volta ao ponto certo sozinho, em
 * vez de ficar preso num estado que não corresponde ao tubo.
 */
export function setupJourney(facts: SetupFacts): SetupJourney {
  const feitas = SETUP_STEPS.map((step) => cumprida(step, facts));
  const atualIndex = feitas.indexOf(false);

  const steps = SETUP_STEPS.map((id, index): SetupStep => {
    const state: StepState = feitas[index] ? "done" : index === atualIndex ? "current" : "locked";
    const { title, summary, action } = DESCRICAO[id];
    return {
      id,
      title,
      summary,
      state,
      action: state === "current" ? action : null,
      blockedBy: state === "locked" ? BLOQUEIO[id] : null,
    };
  });

  return {
    steps,
    currentStep: atualIndex === -1 ? null : SETUP_STEPS[atualIndex]!,
    completed: feitas.filter(Boolean).length,
    total: SETUP_STEPS.length,
    live: facts.activated && facts.calibrated,
  };
}

/**
 * A frase que a tela mostra em destaque. É a resposta a "o que eu faço agora?",
 * e por isso existe mesmo quando não há mais nada a fazer.
 */
export function nextAction(journey: SetupJourney): string {
  if (journey.live) return "Captador ativo: já aparece nas missões da escola.";
  if (journey.currentStep === null) return "Tudo pronto. Ativando o captador na rede da escola…";
  return journey.steps.find((step) => step.id === journey.currentStep)!.action!;
}
