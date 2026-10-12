"use client";

import { motion } from "motion/react";
import Image from "next/image";

/*
 * COMO VAI FICAR NO CELULAR.
 *
 * Terminada a instalação, a pergunta que sobra é "e agora, onde está?". Dizer
 * "procure na sua tela inicial" não basta: a pessoa tem trinta ícones e não
 * sabe o que procurar. Então mostramos — o ícone de verdade, com o nome de
 * verdade, no lugar onde ele vai aparecer.
 *
 * O nome embaixo do ícone é o `short_name` do manifesto, "EcoHorta". É esse,
 * e não "EcoHorta Inteligente", que o sistema escreve na tela inicial.
 */

/** Ícones vizinhos, só para o nosso se destacar entre eles. */
const VIZINHOS = [
  "bg-sky-400/25",
  "bg-amber-400/20",
  "bg-rose-400/20",
  "bg-violet-400/20",
  "bg-emerald-400/15",
  "bg-slate-400/20",
  "bg-orange-400/20",
] as const;

export function HomeScreenPreview() {
  return (
    <div className="mx-auto w-[216px]">
      <div className="relative overflow-hidden rounded-[30px] bg-linear-to-b from-leaf-900 via-abyss-900 to-abyss-950 p-3 shadow-[0_26px_60px_-24px_rgb(0_0_0/0.85)] ring-1 ring-white/12">
        {/* Barra de status e ilha do aparelho, em dois traços. */}
        <div className="flex items-center justify-between px-1.5 pb-2 pt-0.5">
          <span className="text-[0.55rem] font-semibold text-white/70">9:41</span>
          <span className="h-3 w-12 rounded-full bg-black/60" />
          <span className="flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
            <span className="h-2 w-3 rounded-[2px] bg-white/50" />
          </span>
        </div>

        <div className="grid grid-cols-4 gap-x-3 gap-y-3.5 px-1 pb-2">
          {/* A EcoHorta, acesa, com o nome que o sistema escreve. */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.25, type: "spring", stiffness: 420, damping: 18 }}
            className="flex flex-col items-center"
          >
            <span className="relative">
              <span aria-hidden className="absolute -inset-2 animate-pulse rounded-2xl bg-leaf-400/30 blur-md" />
              <Image
                src="/icons/icon-192.png"
                alt="Ícone da EcoHorta na tela inicial"
                width={192}
                height={192}
                className="relative size-11 rounded-[13px] shadow-lg ring-1 ring-white/20"
              />
            </span>
            <span className="mt-1 text-[0.5rem] font-medium text-white/90">EcoHorta</span>
          </motion.div>

          {VIZINHOS.map((cor, index) => (
            <div key={index} className="flex flex-col items-center">
              <span className={`size-11 rounded-[13px] ${cor}`} />
              <span className="mt-1 h-[0.4rem] w-7 rounded-full bg-white/15" />
            </div>
          ))}
        </div>

        {/* Dock */}
        <div className="mt-1 flex justify-center gap-3 rounded-[18px] bg-white/[0.06] px-3 py-2">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="size-8 rounded-[10px] bg-white/12" />
          ))}
        </div>
      </div>
    </div>
  );
}
