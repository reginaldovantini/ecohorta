"use client";

import { motion } from "motion/react";
import { ArrowRight, Droplets, Siren, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Surface, type SurfaceTone } from "@/components/ui/surface";
import type { AlertKind, CollectorAlert } from "@/lib/collector/alerts";
import { cn } from "@/lib/utils/cn";

const STYLE: Record<AlertKind, { tone: SurfaceTone; icon: typeof Siren; iconClass: string }> = {
  overflow: { tone: "alert", icon: Siren, iconClass: "bg-alert-400/20 text-alert-400" },
  critical: { tone: "alert", icon: Siren, iconClass: "bg-alert-400/20 text-alert-400" },
  attention: { tone: "ember", icon: TriangleAlert, iconClass: "bg-ember-400/20 text-ember-400" },
  filling: { tone: "aqua", icon: Droplets, iconClass: "bg-aqua-400/15 text-aqua-300" },
};

export function CollectorAlertBanner({ alert }: { alert: CollectorAlert }) {
  const { tone, icon: Icon, iconClass } = STYLE[alert.kind];
  const urgent = alert.kind === "overflow" || alert.kind === "critical";

  return (
    <motion.div
      key={alert.kind}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
    >
      <Surface tone={tone} role={urgent ? "alert" : "status"} className="flex gap-3.5 p-4">
        <span className={cn("relative grid size-10 shrink-0 place-items-center rounded-full", iconClass)}>
          {urgent && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-current opacity-40" aria-hidden />}
          <Icon className="relative size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-mist-50">{alert.title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-mist-300">{alert.message}</p>
          {alert.callToAction && (
            <Link
              href="/missoes"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-mist-50 underline-offset-4 hover:underline"
            >
              Ver missões <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </Surface>
    </motion.div>
  );
}
