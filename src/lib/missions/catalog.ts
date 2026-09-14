export type MissionCategory = "action" | "investigation" | "math" | "science" | "observation" | "collaborative";
export type MissionDifficulty = "easy" | "medium" | "hard";
export type MissionIcon = "flower" | "sprout" | "seedling" | "herbs";

export interface MissionDefinition {
  id: string;
  /** Fase da jornada (1 = Descobridor … 7 = Multiplicador). */
  phase: number;
  category: MissionCategory;
  title: string;
  summary: string;
  /** Passos da ação física, exibidos antes de liberar a água. */
  steps: string[];
  /** Volume a liberar; `null` para missões que não usam água do captador. */
  liters: number | null;
  xp: number;
  difficulty: MissionDifficulty;
  durationMinutes: number;
  location: string;
  icon: MissionIcon;
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
  observation: "Observação",
  collaborative: "Colaborativa",
};

/**
 * Conteúdo inicial das missões de ação (Fases 1–2).
 * Os locais e volumes devem ser ajustados à realidade da escola;
 * a partir dos Dias 6–7 este catálogo passa para a tabela `missions`.
 */
export const MISSION_CATALOG: readonly MissionDefinition[] = [
  {
    id: "regar-jardim",
    phase: 1,
    category: "action",
    title: "Regar o jardim",
    summary: "Leve a água reutilizada até as plantas do jardim da escola.",
    steps: [
      "Pegue o regador identificado da EcoHorta.",
      "Posicione o regador sob a saída do captador.",
      "Confirme a liberação e aguarde a medição do sensor.",
      "Regue a base das plantas, não as folhas.",
    ],
    liters: 3,
    xp: 50,
    difficulty: "easy",
    durationMinutes: 10,
    location: "Jardim da escola",
    icon: "flower",
  },
  {
    id: "irrigar-horta",
    phase: 1,
    category: "action",
    title: "Irrigar a horta",
    summary: "Hidrate os canteiros da horta com a água captada do ar-condicionado.",
    steps: [
      "Pegue o regador identificado da EcoHorta.",
      "Posicione o regador sob a saída do captador.",
      "Confirme a liberação e aguarde a medição do sensor.",
      "Distribua a água entre os canteiros mais secos.",
    ],
    liters: 2,
    xp: 50,
    difficulty: "easy",
    durationMinutes: 8,
    location: "Horta",
    icon: "sprout",
  },
  {
    id: "hidratar-mudas",
    phase: 1,
    category: "action",
    title: "Hidratar as mudas",
    summary: "Mudas pequenas precisam de pouca água e de cuidado constante.",
    steps: [
      "Use o borrifador ou o regador pequeno da EcoHorta.",
      "Posicione o recipiente sob a saída do captador.",
      "Confirme a liberação e aguarde a medição do sensor.",
      "Molhe o substrato de cada muda com cuidado.",
    ],
    liters: 1,
    xp: 20,
    difficulty: "easy",
    durationMinutes: 5,
    location: "Viveiro de mudas",
    icon: "seedling",
  },
  {
    id: "abastecer-temperos",
    phase: 2,
    category: "action",
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
    icon: "herbs",
  },
];

export function findMission(id: string) {
  return MISSION_CATALOG.find((mission) => mission.id === id) ?? null;
}
