import type { ExecutionRecord } from "./history";
import { MISSION_CATALOG, type MissionDefinition } from "./catalog";

/*
 * A JORNADA EM FASES.
 *
 * A fase já existia no catálogo e não trancava nada: as quatro missões
 * apareciam juntas desde o primeiro minuto. Para um estudante de 13 anos, uma
 * lista inteira aberta de uma vez é uma lista sem começo — e a missão de 4
 * litros aparecia ao lado da de 1 litro sem nada dizer qual vem antes.
 *
 * A regra é a mais simples que funciona: uma fase abre quando TODAS as missões
 * da fase anterior foram cumpridas ao menos uma vez. Não é XP, não é tempo, não
 * é sorte — é ter feito. Quem fez, abriu.
 *
 * O RESGATE fica fora disso. Ele não é progressão: é o tubo perto de
 * transbordar, e trancar a resposta a uma situação urgente atrás de progresso
 * seria transformar um aviso em prêmio.
 */

/** Missões que contam para abrir fase. Resgate não conta: ele é resposta, não etapa. */
const progressiveMissions = (catalog: readonly MissionDefinition[] = MISSION_CATALOG) =>
  catalog.filter((mission) => mission.category !== "rescue");

/** As fases do catálogo, em ordem. */
export const PHASES = [...new Set(progressiveMissions().map((mission) => mission.phase))].sort((a, b) => a - b);

const completedIds = (history: readonly ExecutionRecord[]) =>
  new Set(history.filter((record) => record.status === "COMPLETED").map((record) => record.missionId));

/**
 * O que falta para abrir a fase de uma missão.
 *
 * `missing` é o número de missões da fase ANTERIOR que ainda não foram
 * cumpridas. Zero significa aberta. A primeira fase está sempre aberta: um
 * estudante que acabou de entrar precisa ter o que fazer.
 */
export function phaseGate(
  mission: MissionDefinition,
  history: readonly ExecutionRecord[],
  catalog: readonly MissionDefinition[] = MISSION_CATALOG,
): { unlocked: boolean; missing: number; previousPhase: number | null } {
  if (mission.category === "rescue") return { unlocked: true, missing: 0, previousPhase: null };

  const fases = [...new Set(progressiveMissions(catalog).map((m) => m.phase))].sort((a, b) => a - b);
  const indice = fases.indexOf(mission.phase);
  if (indice <= 0) return { unlocked: true, missing: 0, previousPhase: null };

  const anterior = fases[indice - 1]!;
  const cumpridas = completedIds(history);
  const pendentes = progressiveMissions(catalog).filter((m) => m.phase === anterior && !cumpridas.has(m.id));
  return { unlocked: pendentes.length === 0, missing: pendentes.length, previousPhase: anterior };
}

/**
 * A fase mais alta já aberta. Serve para a tela dizer onde a pessoa está, sem
 * precisar perguntar missão por missão.
 */
export function currentPhase(history: readonly ExecutionRecord[], catalog: readonly MissionDefinition[] = MISSION_CATALOG): number {
  const fases = [...new Set(progressiveMissions(catalog).map((m) => m.phase))].sort((a, b) => a - b);
  let aberta = fases[0] ?? 1;
  for (const fase of fases) {
    const alguma = progressiveMissions(catalog).find((m) => m.phase === fase);
    if (!alguma) continue;
    if (!phaseGate(alguma, history, catalog).unlocked) break;
    aberta = fase;
  }
  return aberta;
}
