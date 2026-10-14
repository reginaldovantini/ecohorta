"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Droplets, QrCode, TriangleAlert, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { releaseChecklist, type ReleaseCheckIcon, type ReleaseCheckId } from "@/lib/missions/release-checklist";
import {
  releaseAction,
  requestRelease,
  restartScan,
  scanAccepted,
  scanRejected,
  toggleCheck,
  VALVE_HOLD_MS,
  type ReleaseState,
} from "@/lib/missions/release-flow";
import { SCAN_REJECTION_MESSAGE, type ScanRejection } from "@/lib/collector/scan";
import { formatLiters } from "@/lib/utils/format";
import { HoldToConfirm } from "./hold-to-confirm";
import { QrScanner } from "./qr-scanner";

/*
 * O CAMINHO ENTRE ACEITAR A MISSÃO E A ÁGUA SAIR.
 *
 *   ler o QR → o servidor confere → conferência → segurar → a torneira abre
 *
 * Uma etapa por tela, e nunca um momento em que a pessoa precise perguntar "e
 * agora?". Terminada uma etapa, a próxima aparece sozinha: ninguém toca em
 * "continuar" depois de a câmera já ter lido o adesivo.
 *
 * A leitura não é burocracia. É o que prova que o estudante está NA FRENTE DO
 * TUBO — sem ela, a missão seria um botão no sofá, e o servidor recusa por
 * isso. Aqui ela é só o primeiro passo de um caminho curto.
 *
 * O painel não reinicia a si mesmo ao abrir: quem o monta troca a `key` a cada
 * abertura, e ele nasce de novo. Reaproveitar a leitura anterior é justamente o
 * que o servidor recusa, então começar do zero não é detalhe de tela.
 */

const ICONS: Record<ReleaseCheckIcon, typeof Droplets> = {
  container: Droplets,
  volume: Droplets,
  presence: Users,
};

export interface ReleaseSheetProps {
  open: boolean;
  onClose: () => void;
  liters: number;
  collectorCode: string;
  location: string;
  /** A leitura foi validada e a pessoa conferiu tudo: pode abrir a válvula. */
  onRelease: (scanId: string) => void;
}

export function ReleaseSheet({ open, onClose, liters, collectorCode, location, onRelease }: ReleaseSheetProps) {
  const [state, setState] = useState<ReleaseState>({ stage: "scanning" });
  const [scanId, setScanId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const verificar = useCallback(
    async (token: string) => {
      setState({ stage: "verifying" });
      setErro(null);
      try {
        const response = await fetch("/api/collectors/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await response.json().catch(() => ({}))) as { scanId?: string; collectorCode?: string; error?: string };
        if (!response.ok || !body.scanId) {
          setErro(body.error ?? "Não foi possível confirmar a leitura.");
          setState(scanRejected("not_found"));
          return;
        }
        // O QR lido precisa ser o do captador desta missão.
        if (body.collectorCode && body.collectorCode !== collectorCode) {
          setState(scanRejected("other_collector"));
          return;
        }
        setScanId(body.scanId);
        // Validada: a tela anda sozinha para a conferência.
        setState(scanAccepted());
      } catch {
        setErro("Sem conexão com a plataforma. Tente de novo.");
        setState(scanRejected("not_found"));
      }
    },
    [collectorCode],
  );

  const action = releaseAction(state);
  const itens = releaseChecklist({ liters, location });

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={state.stage === "checklist" ? "Antes de abrir" : "Leia o QR do captador"}
      description={
        state.stage === "checklist"
          ? `O ${collectorCode} vai liberar ${formatLiters(liters, 1)}.`
          : `A leitura prova que você está no ${collectorCode}.`
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {(state.stage === "scanning" || state.stage === "verifying") && (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl bg-aqua-400/10 px-3 py-2.5 text-sm leading-relaxed text-mist-200">
              <QrCode className="mt-0.5 size-4 shrink-0 text-aqua-300" aria-hidden />
              Aponte a câmera para o adesivo colado no tubo. Assim que ele for reconhecido, a tela segue sozinha.
            </p>
            {state.stage === "verifying" ? (
              <p role="status" className="py-10 text-center text-sm font-semibold text-aqua-300">
                {action.label}
              </p>
            ) : (
              <QrScanner onToken={(token) => void verificar(token)} onCancel={onClose} />
            )}
          </motion.div>
        )}

        {state.stage === "rejected" && (
          <motion.div key="rejected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="rounded-2xl bg-alert-400/12 p-4">
              <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
                <TriangleAlert className="size-5 text-alert-400" aria-hidden />
                {SCAN_REJECTION_MESSAGE[state.reason]}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-mist-300">
                {erro ?? motivoAjuda(state.reason, collectorCode)}
              </p>
            </div>
            <Button variant="leaf" className="w-full" onClick={() => setState(restartScan())} icon={<QrCode className="size-5" aria-hidden />}>
              {action.label}
            </Button>
            <Button variant="ghost" size="sm" className="w-full" onClick={onClose}>
              Deixar para depois
            </Button>
          </motion.div>
        )}

        {state.stage === "checklist" && (
          <motion.div key="checklist" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <p className="flex items-center gap-2 rounded-xl bg-leaf-400/10 px-3 py-2 text-sm font-semibold text-leaf-300">
              <Check className="size-4" aria-hidden />
              Captador {collectorCode} reconhecido
            </p>

            <ul className="space-y-2">
              {itens.map((item) => {
                const Icon = ICONS[item.icon];
                const marcado = state.checked.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={marcado}
                      onClick={() => setState((atual) => toggleCheck(atual, item.id as ReleaseCheckId))}
                      className={`flex w-full items-start gap-3 rounded-2xl p-3.5 text-left ring-1 ring-inset transition-colors ${
                        marcado ? "bg-leaf-400/12 ring-leaf-400/40" : "bg-white/[0.04] ring-white/10"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                          marcado ? "bg-leaf-400 text-abyss-950" : "bg-white/[0.07] text-mist-400"
                        }`}
                      >
                        {marcado ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-mist-50">{item.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">{item.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <HoldToConfirm
              durationMs={VALVE_HOLD_MS}
              label={`Segure para liberar ${formatLiters(liters, 1)}`}
              holdingLabel="Continue segurando…"
              icon={<Droplets className="size-5" />}
              disabled={!action.enabled || scanId === null}
              onConfirm={() => {
                if (!scanId) return;
                setState((atual) => requestRelease(atual));
                onRelease(scanId);
              }}
            />
            {action.hint && !action.enabled && <p className="text-center text-xs text-mist-400">{action.hint}</p>}
          </motion.div>
        )}

        {state.stage === "releasing" && (
          <motion.p key="releasing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status" className="py-10 text-center text-sm font-semibold text-aqua-300">
            {action.label}
          </motion.p>
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}

/** O que fazer diante de cada recusa. A mensagem diz o que houve; isto, o que fazer. */
function motivoAjuda(reason: ScanRejection, collectorCode: string): string {
  switch (reason) {
    case "other_collector":
      return `Este adesivo é de outro captador. A missão é no ${collectorCode}.`;
    case "expired":
      return "A leitura vale por poucos minutos, de propósito: ela prova que você está no captador agora. Leia de novo.";
    case "already_used":
      return "Cada leitura abre a torneira uma vez. Leia o adesivo de novo para a próxima missão.";
    case "other_person":
      return "Esta leitura é de outra pessoa. Leia o adesivo com o seu celular.";
    default:
      return "Confira se é o adesivo de um captador da EcoHorta e tente de novo.";
  }
}
