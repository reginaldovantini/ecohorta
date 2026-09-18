"use client";

import { Cable, Microscope, Ruler } from "lucide-react";
import Link from "next/link";
import { useCollectorCodes, useCollectorSnapshot } from "@/components/collector/collector-source";
import { ScreenHeader } from "@/components/student/screen-header";
import { Chip } from "@/components/ui/chip";
import { OriginBadge } from "@/components/ui/real-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { formatLiters } from "@/lib/utils/format";
import { RestrictedNotice } from "./calibration-screen";

/** Administração → Captadores: REAL ou SIMULAÇÃO, estado, sensor, calibração e acesso a bancada, calibração e ligações. */
export function CollectorsAdminScreen() {
  const { status, role, schoolName } = useProfile();
  const codes = useCollectorCodes();

  if (status === "ready" && role !== "teacher" && role !== "admin") return <RestrictedNotice />;

  return (
    <div className="space-y-5 pt-6">
      <ScreenHeader eyebrow="Administração" title="Captadores" subtitle={schoolName ?? "Carregando…"} isSimulation={false} />
      {codes.length === 0 ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando">
          <Skeleton className="h-24 w-full rounded-card" />
        </div>
      ) : (
        <ul className="space-y-3">
          {codes.map((code) => (
            <li key={code}>
              <CollectorRow code={code} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectorRow({ code }: { code: string }) {
  const snapshot = useCollectorSnapshot(code);
  if (!snapshot) return <Skeleton className="h-32 w-full rounded-card" />;
  const { info, telemetry, calibration, hardware } = snapshot;
  const base = `/admin/captadores/${encodeURIComponent(code)}`;

  return (
    <Surface className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-aqua-400/15 text-aqua-300">
          <Ruler className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate font-display font-semibold text-mist-50">
            {info.code} · {info.name}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <OriginBadge origin={telemetry.origin} />
            <StatusPill status={telemetry.status} />
            {hardware && (
              <Chip tone={hardware.compatibility === "incompatible" ? "alert" : "neutral"}>
                {hardware.compatibility === "incompatible" ? "⚠️ Hardware incompatível" : hardware.distanceSensor}
              </Chip>
            )}
            {calibration?.appliesToDevice ? (
              <Chip tone="leaf">
                Calibração v{calibration.version} · {formatLiters(calibration.capacityLiters)}
              </Chip>
            ) : calibration ? (
              <Chip tone="ember">{calibration.mismatch === "other_sensor" ? "Recalibrar: outro sensor" : "Recalibrar: outro dispositivo"}</Chip>
            ) : (
              <Chip tone="sun">Sem calibração</Chip>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { href: `${base}/ligacoes`, label: "Ligações", icon: Cable },
          { href: `${base}/bancada`, label: "Bancada", icon: Microscope },
          { href: `${base}/calibracao`, label: "Calibração", icon: Ruler },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-control bg-white/[0.07] text-xs font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
          >
            <Icon className="size-4" aria-hidden /> {label}
          </Link>
        ))}
      </div>
    </Surface>
  );
}
