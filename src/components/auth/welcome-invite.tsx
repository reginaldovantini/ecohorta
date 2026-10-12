"use client";

import { motion } from "motion/react";
import { ArrowRight, Droplets, Gauge, Sprout, Target, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { EcoHortaLogo } from "@/components/brand/ecohorta-logo";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { CollectorInflowScene } from "./collector-inflow-scene";

/*
 * O CARTÃO DE VISITA DA ECOHORTA.
 *
 * Esta é a primeira coisa que alguém vê: um estudante que ouviu falar no
 * intervalo, um professor de outra escola, um jurado abrindo o link. Em dez
 * segundos ela precisa responder três perguntas — o que é, por que importa, o
 * que eu faço — e dar vontade de tocar em "Começar".
 *
 * A peça central é animada, e não fotografada: numa foto do captador real a
 * água fica escondida dentro do tubo opaco, e é justamente a água que precisa
 * aparecer. Em volta dela, as fotos da escola provam que o ciclo acontece —
 * a cena explica, as fotos testemunham.
 *
 * Nenhum rosto aparece. A página é pública, os estudantes são menores de idade
 * e a política que publicamos diz que imagem de menor depende de autorização do
 * responsável: a tela de abertura obedece à própria política.
 *
 * E nenhum número aparece. Seria fácil escrever "12.480 litros reaproveitados"
 * numa tela de apresentação, e seria mentira enquanto a primeira escola ainda
 * monta o captador. Quando houver litros medidos, eles entram aqui — medidos.
 */

/*
 * O captador de demonstração: enche devagar, libera e recomeça.
 *
 * Não é dado de escola nenhuma — é a mesma animação que o app usa para mostrar
 * nível real, aqui rodando em ciclo. Por isso nenhum litro aparece em número
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

/*
 * As três garantias do projeto, debaixo de um ícone cada.
 *
 * Elas falam da AÇÃO de quem usa o aplicativo, não de uma horta que se rega
 * sozinha: a EcoHorta não irriga nada automaticamente — ela mede a água, abre a
 * torneira quando um estudante está na frente do captador, e confirma a missão
 * pelo volume que saiu. Sem estudante, nada acontece.
 */
const IMPACTOS = [
  { icon: Gauge, linha1: "Medido", linha2: "por sensor" },
  { icon: Target, linha1: "Vira", linha2: "missão real" },
  { icon: Users, linha1: "Impacto", linha2: "coletivo" },
] as const;

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
    text: "em horta cuidada",
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
      <FolhasDeFundo />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="flex flex-1 flex-col justify-center py-6"
      >
        <EcoHortaLogo />

        <h1 className="mt-7 font-display text-[2.4rem] font-bold leading-[1.05] tracking-tight text-mist-50 min-[380px]:text-[2.6rem]">
          Cada gota
          <br />
          <span className="text-leaf-300">vira ação.</span>
        </h1>
        <span aria-hidden className="mt-4 block h-1 w-12 rounded-full bg-leaf-400" />

        <p className="mt-4 text-[0.98rem] leading-relaxed text-mist-300">
          O ar-condicionado da sua escola joga água fora todos os dias. A EcoHorta capta essa água, mede quanto tem e
          transforma em missões reais para você cumprir.
        </p>

        {/* Três selos: o porquê do projeto, antes do como. */}
        <ul className="mt-6 grid grid-cols-3 gap-2">
          {IMPACTOS.map(({ icon: Icon, linha1, linha2 }, index) => (
            <motion.li
              key={linha2}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.08 }}
              className="flex flex-col items-center text-center"
            >
              <span className="grid size-14 place-items-center rounded-full bg-leaf-400/10 text-leaf-300 ring-1 ring-inset ring-leaf-400/25">
                <Icon className="size-6" aria-hidden />
              </span>
              <p className="mt-2 text-[0.64rem] font-bold uppercase leading-tight tracking-wide text-mist-200">
                {linha1}
                <br />
                {linha2}
              </p>
            </motion.li>
          ))}
        </ul>

        {/* De onde a água vem e para onde ela vai, em movimento. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 190, damping: 24 }}
          className="relative mt-2"
        >
          <div aria-hidden className="absolute inset-x-10 top-20 -z-10 h-44 rounded-full bg-leaf-400/16 blur-[60px]" />
          <div className="origin-top scale-[0.92] min-[380px]:scale-100">
            <CollectorInflowScene ratio={demo.ratio} dispensing={demo.dispensing} />
          </div>
        </motion.div>

        {/* O ciclo impresso no tubo, numerado, com a foto de cada etapa. */}
        <ul className="mt-1 grid grid-cols-3 gap-2">
          {CICLO.map((etapa, index) => (
            <motion.li
              key={etapa.word}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34 + index * 0.09 }}
              className="relative overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-inset ring-white/10"
            >
              <Image
                src={etapa.photo}
                alt={etapa.alt}
                width={600}
                height={600}
                sizes="(max-width: 448px) 31vw, 130px"
                className="aspect-square w-full object-cover"
              />
              {/* O número sobe para a foto: assim a palavra tem a coluna inteira. */}
              <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-leaf-400 text-[0.62rem] font-bold text-abyss-950 shadow">
                {index + 1}
              </span>
              <div className="px-2 pb-2.5 pt-2">
                <p className="text-[0.7rem] font-bold uppercase leading-none tracking-wide text-leaf-300">{etapa.word}</p>
                <p className="mt-1 text-[0.65rem] leading-tight text-mist-400">{etapa.text}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      </motion.div>

      {/* Painel de chamada: a única parte da tela que pede algo. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="pb-6">
        <div className="rounded-[28px] bg-linear-to-b from-leaf-500/15 to-leaf-600/5 p-5 ring-1 ring-inset ring-leaf-400/20">
          <p className="text-center font-display text-[1.3rem] font-bold leading-snug text-mist-50">
            Venha fazer <span className="text-leaf-300">parte.</span>
          </p>
          <p className="mt-2 text-center text-[0.85rem] leading-relaxed text-mist-300">
            Cada litro que você reaproveita é água que deixa de ser desperdiçada — e a sua parte num{" "}
            <span className="font-semibold text-leaf-300">mundo melhor</span>.
          </p>

          <Button size="lg" variant="leaf" className="mt-5 w-full" onClick={onStart} icon={<Droplets className="size-5" aria-hidden />}>
            Começar
            <ArrowRight className="size-5" aria-hidden />
          </Button>
        </div>

        {/*
          A porta da rede. Quem chega aqui pode ser de outra escola — e sem este
          convite não teria por onde começar, já que entrar no jogo exige um
          captador que alguém precisa construir antes.
        */}
        <Link
          href="/parceria"
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-control bg-white/[0.05] text-sm font-semibold text-mist-100 ring-1 ring-inset ring-leaf-400/25"
        >
          <Sprout className="size-4 text-leaf-300" aria-hidden />
          Quero um captador na minha escola
        </Link>

        <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-mist-500">
          EE Prof.ª Clarinda Mendes de Aquino ·{" "}
          <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
            Privacidade
          </Link>
        </p>
      </motion.div>
    </main>
  );
}

/*
 * Folhas em marca d'água.
 *
 * A EcoHorta é uma horta antes de ser um aplicativo, e a tela precisa lembrar
 * disso sem competir com o conteúdo. Daí a opacidade baixa e as posições nos
 * cantos: elas emolduram, não disputam.
 */
function FolhasDeFundo() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <svg viewBox="0 0 100 100" className="absolute -right-10 top-6 size-44 text-leaf-500/[0.07]" fill="currentColor">
        <path d="M50 4 C 86 24, 98 56, 86 92 C 44 82, 24 48, 50 4 Z" />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute -left-12 top-1/3 size-40 rotate-[150deg] text-leaf-500/[0.06]" fill="currentColor">
        <path d="M50 4 C 86 24, 98 56, 86 92 C 44 82, 24 48, 50 4 Z" />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute -right-8 bottom-24 size-36 rotate-[200deg] text-leaf-500/[0.07]" fill="currentColor">
        <path d="M50 4 C 86 24, 98 56, 86 92 C 44 82, 24 48, 50 4 Z" />
      </svg>
      {/* Brilho de horta ao fundo, para o preto não ficar chapado. */}
      <div className="absolute inset-x-0 bottom-0 h-72 bg-linear-to-t from-leaf-900/35 to-transparent" />
    </div>
  );
}
