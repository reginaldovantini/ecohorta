"use client";

import { Cable, Hammer, Microscope, Plus, QrCode, Ruler } from "lucide-react";
import Link from "next/link";
import { useCollectorCodes, useCollectorSnapshot, useConnectionState } from "@/components/collector/collector-source";
import { ScreenHeader } from "@/components/student/screen-header";
import { Chip } from "@/components/ui/chip";
import { OriginBadge } from "@/components/ui/real-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { formatLiters } from "@/lib/utils/format";
import { RestrictedNotice } from "./calibration-screen";
import { StickerLink } from "./collector-sticker-card";

/** Administração → Captadores: REAL ou SIMULAÇÃO, estado, sensor, calibração e acesso a bancada, calibração e ligações. */
export function CollectorsAdminScreen() {
  const { status, role, schoolName } = useProfile();
  const codes = useCollectorCodes();
  const connection = useConnectionState();

  if (status === "ready" && role !== "teacher" && role !== "admin") return <RestrictedNotice />;

  return (
    <div className="space-y-5 pt-6">
      <ScreenHeader eyebrow="Administração" title="Captadores" subtitle={schoolName ?? "Carregando…"} isSimulation={false} />
      {codes.length === 0 ? (
        connection === "online" ? (
          // A API respondeu e não há captador: quem administra precisa cadastrar
          // o primeiro, e não ficar olhando um esqueleto pulsar.
          <Surface tone="leaf" className="space-y-3 p-5">
            <p className="font-display font-semibold text-mist-50">Nenhum captador cadastrado</p>
            <p className="text-sm leading-relaxed text-mist-300">
              Cadastre o primeiro captador desta escola para começar. Ele nasce como protótipo e assume o código da
              escola quando a calibração for aceita.
            </p>
            <NovoCaptador />
          </Surface>
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Carregando">
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
        )
      ) : (
        <>
          <ul className="space-y-3">
            {codes.map((code) => (
              <li key={code}>
                <CollectorRow code={code} />
              </li>
            ))}
          </ul>
          <NovoCaptador />
        </>
      )}
    </div>
  );
}

/** A porta da primeira etapa. Existe nas duas pontas: sem captador nenhum e com vinte. */
function NovoCaptador() {
  return (
    <Link
      href="/admin/captadores/novo"
      className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-linear-to-b from-leaf-300 to-leaf-500 text-sm font-semibold text-abyss-950"
    >
      <Plus className="size-5" aria-hidden />
      Cadastrar captador
    </Link>
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
      {!calibration?.appliesToDevice && (
        <p className="flex items-start gap-2 rounded-2xl bg-sun-400/10 px-3 py-2 text-xs leading-relaxed text-sun-300">
          <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden />
          Cole o adesivo no tubo e calibre: até lá este captador não entrega litros nem aparece em missão.
        </p>
      )}
      {/*
        A porta de entrada de quem está construindo: manual, artes, programa da
        placa, rede de configuração e calibração, na ordem. Fica em primeiro lugar
        e em largura cheia porque é a única tela em que alguém pode se perder.
      */}
      <Link
        href={`${base}/construcao`}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
      >
        <Hammer className="size-4" aria-hidden />
        Construção e conexão
      </Link>
      <div className="grid grid-cols-4 gap-2">
        <StickerLink code={info.code} />
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
