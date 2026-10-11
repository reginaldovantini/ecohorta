import type { ScanRejection } from "@/lib/server/collector-registry";
import { SCAN_REJECTION_MESSAGE } from "@/lib/server/collector-registry";
import { canRelease, releaseBlockedReason, type ReleaseCheckId } from "./release-checklist";

/*
 * O PERCURSO ENTRE ACEITAR A MISSÃO E A ÁGUA SAIR.
 *
 *   aceitar  →  câmera abre  →  servidor confere a leitura  →  conferência  →  segurar
 *
 * O botão de baixo é o fio condutor: ele muda de texto e de função a cada etapa, em
 * vez de a tela encher de botões. Em nenhuma etapa ele mente — quando está
 * desabilitado, diz o que falta.
 *
 * Só a última etapa abre a válvula, e ela exige segurar: um toque acidental no
 * bolso não molha o chão da escola.
 *
 * A máquina vive aqui, fora da tela, porque é ela que decide quando a água pode
 * sair. Teste de interface é lento e frágil; esta regra precisa ser barata de provar.
 */

/**
 * Quanto tempo o botão fica pressionado até a válvula abrir.
 *
 * Três segundos é tempo de pensar: longo o bastante para que um toque no bolso
 * ou um esbarrão não molhem o chão, e curto o bastante para não irritar quem
 * está ali com o regador na mão. O anel de progresso mostra a contagem.
 */
export const VALVE_HOLD_MS = 3000;

export type ReleaseState =
  /** Câmera aberta, procurando o QR colado no tubo. */
  | { stage: "scanning" }
  /** Leitura enviada: o servidor confere pessoa, captador, validade e uso único. */
  | { stage: "verifying" }
  /** O servidor recusou a leitura. O motivo vem dele, não do celular. */
  | { stage: "rejected"; reason: ScanRejection }
  /** Presença provada. Falta a conferência física antes de liberar. */
  | { stage: "checklist"; checked: readonly ReleaseCheckId[] }
  /** Válvula aberta, água saindo. */
  | { stage: "releasing" };

export interface ReleaseAction {
  /** O que o botão de baixo faz nesta etapa. */
  kind: "camera" | "wait" | "retry" | "hold";
  label: string;
  enabled: boolean;
  /** Linha de apoio sob o botão quando ele está desabilitado. */
  hint: string | null;
  /** Só `hold` abre a válvula, e só depois de carregar segurando. */
  opensValve: boolean;
}

/** O botão de baixo nesta etapa: texto, se responde ao toque e se abre a válvula. */
export function releaseAction(state: ReleaseState): ReleaseAction {
  switch (state.stage) {
    case "scanning":
      // A mira animada da câmera já diz o que fazer: o rótulo não repete a tela.
      return { kind: "camera", label: "Procurando o QR", enabled: false, hint: null, opensValve: false };

    case "verifying":
      return { kind: "wait", label: "Verificando…", enabled: false, hint: null, opensValve: false };

    case "rejected":
      return { kind: "retry", label: "Ler de novo", enabled: true, hint: SCAN_REJECTION_MESSAGE[state.reason], opensValve: false };

    case "checklist": {
      const gate = { checked: state.checked, scanValidated: true };
      const ready = canRelease(gate);
      return {
        kind: "hold",
        label: "Abrir torneira",
        enabled: ready,
        hint: ready ? "Segure para abrir" : releaseBlockedReason(gate),
        opensValve: ready,
      };
    }

    case "releasing":
      return { kind: "wait", label: "Liberando água…", enabled: false, hint: null, opensValve: false };
  }
}

/** A leitura foi aceita pelo servidor: a câmera fecha e começa a conferência. */
export const scanAccepted = (): ReleaseState => ({ stage: "checklist", checked: [] });

/** A leitura foi recusada: o motivo aparece e a câmera pode abrir de novo. */
export const scanRejected = (reason: ScanRejection): ReleaseState => ({ stage: "rejected", reason });

/** Marca ou desmarca um item da conferência. Fora da etapa de conferência, nada muda. */
export function toggleCheck(state: ReleaseState, id: ReleaseCheckId): ReleaseState {
  if (state.stage !== "checklist") return state;
  const checked = state.checked.includes(id) ? state.checked.filter((item) => item !== id) : [...state.checked, id];
  return { stage: "checklist", checked };
}

/**
 * Pedido de abertura da válvula, depois de segurar o botão.
 * Devolve o mesmo estado quando ainda falta alguma coisa: segurar o botão nunca
 * substitui a leitura nem a conferência.
 */
export function requestRelease(state: ReleaseState): ReleaseState {
  return releaseAction(state).opensValve ? { stage: "releasing" } : state;
}

/** Recomeçar a leitura (botão de tentar de novo, ou QR do captador errado). */
export const restartScan = (): ReleaseState => ({ stage: "scanning" });
