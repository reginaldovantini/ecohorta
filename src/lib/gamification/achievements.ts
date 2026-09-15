import type { ExecutionRecord } from "@/lib/missions/history";

export type AchievementIcon = "droplets" | "sprout" | "siren" | "shield" | "target";

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  icon: AchievementIcon;
}

/** Conquistas ligadas a ações físicas medidas — nunca a cliques. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: "primeira-gota", title: "Primeira Gota", description: "Concluiu a primeira missão.", icon: "droplets" },
  {
    id: "primeiro-cultivo",
    title: "Primeiro Cultivo",
    description: "Irrigou a horta, as mudas ou os temperos.",
    icon: "sprout",
  },
  { id: "guardiao-do-dreno", title: "Guardião do Dreno", description: "Concluiu uma missão de resgate.", icon: "siren" },
  { id: "guardiao-da-agua", title: "Guardião da Água", description: "Reutilizou 20 litros.", icon: "shield" },
  { id: "constancia", title: "Constância", description: "Concluiu 5 missões.", icon: "target" },
];

const CULTIVATION_MISSIONS = new Set(["irrigar-horta", "hidratar-mudas", "abastecer-temperos"]);
export const WATER_GUARDIAN_LITERS = 20;

export function unlockedAchievements(history: readonly ExecutionRecord[]): Set<string> {
  const completed = history.filter((record) => record.status === "COMPLETED");
  const litersReused = history.reduce((total, record) => total + record.deliveredLiters, 0);
  const unlocked = new Set<string>();

  if (completed.length >= 1) unlocked.add("primeira-gota");
  if (completed.some((record) => CULTIVATION_MISSIONS.has(record.missionId))) unlocked.add("primeiro-cultivo");
  if (completed.some((record) => record.missionId === "resgate")) unlocked.add("guardiao-do-dreno");
  if (litersReused >= WATER_GUARDIAN_LITERS) unlocked.add("guardiao-da-agua");
  if (completed.length >= 5) unlocked.add("constancia");
  return unlocked;
}
