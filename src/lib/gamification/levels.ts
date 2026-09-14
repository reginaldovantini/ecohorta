export interface LevelDefinition {
  level: number;
  title: string;
  minXp: number;
}

export const LEVELS: readonly LevelDefinition[] = [
  { level: 1, title: "Semente", minXp: 0 },
  { level: 2, title: "Broto", minXp: 100 },
  { level: 3, title: "Explorador", minXp: 250 },
  { level: 4, title: "Guardião da Água", minXp: 500 },
  { level: 5, title: "Investigador", minXp: 800 },
  { level: 6, title: "Engenheiro Verde", minXp: 1200 },
  { level: 7, title: "Cientista", minXp: 1700 },
  { level: 8, title: "Agente de Impacto", minXp: 2300 },
  { level: 9, title: "Multiplicador", minXp: 3000 },
  { level: 10, title: "Embaixador EcoHorta", minXp: 4000 },
];

export interface LevelProgress {
  level: number;
  title: string;
  xp: number;
  currentLevelXp: number;
  /** `null` no nível máximo. */
  nextLevelXp: number | null;
  /** 0 a 1 dentro do nível atual. */
  progress: number;
}

export function getLevelProgress(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(xp));
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safeXp >= LEVELS[i]!.minXp) index = i;
  }
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1];
  return {
    level: current.level,
    title: current.title,
    xp: safeXp,
    currentLevelXp: current.minXp,
    nextLevelXp: next?.minXp ?? null,
    progress: next ? (safeXp - current.minXp) / (next.minXp - current.minXp) : 1,
  };
}
