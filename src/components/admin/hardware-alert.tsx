import { Cable, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import type { CollectorHardwareStatus } from "@/lib/iot/types";

/**
 * Aviso de hardware nas telas de bancada e calibração: incompatibilidade entre o sensor
 * configurado e o driver do firmware, ou sensor ausente/em falha. Nada quando está tudo certo.
 */
export function HardwareAlert({ hardware, code }: { hardware: CollectorHardwareStatus; code: string }) {
  const incompatible = hardware.compatibility === "incompatible";
  if (!incompatible && hardware.compatibility !== "sensor_missing" && hardware.compatibility !== "sensor_fault") return null;
  return (
    <Surface tone={incompatible ? "alert" : "ember"} role={incompatible ? "alert" : "status"} className="space-y-2 p-4">
      <p className={incompatible ? "font-display text-sm font-bold text-alert-400" : "flex items-center gap-2 font-display text-sm font-bold text-mist-50"}>
        {incompatible ? (
          "⚠️ INCOMPATIBILIDADE DE HARDWARE"
        ) : (
          <>
            <TriangleAlert className="size-4 text-ember-400" aria-hidden /> {hardware.compatibility === "sensor_missing" ? "Sensor não encontrado" : "Falha no sensor"}
          </>
        )}
      </p>
      <p className="text-xs leading-relaxed text-mist-300">{hardware.message}</p>
      <Link href={`/admin/captadores/${encodeURIComponent(code)}/ligacoes`} className="inline-flex items-center gap-2 text-sm font-semibold text-aqua-300">
        <Cable className="size-4" aria-hidden /> Conferir sensor e ligações
      </Link>
    </Surface>
  );
}
