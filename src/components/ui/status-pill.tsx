import type { DeviceStatus } from "@/lib/iot/types";
import { Chip, type ChipTone } from "./chip";

const statusStyle: Record<DeviceStatus, { label: string; tone: ChipTone; live: boolean }> = {
  OFFLINE: { label: "Offline", tone: "neutral", live: false },
  ONLINE: { label: "Online", tone: "leaf", live: true },
  READY: { label: "Pronto", tone: "leaf", live: true },
  DISPENSING: { label: "Liberando água", tone: "aqua", live: true },
  CALIBRATING: { label: "Calibrando", tone: "sun", live: true },
  ERROR: { label: "Erro", tone: "alert", live: false },
  MAINTENANCE: { label: "Manutenção", tone: "ember", live: false },
};

export function StatusPill({ status, className }: { status: DeviceStatus; className?: string }) {
  const { label, tone, live } = statusStyle[status];
  return (
    <Chip tone={tone} className={className}>
      <span className="relative flex size-2" aria-hidden>
        {live && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-current" />}
        <span className="relative size-2 rounded-full bg-current" />
      </span>
      {label}
    </Chip>
  );
}
