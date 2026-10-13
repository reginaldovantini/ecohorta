/*
 * O CAMINHO DE UM CAPTADOR NOVO.
 *
 * Replicar o projeto é construir mais captadores. Quem faz isso costuma ser um
 * professor que nunca programou, e entre "quero montar um" e "a escola tem mais
 * um captador na rede" existem sete etapas. Sem um fio condutor, a pessoa trava
 * na primeira dúvida e o tubo vira enfeite no pátio.
 *
 * Este módulo é esse fio. Ele responde a uma pergunta só, e sempre a mesma:
 * O QUE EU FAÇO AGORA?
 *
 * Duas regras de desenho:
 *
 *   1. O estado vem de FATOS, não de botões. Se o ESP32 enviou leitura, a
 *      conexão funciona — não adianta alguém marcar "conectei" se não conectou.
 *      Só montagem e identificação são marcadas à mão, porque a plataforma não
 *      tem como ver um tubo montado nem um adesivo colado.
 *
 *   2. Uma etapa por vez. As seguintes aparecem bloqueadas, com o motivo: ver o
 *      caminho inteiro tranquiliza, e saber por que ainda não dá evita a
 *      sensação de erro.
 */

export const SETUP_STEPS = ["cadastro", "montagem", "identificacao", "firmware", "conexao", "calibracao", "verificacao"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/**
 * Etapas que alguém marca como feitas: a plataforma não enxerga um tubo montado
 * nem um adesivo colado no pátio. Todas as outras vêm de fato observado, e
 * nenhum botão as alcança.
 *
 * A VERIFICAÇÃO, em especial, não se marca: ela é a leitura dos fatos das
 * etapas anteriores. Um botão "está funcionando" seria justamente a mentira que
 * essa etapa existe para impedir.
 */
export const MANUAL_STEPS = ["montagem", "identificacao"] as const;

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
  identificacao: {
    title: "Identificação do captador",
    summary: "O adesivo com o QR Code único deste tubo. Sem ele colado, nenhuma missão começa.",
    action: "Imprimir o adesivo e colar no tubo",
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
  verificacao: {
    title: "Verificação de funcionamento",
    summary: "A conferência final: o captador está no ar e as missões estão liberadas para os estudantes.",
    action: "Conferir o captador no ar",
  },
};

/** Motivo pelo qual cada etapa espera a anterior. Escrito para quem está travado. */
const BLOQUEIO: Record<SetupStepId, string> = {
  cadastro: "",
  montagem: "Cadastre o captador primeiro.",
  identificacao: "Monte o captador antes de identificá-lo.",
  firmware: "O programa é gerado depois da montagem.",
  conexao: "Grave o programa no ESP32 antes de conectar.",
  calibracao: "A calibração precisa do captador conectado, enviando leituras.",
  verificacao: "A conferência final acontece quando a calibração for aceita.",
};

/** Uma etapa está cumprida? Fatos primeiro; marcação à mão só onde não há fato. */
function cumprida(step: SetupStepId, facts: SetupFacts): boolean {
  switch (step) {
    case "cadastro":
      return facts.registered;
    case "montagem":
    case "identificacao":
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
    case "verificacao":
      // Ninguém "conclui" a verificação: ela é verdadeira quando o captador
      // está no ar — habilitado na rede da escola e com calibração que vale
      // para a placa de hoje. Trocar o sensor derruba as duas, e a linha do
      // tempo volta sozinha para a etapa certa.
      return facts.activated && facts.calibrated;
  }
}

export interface SetupJourney {
  steps: SetupStep[];
  /** Etapa em que a pessoa está agora. `null` quando acabou. */
  currentStep: SetupStepId | null;
  /** Quantas das sete etapas estão cumpridas. */
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
 *
 * Com a verificação como última etapa, não existe mais o limbo de "tudo feito,
 * mas ainda não no ar": cumprir a sétima etapa É estar no ar.
 */
export function nextAction(journey: SetupJourney): string {
  if (journey.currentStep === null) return "Captador no ar: já aparece nas missões da escola.";
  return journey.steps.find((step) => step.id === journey.currentStep)!.action!;
}
