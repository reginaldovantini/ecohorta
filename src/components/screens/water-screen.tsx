"use client";

import { CollectorLiveCard } from "@/components/collector/collector-live-card";
import { usePrimaryCollectorCode, useCollectorSnapshot } from "@/components/collector/collector-source";
import { WaterBalance } from "@/components/collector/water-balance";
import { ScreenHeader } from "@/components/student/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { availableLiters } from "@/lib/collector/water";
import type { ValveKind, ValveState } from "@/lib/iot/types";
import { formatDecimal, formatLiters, formatRelativeTime } from "@/lib/utils/format";

const VALVE_STATE: Record<ValveState, string> = { closed: "Fechada", open: "Aberta", unknown: "Desconhecida" };
const VALVE_KIND: Record<ValveKind, string> = {
  undefined: "A definir",
  solenoid_direct_acting: "Solenoide ação direta",
  motorized_ball: "Esfera motorizada",
  pump: "Bomba",
};

export function WaterScreen() {
  const collectorCode = usePrimaryCollectorCode();
  const snapshot = useCollectorSnapshot(collectorCode);
  const now = useNow(1000);

  if (!snapshot) {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-1/2" />
        <Skeleton className="h-72 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    );
  }

  const { info, telemetry, totals } = snapshot;
  const rows = [
    { label: "Distância do sensor", value: telemetry.distanceMm === null ? "—" : `${telemetry.distanceMm} mm`, mono: true },
    { label: "Livre para missões", value: formatLiters(availableLiters(telemetry.volumeLiters, info.reserveLiters)) },
    { label: "Reserva mínima", value: formatLiters(info.reserveLiters) },
    {
      label: "Variação líquida",
      value: `${telemetry.netFlowLitersPerHour >= 0 ? "+" : ""}${formatDecimal(telemetry.netFlowLitersPerHour)} L/h`,
    },
    { label: "Válvula", value: VALVE_STATE[telemetry.valve] },
    { label: "Última leitura", value: now === null ? "—" : formatRelativeTime(telemetry.measuredAt, now) },
    { label: "Dispositivo", value: telemetry.deviceId, mono: true },
    { label: "Tipo de válvula", value: VALVE_KIND[info.valveKind] },
  ];

  return (
    <div className="space-y-6 pt-6">
      <ScreenHeader
        eyebrow={`EcoCaptador · ${info.location}`}
        title={info.code}
        subtitle="Leituras do sensor de nível em tempo real"
        isSimulation={telemetry.origin === "simulation"}
      />

      <CollectorLiveCard snapshot={snapshot} />

      <section className="space-y-3">
        <h2 className="eyebrow">Telemetria</h2>
        <Surface className="grid grid-cols-2 gap-px overflow-hidden bg-white/[0.06]">
          {rows.map((row) => (
            <div key={row.label} className="bg-abyss-800 p-4">
              <p className="eyebrow">{row.label}</p>
              <p className={`mt-1 truncate text-[0.95rem] font-semibold text-mist-50 ${row.mono ? "font-mono text-sm" : "font-display"}`}>
                {row.value}
              </p>
            </div>
          ))}
        </Surface>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Balanço hídrico</h2>
        <WaterBalance totals={totals} />
      </section>

      {info.valveKind === "undefined" && (
        <Surface tone="ember" className="p-4 text-sm leading-relaxed text-mist-300">
          <p className="font-display font-semibold text-mist-50">Válvula em validação física</p>
          O captador funciona por gravidade. A válvula de saída precisa ser normalmente fechada e de acionamento direto
          (pressão mínima zero). O modelo definitivo será escolhido após os testes de vazão.
        </Surface>
      )}
    </div>
  );
}
