"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bell, Check, Download, Share, Smartphone, WifiOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { EcoHortaLogo } from "@/components/brand/ecohorta-logo";
import { CollectorTank } from "@/components/collector/collector-tank";
import { Button } from "@/components/ui/button";
import {
  installGuide,
  installPath,
  detectPlatform,
  STAGE_LABEL,
  STAGE_LEVEL,
  type InstallStage,
} from "@/lib/install/platform";
import { HomeScreenPreview } from "./home-screen-preview";

/*
 * INSTALAR A ECOHORTA — a tela que leva o aplicativo para o bolso.
 *
 * O tubo enchendo é a espinha da tela, e ele NÃO é uma barra de download.
 * Instalar um PWA não tem porcentagem: o navegador busca o manifesto e os
 * ícones em milissegundos e acabou. Uma barrinha subindo de 0 a 100 seria
 * invenção — e este projeto não inventa número, é a mesma regra que proíbe
 * mostrar litro simulado como litro medido.
 *
 * Então cada nível do tubo corresponde a um EVENTO REAL do navegador:
 *
 *   8%   a página abriu e estamos vendo que aparelho é este
 *   36%  o navegador ofereceu a instalação (ou sabemos o caminho manual)
 *   72%  a janela nativa de instalação está aberta, esperando a pessoa
 *   100% `appinstalled` disparou, ou a pessoa confirmou que adicionou
 *
 * Quando enche, o tubo sai de cena e entra a tela inicial do celular com o
 * ícone aceso e o nome por baixo. Porque a pergunta que sobra depois de
 * instalar não é "deu certo?", é "onde está?" — e trinta ícones depois,
 * ninguém lembra o que procurar.
 */

interface PromptDeInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Ambiente {
  userAgent: string;
  standalone: boolean;
}

/*
 * O ambiente só existe no navegador, e é lido UMA vez.
 *
 * `useSyncExternalStore` em vez de efeito com setState: no servidor devolve
 * `null`, que é a etapa "verificando", e o primeiro quadro no cliente já traz o
 * valor certo — sem telas piscando entre um estado e outro.
 */
let cache: Ambiente | null = null;
const semMudancas = () => () => {};

function lerAmbiente(): Ambiente {
  cache ??= {
    userAgent: navigator.userAgent,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
  return cache;
}

/** Por que vale a pena instalar. Três motivos concretos, nenhum genérico. */
const MOTIVOS = [
  { icon: Smartphone, text: "Abre em tela cheia, sem a barra do navegador atrapalhando a missão." },
  { icon: WifiOff, text: "Continua abrindo com a internet fraca da escola: o essencial fica guardado no aparelho." },
  { icon: Bell, text: "O ícone na tela inicial lembra você quando um captador está quase cheio." },
] as const;

export function InstallScreen() {
  const ambiente = useSyncExternalStore<Ambiente | null>(semMudancas, lerAmbiente, () => null);
  const [prompt, setPrompt] = useState<PromptDeInstalacao | null>(null);
  const [abrindoJanela, setAbrindoJanela] = useState(false);
  const [instalouAgora, setInstalouAgora] = useState(false);
  const [recusou, setRecusou] = useState(false);

  useEffect(() => {
    const aoOferecer = (event: Event) => {
      // Sem isto o Chrome mostra a própria faixa de instalação por cima da tela.
      event.preventDefault();
      setPrompt(event as PromptDeInstalacao);
    };
    const aoInstalar = () => {
      setInstalouAgora(true);
      setAbrindoJanela(false);
    };
    window.addEventListener("beforeinstallprompt", aoOferecer);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoOferecer);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  const instalado = instalouAgora || (ambiente?.standalone ?? false);
  const caminho = ambiente
    ? installPath({ userAgent: ambiente.userAgent, standalone: instalado, promptAvailable: prompt !== null })
    : null;
  const plataforma = ambiente ? detectPlatform(ambiente.userAgent) : "unknown";
  const guia = caminho ? installGuide(caminho, plataforma) : null;

  // A etapa é DERIVADA do que realmente aconteceu — nunca de um contador.
  const etapa: InstallStage = ambiente === null ? "checking" : instalado ? "installed" : abrindoJanela ? "prompting" : "ready";

  const instalar = useCallback(async () => {
    if (!prompt) return;
    setRecusou(false);
    setAbrindoJanela(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        // Alguns navegadores não disparam `appinstalled`: a escolha já basta.
        setInstalouAgora(true);
      } else {
        setRecusou(true);
      }
    } catch {
      setRecusou(true);
    } finally {
      setAbrindoJanela(false);
      setPrompt(null);
    }
  }, [prompt]);

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-safe pt-safe">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-72 bg-linear-to-t from-leaf-900/30 to-transparent" />

      <header className="pt-6">
        <EcoHortaLogo />
      </header>

      <div className="flex flex-1 flex-col justify-center py-6">
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-mist-50">
          {instalado ? (
            <>
              Pronto.
              <br />
              <span className="text-leaf-300">Está no seu celular.</span>
            </>
          ) : (
            <>
              Leve a EcoHorta
              <br />
              <span className="text-leaf-300">no bolso.</span>
            </>
          )}
        </h1>
        <span aria-hidden className="mt-4 block h-1 w-12 rounded-full bg-leaf-400" />

        <p className="mt-4 text-[0.95rem] leading-relaxed text-mist-300">
          {instalado
            ? "O ícone já está na sua tela inicial. É por ele que você abre as missões — sem navegador, sem endereço para digitar."
            : "As missões acontecem no pátio, com o celular na mão. Instalado, o aplicativo abre em um toque."}
        </p>

        {/* O palco: o tubo enchendo dá lugar à tela inicial do celular. */}
        <div className="relative mt-7 flex min-h-[320px] items-center justify-center">
          <AnimatePresence mode="wait">
            {instalado ? (
              <motion.div
                key="pronto"
                initial={{ opacity: 0, scale: 0.9, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 24 }}
              >
                <HomeScreenPreview />
                <p className="mt-4 text-center text-[0.8rem] leading-relaxed text-mist-400">
                  Procure por este ícone, com o nome <span className="font-semibold text-mist-100">EcoHorta</span>.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="enchendo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.92, filter: "blur(6px)" }}
                transition={{ duration: 0.45 }}
                className="flex flex-col items-center"
              >
                <div className="h-[230px]">
                  <CollectorTank
                    ratio={STAGE_LEVEL[etapa]}
                    urgency="normal"
                    inflowActive={etapa !== "installed"}
                    dispensing={false}
                    overflowing={false}
                    showPercent
                  />
                </div>
                <p className="mt-3 text-center text-sm font-semibold text-leaf-300">{STAGE_LABEL[etapa]}</p>
                <p className="mt-1 max-w-[16rem] text-center text-[0.7rem] leading-relaxed text-mist-500">
                  O tubo marca as etapas reais da instalação — não um download fingido.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* A ação muda conforme o aparelho e o navegador. */}
        <div className="mt-6">
          {instalado ? (
            <>
              <Link
                href="/"
                className="flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-linear-to-b from-leaf-300 to-leaf-500 text-base font-semibold text-abyss-950"
              >
                Abrir a EcoHorta
                <ArrowRight className="size-5" aria-hidden />
              </Link>
              <p className="mt-3 text-center text-[0.75rem] leading-relaxed text-mist-500">
                Da próxima vez, abra pelo ícone: o aplicativo começa em tela cheia, e as boas-vindas aparecem uma vez.
              </p>
            </>
          ) : (
            guia && (
              <div className="rounded-[28px] bg-white/[0.04] p-5 ring-1 ring-inset ring-white/10">
                <p className="flex items-center gap-2 font-display text-base font-semibold text-mist-50">
                  {caminho === "ios-share" && <Share className="size-4 text-leaf-300" aria-hidden />}
                  {guia.title}
                </p>

                <ol className="mt-3 space-y-2.5">
                  {guia.steps.map((passo, index) => (
                    <li key={passo} className="flex gap-2.5 text-[0.85rem] leading-relaxed text-mist-300">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-leaf-400/15 text-[0.65rem] font-bold text-leaf-300">
                        {index + 1}
                      </span>
                      {passo}
                    </li>
                  ))}
                </ol>

                {guia.note && (
                  <p className="mt-3 rounded-2xl bg-sun-400/10 px-3 py-2.5 text-[0.75rem] leading-relaxed text-sun-300">
                    {guia.note}
                  </p>
                )}

                {caminho === "prompt" && (
                  <Button
                    size="lg"
                    variant="leaf"
                    className="mt-4 w-full"
                    onClick={() => void instalar()}
                    disabled={abrindoJanela}
                    icon={<Download className="size-5" aria-hidden />}
                  >
                    {abrindoJanela ? "Abrindo…" : "Instalar agora"}
                  </Button>
                )}

                {recusou && (
                  <p className="mt-3 text-center text-[0.78rem] leading-relaxed text-mist-400">
                    Sem problema — dá para instalar depois, voltando a esta página.
                  </p>
                )}

                {/*
                  No iPhone não existe evento de "instalou": o Safari não avisa
                  ninguém. Quem sabe que terminou é a pessoa, então é ela que diz.
                */}
                {caminho === "ios-share" && (
                  <Button
                    size="md"
                    variant="secondary"
                    className="mt-4 w-full"
                    onClick={() => setInstalouAgora(true)}
                    icon={<Check className="size-4" aria-hidden />}
                  >
                    Já adicionei à tela inicial
                  </Button>
                )}
              </div>
            )
          )}
        </div>

        {!instalado && (
          <ul className="mt-6 space-y-2.5">
            {MOTIVOS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-[0.8rem] leading-relaxed text-mist-400">
                <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-leaf-400/10 text-leaf-300">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="pb-6 text-center text-[0.7rem] leading-relaxed text-mist-500">
        EE Prof.ª Clarinda Mendes de Aquino ·{" "}
        <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
          Privacidade
        </Link>
      </footer>
    </main>
  );
}
