"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Droplets } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/*
 * O CARTÃO DE VISITA DA ECOHORTA.
 *
 * Esta é a primeira coisa que alguém vê: um estudante que ouviu falar no
 * intervalo, um professor de outra escola, um jurado abrindo o link. Em dez
 * segundos ela precisa responder três perguntas — o que é, por que importa, o
 * que eu faço — e dar vontade de tocar em "Começar".
 *
 * As fotos são da EE Prof.ª Clarinda Mendes de Aquino: os estudantes levantando
 * o tubo na parede, a água saindo da torneira, o canteiro sendo regado. Nada de
 * banco de imagens — seria vender uma horta que não é a nossa. Ao lado delas, o
 * render do protótipo: a ideia e a parede da escola na mesma tela, que é
 * exatamente o que este projeto é.
 *
 * As três palavras — CAPTAR, REUTILIZAR, TRANSFORMAR — não foram inventadas
 * aqui: estão impressas no próprio captador. A tela obedece ao tubo.
 *
 * Nenhum número aparece. Seria fácil escrever "12.480 litros reaproveitados"
 * numa tela de apresentação, e seria mentira enquanto a primeira escola ainda
 * monta o captador. O projeto inteiro se sustenta na regra de que o que está na
 * tela aconteceu de verdade; a abertura é o pior lugar para abrir exceção.
 * Quando houver litros medidos, eles entram aqui — medidos.
 */

/** O ciclo, nas palavras do próprio tubo, com a foto de cada etapa. */
const CICLO = [
  {
    word: "Captar",
    photo: "/fotos/captar.jpg",
    text: "a água do ar-condicionado",
    alt: "Estudante enchendo um balde na torneira do captador",
  },
  {
    word: "Reutilizar",
    photo: "/fotos/reutilizar.jpg",
    text: "no canteiro da escola",
    alt: "Água do balde sendo despejada em um canteiro",
  },
  {
    word: "Transformar",
    photo: "/fotos/transformar.jpg",
    text: "em horta que cresce",
    alt: "Estudante regando bandejas de mudas no pátio",
  },
] as const;

export function WelcomeInvite({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion();

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col overflow-hidden px-5 pb-safe pt-safe">
      {/* Gotas caindo ao fundo: o condensado que o projeto recolhe. */}
      {!reduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {DROPS.map((drop, index) => (
            <motion.span
              key={index}
              className="absolute block size-1 rounded-full bg-aqua-300/40"
              style={{ left: drop.left }}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: ["-5%", "105%"], opacity: [0, 0.7, 0] }}
              transition={{ duration: drop.duration, delay: drop.delay, repeat: Infinity, ease: "easeIn" }}
            />
          ))}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="flex flex-1 flex-col justify-center py-7"
      >
        <p className="eyebrow text-leaf-300">EcoHorta Inteligente</p>

        <h1 className="mt-2 font-display text-[2.4rem] font-bold leading-[1.05] tracking-tight text-mist-50 min-[380px]:text-[2.6rem]">
          Cada gota
          <br />
          vira ação.
        </h1>

        <p className="mt-3.5 text-[1.02rem] leading-relaxed text-mist-300">
          O ar-condicionado da sua escola joga água fora todo dia. A EcoHorta capta, mede e transforma em missão.
        </p>

        {/*
          A ideia e a parede, lado a lado. O render é alto e estreito, então fica
          na coluna estreita; ao lado, a escola de verdade levantando o tubo.
        */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 200, damping: 26 }}
          className="relative mt-6 grid grid-cols-5 gap-2.5"
        >
          <div aria-hidden className="absolute -inset-4 -z-10 rounded-[40px] bg-leaf-400/10 blur-3xl" />

          <figure className="col-span-2 overflow-hidden rounded-3xl shadow-[0_24px_60px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10">
            <Image
              src="/fotos/prototipo.jpg"
              alt="Protótipo do captador EcoHorta, com os QR Codes e a caixa eletrônica"
              width={420}
              height={1420}
              priority
              sizes="(max-width: 448px) 40vw, 180px"
              className="h-[278px] w-full object-cover object-top"
            />
          </figure>

          <figure className="relative col-span-3 overflow-hidden rounded-3xl shadow-[0_24px_60px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10">
            <Image
              src="/fotos/instalacao.jpg"
              alt="Estudantes instalando o captador na parede da escola"
              width={1000}
              height={1250}
              priority
              sizes="(max-width: 448px) 60vw, 270px"
              className="h-[278px] w-full object-cover"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-abyss-950/95 via-abyss-950/70 to-transparent px-3.5 pb-3 pt-10">
              <p className="font-display text-[0.82rem] font-semibold leading-snug text-mist-50">
                Água de hoje,
                <br />
                um futuro mais verde.
              </p>
              <p className="mt-1 text-[0.65rem] leading-tight text-mist-400">Montado pelos estudantes da escola</p>
            </figcaption>
          </figure>
        </motion.div>

        {/* O ciclo impresso no tubo, cada palavra com a sua foto. */}
        <ul className="mt-5 grid grid-cols-3 gap-2.5">
          {CICLO.map((etapa, index) => (
            <motion.li
              key={etapa.word}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.09 }}
            >
              <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
                <Image
                  src={etapa.photo}
                  alt={etapa.alt}
                  width={600}
                  height={600}
                  sizes="(max-width: 448px) 31vw, 130px"
                  className="aspect-square w-full object-cover"
                />
              </div>
              <p className="mt-2 text-[0.8rem] font-bold uppercase tracking-wide text-leaf-300">{etapa.word}</p>
              <p className="mt-0.5 text-[0.68rem] leading-tight text-mist-400">{etapa.text}</p>
            </motion.li>
          ))}
        </ul>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="pb-6">
        <Button size="lg" variant="leaf" className="w-full" onClick={onStart} icon={<Droplets className="size-5" aria-hidden />}>
          Começar
          <ArrowRight className="size-5" aria-hidden />
        </Button>

        <p className="mt-4 text-center text-xs leading-relaxed text-mist-500">
          Projeto da EE Prof.ª Clarinda Mendes de Aquino ·{" "}
          <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
            Privacidade
          </Link>
        </p>
      </motion.div>
    </main>
  );
}

/** Posições e tempos fixos: gota que sorteia posição pisca a cada renderização. */
const DROPS = [
  { left: "12%", duration: 7.5, delay: 0 },
  { left: "27%", duration: 9, delay: 1.8 },
  { left: "48%", duration: 8.2, delay: 3.4 },
  { left: "66%", duration: 10, delay: 0.9 },
  { left: "83%", duration: 8.8, delay: 2.6 },
  { left: "93%", duration: 9.6, delay: 4.2 },
] as const;
