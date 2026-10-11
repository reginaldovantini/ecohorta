import { formatLiters } from "@/lib/utils/format";

/*
 * CONFERÊNCIA ANTES DE ABRIR A VÁLVULA.
 *
 * A válvula abre por gravidade e a água cai de verdade. Entre "li o QR" e "a água
 * está saindo" falta uma coisa que nenhum sensor vê: se tem um recipiente embaixo
 * da torneira. Sem isso a missão molha o chão e a água vai para o ralo do mesmo
 * jeito — só que agora por nossa causa.
 *
 * São TRÊS SELOS que acendem ao toque, não três caixas com parágrafo embaixo:
 * ninguém lê seis linhas antes de abrir uma torneira, e lista longa vira clique
 * automático. O rótulo cabe em três palavras; a frase completa existe só para
 * leitor de tela e para quem tocar no "?".
 *
 * Esta conferência é do APP, não do servidor: ela protege o chão da escola, não o
 * sistema. Quem protege o sistema é a leitura do QR, que o servidor valida
 * (src/lib/server/collector-registry.ts).
 */

export const RELEASE_CHECK_IDS = ["recipiente", "capacidade", "acompanhar"] as const;
export type ReleaseCheckId = (typeof RELEASE_CHECK_IDS)[number];

/** Ícone de cada selo. Nomes semânticos: a tela escolhe o desenho. */
export type ReleaseCheckIcon = "container" | "volume" | "presence";

export interface ReleaseCheckItem {
  id: ReleaseCheckId;
  icon: ReleaseCheckIcon;
  /** O que aparece no selo. Três palavras, no máximo. */
  label: string;
  /** Frase completa: leitor de tela e revelação opcional. Nunca ocupa a tela por padrão. */
  description: string;
}

export interface ReleaseContext {
  /** Volume que a missão vai liberar. */
  liters: number;
  /** Onde o captador está instalado, como aparece na etiqueta do tubo. */
  location: string;
}

/** Os três selos desta missão, na ordem em que a pessoa faz as coisas. */
export function releaseChecklist({ liters, location }: ReleaseContext): ReleaseCheckItem[] {
  return [
    {
      id: "recipiente",
      icon: "container",
      label: "Recipiente embaixo",
      description: `Posicionei o regador ou o balde embaixo da torneira do captador ${location}. A válvula abre sozinha e a água cai por gravidade.`,
    },
    {
      id: "capacidade",
      icon: "volume",
      label: `Cabe ${formatLiters(liters, 1)}`,
      description: `O recipiente comporta ${formatLiters(liters, 1)}. Se não couber, escolha uma missão menor: a válvula só fecha no volume medido.`,
    },
    {
      id: "acompanhar",
      icon: "presence",
      label: "Fico ao lado",
      description: "Vou ficar ao lado do captador até a válvula fechar. Dá para cancelar a qualquer momento, mas só quem está ali vê um vazamento.",
    },
  ];
}

export interface ReleaseGate {
  /** Ids já confirmados pela pessoa. */
  checked: readonly string[];
  /** A leitura do QR deste captador foi validada pelo servidor. */
  scanValidated: boolean;
}

/** Selos que ainda faltam acender. */
export function missingChecks(gate: ReleaseGate): ReleaseCheckId[] {
  return RELEASE_CHECK_IDS.filter((id) => !gate.checked.includes(id));
}

/**
 * O botão de liberar só acorda com a leitura validada E os três selos acesos.
 * As duas condições são necessárias: o QR prova presença, os selos provam preparo.
 */
export function canRelease(gate: ReleaseGate): boolean {
  return gate.scanValidated && missingChecks(gate).length === 0;
}

/** O que falta, em poucas palavras, para a linha sob o botão desabilitado. */
export function releaseBlockedReason(gate: ReleaseGate): string | null {
  if (!gate.scanValidated) return "Leia o QR do captador";
  const missing = missingChecks(gate).length;
  if (missing === 0) return null;
  return missing === 1 ? "Falta 1 confirmação" : `Faltam ${missing} confirmações`;
}
