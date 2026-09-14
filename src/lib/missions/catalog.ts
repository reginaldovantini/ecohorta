export type MissionCategory =
  | "action"
  | "investigation"
  | "math"
  | "science"
  | "engineering"
  | "collaborative"
  | "rescue";

/**
 * Como a missão é executada. Hoje só existem missões de liberação de água
 * (ação física medida pelo sensor). Investigação, matemática, ciência e
 * colaborativas entram com seus próprios fluxos — sem cards de fachada.
 */
export type MissionKind = "dispense";

export type MissionDifficulty = "easy" | "medium" | "hard";
export type MissionArtKind = "garden" | "vegetable-bed" | "seedlings" | "herbs" | "rescue";

export interface MissionDefinition {
  id: string;
  /** Fase da jornada (1 = Descobridor … 7 = Multiplicador). */
  phase: number;
  category: MissionCategory;
  kind: MissionKind;
  title: string;
  summary: string;
  /** Passos da ação física, exibidos antes de liberar a água. */
  steps: string[];
  /** Volume a liberar; `null` quando é definido no momento (resgate). */
  liters: number | null;
  xp: number;
  difficulty: MissionDifficulty;
  durationMinutes: number;
  location: string;
  art: MissionArtKind;
  /** Resultado concreto mostrado ao concluir, ex.: "Jardim irrigado". */
  impact: string;
}

export const DIFFICULTY_LABEL: Record<MissionDifficulty, string> = {
  easy: "Fácil",
  medium: "Média",
  hard: "Desafiadora",
};

export const CATEGORY_LABEL: Record<MissionCategory, string> = {
  action: "Ação",
  investigation: "Investigação",
  math: "Matemática",
  science: "Ciência",
  engineering: "Engenharia",
  collaborative: "Colaborativa",
  rescue: "Resgate",
};

const DISPENSE_STEPS = (last: string) => [
  "Pegue o regador identificado da EcoHorta.",
  "Posicione o regador sob a saída do captador.",
  "Confirme a liberação e aguarde a medição do sensor.",
  last,
];

/**
 * Missões de ação (Fases 1–2). Locais e volumes devem ser ajustados à
 * realidade da escola; a partir dos Dias 6–7 o catálogo passa para a tabela `missions`.
 */
export const MISSION_CATALOG: readonly MissionDefinition[] = [
  {
    id: "regar-jardim",
    phase: 1,
    category: "action",
    kind: "dispense",
    title: "Regar o jardim",
    summary: "Leve a água reutilizada até as plantas do jardim da escola.",
    steps: DISPENSE_STEPS("Regue a base das plantas, não as folhas."),
    liters: 3,
    xp: 50,
    difficulty: "easy",
    durationMinutes: 10,
    location: "Jardim da escola",
    art: "garden",
    impact: "Jardim irrigado",
  },
  {
    id: "irrigar-horta",
    phase: 1,
    category: "action",
    kind: "dispense",
    title: "Irrigar a horta",
    summary: "Hidrate os canteiros da horta com a água captada do ar-condicionado.",
    steps: DISPENSE_STEPS("Distribua a água entre os canteiros mais secos."),
    liters: 2,
    xp: 50,
    difficulty: "easy",
    durationMinutes: 8,
    location: "Horta",
    art: "vegetable-bed",
    impact: "Horta irrigada",
  },
  {
    id: "hidratar-mudas",
    phase: 1,
    category: "action",
    kind: "dispense",
    title: "Hidratar as mudas",
    summary: "Mudas pequenas precisam de pouca água e de cuidado constante.",
    steps: DISPENSE_STEPS("Molhe o substrato de cada muda com cuidado."),
    liters: 1,
    xp: 20,
    difficulty: "easy",
    durationMinutes: 5,
    location: "Viveiro de mudas",
    art: "seedlings",
    impact: "Mudas hidratadas",
  },
  {
    id: "abastecer-temperos",
    phase: 2,
    category: "action",
    kind: "dispense",
    title: "Abastecer o canteiro de temperos",
    summary: "Uma rega completa no canteiro de temperos da cozinha da escola.",
    steps: [
      "Use dois regadores identificados da EcoHorta.",
      "Posicione o primeiro regador sob a saída do captador.",
      "Confirme a liberação e troque de regador quando o primeiro encher.",
      "Regue o canteiro de forma uniforme.",
    ],
    liters: 4,
    xp: 50,
    difficulty: "medium",
    durationMinutes: 15,
    location: "Canteiro de temperos",
    art: "herbs",
    impact: "Temperos regados",
  },
];

/** Modelo da Missão de Resgate: o volume é calculado a partir do nível medido (ver rescue.ts). */
export const RESCUE_MISSION_TEMPLATE: MissionDefinition = {
  id: "resgate",
  phase: 2,
  category: "rescue",
  kind: "dispense",
  title: "Missão de resgate",
  summary: "O captador está perto do limite. Reutilize a água antes que ela siga para o dreno de segurança.",
  steps: DISPENSE_STEPS("Use a água na área verde mais próxima."),
  liters: null,
  xp: 60,
  difficulty: "easy",
  durationMinutes: 10,
  location: "Área verde mais próxima",
  art: "rescue",
  impact: "Água resgatada do dreno",
};

export function findMission(id: string) {
  return MISSION_CATALOG.find((mission) => mission.id === id) ?? (id === RESCUE_MISSION_TEMPLATE.id ? RESCUE_MISSION_TEMPLATE : null);
}
