export type LevelStateId = "low" | "available" | "good" | "attention" | "critical";
export type Urgency = "normal" | "attention" | "critical";

export interface LevelState {
  id: LevelStateId;
  label: string;
  message: string;
  urgency: Urgency;
}

/** Faixas de nível do captador (percentual inteiro, igual ao exibido na tela). */
const LEVEL_STATES: readonly (LevelState & { maxPercent: number })[] = [
  {
    id: "low",
    maxPercent: 30,
    label: "Baixo",
    message: "O reservatório está começando a acumular água.",
    urgency: "normal",
  },
  {
    id: "available",
    maxPercent: 70,
    label: "Disponível",
    message: "Existem missões disponíveis.",
    urgency: "normal",
  },
  {
    id: "good",
    maxPercent: 85,
    label: "Boa disponibilidade",
    message: "Muitas ações sustentáveis podem ser realizadas.",
    urgency: "normal",
  },
  {
    id: "attention",
    maxPercent: 95,
    label: "Atenção",
    message: "O captador está ficando cheio.",
    urgency: "attention",
  },
  {
    id: "critical",
    maxPercent: 100,
    label: "Crítico",
    message: "Água próxima do transbordamento.",
    urgency: "critical",
  },
];

export function fillRatio(volumeLiters: number, capacityLiters: number) {
  if (capacityLiters <= 0) return 0;
  return Math.min(1, Math.max(0, volumeLiters / capacityLiters));
}

export function getLevelState(ratio: number): LevelState {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const match = LEVEL_STATES.find((state) => percent <= state.maxPercent) ?? LEVEL_STATES[LEVEL_STATES.length - 1]!;
  return { id: match.id, label: match.label, message: match.message, urgency: match.urgency };
}
