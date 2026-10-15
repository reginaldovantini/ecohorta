"use client";

import { motion } from "motion/react";
import { House, Images, Target, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/*
 * Cinco abas, e a Água saiu para o Mural entrar.
 *
 * O nível do captador aparece na Início, grande, com o tubo animado — ter uma
 * aba inteira para repetir isso era espaço gasto. O mural não tinha onde estar,
 * e é ele que faz a turma do lado querer fazer missão.
 */
const TABS = [
  { href: "/", label: "Início", icon: House },
  { href: "/missoes", label: "Missões", icon: Target },
  { href: "/mural", label: "Mural", icon: Images },
  { href: "/ranking", label: "Ranking", icon: Trophy },
  { href: "/perfil", label: "Perfil", icon: UserRound },
] as const;

export function BottomNav({ availableMissions }: { availableMissions: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-30 pb-safe">
      <div className="mx-auto max-w-md px-3 pb-2">
        <div className="flex rounded-[1.5rem] border border-white/[0.08] bg-abyss-850/90 p-1.5 shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.85)] backdrop-blur-md">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            const badge = href === "/missoes" && availableMissions > 0 ? availableMissions : null;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-1 flex-col items-center gap-1 rounded-[1.1rem] py-2 active:scale-95 transition-transform"
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    className="absolute inset-0 rounded-[1.1rem] bg-white/[0.07] ring-1 ring-inset ring-aqua-400/20"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative">
                  <Icon
                    className={cn("size-[22px] transition-colors", active ? "text-aqua-300" : "text-mist-400")}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden
                  />
                  {badge !== null && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-leaf-400 px-1 text-[10px] font-bold text-abyss-950">
                      {badge}
                      <span className="sr-only"> missões disponíveis</span>
                    </span>
                  )}
                </span>
                <span className={cn("relative text-[11px] font-semibold", active ? "text-mist-50" : "text-mist-400")}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
