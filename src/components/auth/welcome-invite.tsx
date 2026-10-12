"use client";

import { motion } from "motion/react";
import { ArrowRight, Droplets } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { EcoHortaLogo } from "@/components/brand/ecohorta-logo";
import { Button } from "@/components/ui/button";
import { CollectorInflowScene } from "./collector-inflow-scene";
import { useNow } from "@/hooks/use-now";


/*
 * O CARTÃO DE VISITA DA ECOHORTA.
 *
 * Esta é a primeira coisa que alguém vê: um estudante que ouviu falar no
 * intervalo, um professor de outra escola, um jurado abrindo o link. Em dez
 * segundos ela precisa responder três perguntas — o que é, por que importa, o
 * que eu faço — e dar vontade de tocar em "Começar".
 *
 * A imagem principal é desenhada e animada: o ar-condicionado pinga, a água
 * desce pela mangueira, o tubo enche e a torneira devolve para o regador. Numa
 * fotografia do captador real a água fica escondida dentro do tubo opaco — e é
 * justamente a água que precisa aparecer. Abaixo dela, as fotos da escola: a
 * cena explica o ciclo, as fotos provam que ele acontece.
 *
 * Nenhum rosto aparece em lugar nenhum desta tela. As fotos mostram mãos, água,
 * balde e canteiro. A página é pública, os estudantes são menores de idade, e a
 * política que publicamos diz que imagem de menor depende de autorização do
 * responsável — a tela de abertura obedece à própria política.
 *
 * As três palavras do ciclo não foram inventadas aqui: CAPTAR, REUTILIZAR e
 * TRANSFORMAR estão impressas no tubo, e o slogan também. A tela obedece ao
 * captador.
 *
 * E nenhum número aparece. Seria fácil escrever "12.480 litros reaproveitados"
 * numa tela de apresentação, e seria mentira enquanto a primeira escola ainda
 * monta o captador. Quando houver litros medidos, eles entram aqui — medidos.
 */

/*
 * O captador de demonstração: enche devagar, libera e recomeça.
 *
 * Não é dado de escola nenhuma — é a mesma animação que o app usa para mostrar
 * nível real, aqui rodando num ciclo. Por isso nenhum litro aparece em número
 * absoluto: só a porcentagem do tubo, que é evidentemente ilustrativa.
 */
const CICLO_MS = 17_000;
const ENCHENDO_ATE = 0.76;
const LIBERANDO_ATE = 0.9;

export function demoLevel(agoraMs: number): { ratio: number; dispensing: boolean } {
  const f = (agoraMs % CICLO_MS) / CICLO_MS;
  if (f < ENCHENDO_ATE) return { ratio: 0.08 + (f / ENCHENDO_ATE) * 0.8, dispensing: false };
  if (f < LIBERANDO_ATE) {
    const g = (f - ENCHENDO_ATE) / (LIBERANDO_ATE - ENCHENDO_ATE);
    return { ratio: 0.88 - g * 0.8, dispensing: true };
  }
  return { ratio: 0.08, dispensing: false };
}

/** O ciclo, nas palavras do próprio tubo, com a foto de cada etapa. Sem rostos. */
const CICLO = [
  {
    word: "Captar",
    photo: "/fotos/captar.jpg",
    text: "do ar-condicionado",
    alt: "Água saindo da torneira do captador para dentro de um balde",
  },
  {
    word: "Reutilizar",
    photo: "/fotos/reutilizar.jpg",
    text: "no canteiro da escola",
    alt: "Água do balde sendo despejada sobre as plantas de um canteiro",
  },
  {
    word: "Transformar",
    photo: "/fotos/transformar.jpg",
    text: "em horta que cresce",
    alt: "Regador molhando bandejas de mudas no pátio da escola",
  },
] as const;

export function WelcomeInvite({ onStart }: { onStart: () => void }) {
  // Passo de 400 ms: a mola interna do tanque alisa o resto. `useNow` vem de
  // useSyncExternalStore, então nada disso roda no servidor nem redesenha à toa.
  const agora = useNow(400);
  const demo = demoLevel(agora ?? 0);

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col overflow-hidden px-5 pb-safe pt-safe">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="flex flex-1 flex-col justify-center py-7"
      >
        {/* A marca abre a tela: é a mesma que está na caixa do captador. */}
        <EcoHortaLogo />

        <h1 className="mt-2 font-display text-[2.4rem] font-bold leading-[1.05] tracking-tight text-mist-50 min-[380px]:text-[2.6rem]">
          Cada gota
          <br />
          vira ação.
        </h1>

        <p className="mt-3.5 text-[1.02rem] leading-relaxed text-mist-300">
          O ar-condicionado da sua escola joga água fora todo dia. A EcoHorta capta, mede e transforma em missão.
        </p>

        {/* De onde a água vem e para onde ela vai, em movimento. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 190, damping: 24 }}
          className="relative mt-4"
        >
          <div aria-hidden className="absolute inset-x-10 top-20 -z-10 h-44 rounded-full bg-leaf-400/16 blur-[60px]" />
          <div className="origin-top scale-[0.92] min-[380px]:scale-100">
            <CollectorInflowScene ratio={demo.ratio} dispensing={demo.dispensing} />
          </div>
        </motion.div>

        {/* O ciclo impresso no tubo, cada palavra com a sua foto. */}
        <ul className="mt-6 grid grid-cols-3 gap-2.5">
          {CICLO.map((etapa, index) => (
            <motion.li
              key={etapa.word}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34 + index * 0.09 }}
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
              <p className="mt-2 text-[0.78rem] font-bold uppercase tracking-wide text-leaf-300">{etapa.word}</p>
              <p className="mt-0.5 text-[0.68rem] leading-tight text-mist-400">{etapa.text}</p>
            </motion.li>
          ))}
        </ul>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="pb-6">
        {/* A chamada. Curta, no imperativo, e a única frase da tela que pede algo. */}
        <p className="mb-3 text-center font-display text-[1.15rem] font-bold leading-snug text-mist-50">
          Venha fazer parte.
        </p>
        <p className="mb-4 text-center text-[0.88rem] leading-relaxed text-mist-300">
          Cada litro que você reaproveita é água que deixa de ser desperdiçada —
          <span className="text-leaf-300"> e a sua parte num mundo melhor.</span>
        </p>

        <Button size="lg" variant="leaf" className="w-full" onClick={onStart} icon={<Droplets className="size-5" aria-hidden />}>
          Começar
          <ArrowRight className="size-5" aria-hidden />
        </Button>

        <p className="mt-5 text-center text-[0.7rem] leading-relaxed text-mist-500">
          EE Prof.ª Clarinda Mendes de Aquino ·{" "}
          <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
            Privacidade
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
