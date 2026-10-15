"use client";

import { Bell, BellOff } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";

/*
 * LIGAR OS AVISOS DO CAPTADOR.
 *
 * O tubo enche durante a aula, quando o ar-condicionado está ligado. Numa manhã
 * de calor ele passa de 95% e a água começa a escorrer pelo dreno — e sem aviso
 * quem descobre é quem abre o aplicativo por acaso.
 *
 * O pedido de permissão só acontece NO TOQUE, nunca ao abrir a tela. Navegador
 * que pergunta sozinho leva "bloquear", e bloqueado não se desfaz de dentro do
 * aplicativo: a pessoa teria de achar as configurações do navegador. Um pedido
 * mal colocado custa o canal para sempre.
 */

type Estado = "indisponivel" | "bloqueado" | "desligado" | "ligado";

/** A permissão vive no navegador, fora do React: lida por assinatura, sem efeito. */
function subscribePermission(onChange: () => void) {
  if (typeof navigator === "undefined" || !("permissions" in navigator)) return () => undefined;
  let parar = () => undefined as void;
  void navigator.permissions
    .query({ name: "notifications" as PermissionName })
    .then((status) => {
      status.addEventListener("change", onChange);
      parar = () => status.removeEventListener("change", onChange);
    })
    .catch(() => undefined);
  return () => parar();
}

const lerPermissao = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export function NotificationToggle({ publicKey }: { publicKey: string | null }) {
  const permissao = useSyncExternalStore(subscribePermission, lerPermissao, () => "default" as const);
  const [inscrito, setInscrito] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const suportado =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && permissao !== "unsupported";

  const estado: Estado = !suportado || !publicKey
    ? "indisponivel"
    : permissao === "denied"
      ? "bloqueado"
      : inscrito ?? permissao === "granted"
        ? "ligado"
        : "desligado";

  const ligar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      // A permissão é pedida aqui, no toque, e não ao montar a tela.
      const concedida = await Notification.requestPermission();
      if (concedida !== "granted") {
        setErro("Os avisos ficaram bloqueados. Libere nas configurações do navegador para este site.");
        return;
      }
      const registro = await navigator.serviceWorker.ready;
      const inscricao =
        (await registro.pushManager.getSubscription()) ??
        (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey! }));

      const response = await fetch("/api/me/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inscricao.toJSON()),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setErro(body.error ?? "Não foi possível ligar os avisos.");
        return;
      }
      setInscrito(true);
    } catch {
      setErro("Não foi possível ligar os avisos neste aparelho.");
    } finally {
      setOcupado(false);
    }
  };

  const desligar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const registro = await navigator.serviceWorker.ready;
      const inscricao = await registro.pushManager.getSubscription();
      if (inscricao) {
        await fetch("/api/me/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: inscricao.endpoint }),
        });
        await inscricao.unsubscribe();
      }
      setInscrito(false);
    } catch {
      setErro("Não foi possível desligar os avisos.");
    } finally {
      setOcupado(false);
    }
  };

  if (estado === "indisponivel") return null;

  const ligado = estado === "ligado";
  return (
    <Surface className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
            ligado ? "bg-leaf-400/15 text-leaf-300" : "bg-white/[0.06] text-mist-400",
          )}
        >
          {ligado ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-mist-50">Avisos do captador</p>
          <p className="mt-0.5 text-xs leading-relaxed text-mist-400">
            {estado === "bloqueado"
              ? "Os avisos estão bloqueados para este site. Libere nas configurações do navegador."
              : ligado
                ? "Você é avisado quando o tubo está enchendo e a água corre risco de escorrer pelo dreno."
                : "O tubo enche durante a aula, com o ar-condicionado ligado. Ligue para ser avisado quando houver água esperando."}
          </p>
        </div>
        {estado !== "bloqueado" && (
          <button
            type="button"
            role="switch"
            aria-checked={ligado}
            aria-label="Avisos do captador"
            disabled={ocupado}
            onClick={() => void (ligado ? desligar() : ligar())}
            className={cn(
              "mt-0.5 h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors",
              ligado ? "bg-leaf-400" : "bg-white/15",
              ocupado && "opacity-60",
            )}
          >
            <span className={cn("block size-6 rounded-full bg-white transition-transform", ligado ? "translate-x-5" : "translate-x-0")} />
          </button>
        )}
      </div>
      {erro && <p className="text-xs leading-relaxed text-alert-300">{erro}</p>}
    </Surface>
  );
}
