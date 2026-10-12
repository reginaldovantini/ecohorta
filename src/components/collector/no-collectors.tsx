"use client";

import { motion } from "motion/react";
import { QrCode, ScanLine, School } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";

/*
 * QUANDO NÃO HÁ CAPTADOR PARA MOSTRAR.
 *
 * Antes isto era um esqueleto de carregamento que nunca saía: quem acabava de
 * entrar pelo Google via três retângulos cinzas pulsando para sempre, e não
 * tinha como adivinhar que faltava ler um QR Code. Esqueleto é para quem está
 * esperando resposta; aqui a resposta já veio, e ela é "ainda não há nada".
 *
 * São duas situações diferentes, e dizer a errada é pior do que não dizer nada:
 *
 *   sem escola        a pessoa entrou e ainda não pertence a lugar nenhum. A
 *                     leitura do QR colado num captador é o que a coloca numa
 *                     escola — não existe outro caminho, de propósito: é o que
 *                     prova que ela esteve lá fisicamente.
 *
 *   escola sem tubo   a escola existe, mas ninguém cadastrou captador ainda.
 *                     Aqui não há nada que a pessoa possa fazer sozinha, e
 *                     fingir que há seria cruel.
 */
export function NoCollectors() {
  const { schoolName } = useProfile();
  const semEscola = !schoolName;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-10">
      <Surface tone="leaf" className="space-y-5 p-6 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-leaf-400/15 text-leaf-300">
          {semEscola ? <QrCode className="size-8" aria-hidden /> : <School className="size-8" aria-hidden />}
        </span>

        <div className="space-y-2">
          <h2 className="font-display text-xl font-bold leading-snug text-mist-50">
            {semEscola ? "Leia o QR do captador" : "Nenhum captador por aqui ainda"}
          </h2>
          <p className="text-sm leading-relaxed text-mist-300">
            {semEscola ? (
              <>
                Procure o adesivo colado no tubo verde da sua escola e aponte a câmera do celular. É a leitura que coloca
                você na escola e libera as missões.
              </>
            ) : (
              <>
                A escola <span className="font-semibold text-mist-100">{schoolName}</span> ainda não tem captador
                cadastrado. Assim que a equipe cadastrar o primeiro, as missões aparecem aqui.
              </>
            )}
          </p>
        </div>

        {semEscola && (
          <div className="space-y-2.5 rounded-2xl bg-abyss-950/40 p-4 text-left">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-leaf-300">
              <ScanLine className="size-4" aria-hidden />
              Como fazer
            </p>
            <ol className="space-y-1.5 text-[0.82rem] leading-relaxed text-mist-300">
              <li>1. Vá até o captador instalado na sua escola.</li>
              <li>2. Abra a câmera do celular e aponte para o QR Code do adesivo.</li>
              <li>3. Toque no aviso que aparece — e pronto.</li>
            </ol>
          </div>
        )}

        <p className="text-xs leading-relaxed text-mist-400">
          A leitura é o que garante que a água só é liberada por quem está na frente do tubo.
        </p>
      </Surface>
    </motion.div>
  );
}

/**
 * Já sabemos que não há captador? Só depois que a API respondeu.
 * Antes disso ainda é carregamento de verdade, e o esqueleto é honesto.
 */
export const semCaptadores = (connection: "connecting" | "online" | "error", total: number) =>
  connection === "online" && total === 0;
