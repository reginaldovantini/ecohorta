import type { WaterTrend } from "@/lib/iot/types";
import { formatPercent } from "@/lib/utils/format";
import { getLevelState } from "./level-state";

export type AlertKind = "overflow" | "critical" | "attention" | "filling";

export interface CollectorAlert {
  kind: AlertKind;
  title: string;
  message: string;
  /** Alertas que pedem ação mostram atalho para as missões. */
  callToAction: boolean;
}

interface AlertInput {
  collectorCode: string;
  ratio: number;
  trend: WaterTrend;
  overflowing: boolean;
}

/** Alerta dinâmico da Home: cria urgência real, sem pressão artificial. */
export function getCollectorAlert({ collectorCode, ratio, trend, overflowing }: AlertInput): CollectorAlert | null {
  if (overflowing) {
    return {
      kind: "overflow",
      title: "Alerta de desperdício",
      message: `O captador ${collectorCode} atingiu o limite. A água que continua chegando está indo para o dreno de segurança. Você pode ajudar.`,
      callToAction: true,
    };
  }

  const { urgency } = getLevelState(ratio);

  if (urgency === "critical") {
    return {
      kind: "critical",
      title: "Precisamos de ajuda!",
      message: `O captador ${collectorCode} está com ${formatPercent(ratio)} da capacidade. Uma ação agora pode evitar desperdício.`,
      callToAction: true,
    };
  }

  if (urgency === "attention") {
    return {
      kind: "attention",
      title: "O captador está quase cheio!",
      message: "Uma missão agora mantém espaço para a água que continua chegando.",
      callToAction: true,
    };
  }

  if (trend === "rising") {
    return {
      kind: "filling",
      title: "O captador está acumulando água!",
      message: "O ar-condicionado está produzindo condensado neste momento.",
      callToAction: false,
    };
  }

  return null;
}
