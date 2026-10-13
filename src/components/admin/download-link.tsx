"use client";

import { motion } from "motion/react";
import { Download } from "lucide-react";
import { useState } from "react";

/*
 * BAIXAR UM ARQUIVO E SABER QUE BAIXOU.
 *
 * O arquivo vai para a pasta Downloads do aparelho — no celular e no Windows —
 * porque é de lá que a pessoa anexa num e-mail, abre no computador ou leva até
 * a gráfica. Isso o navegador já fazia.
 *
 * O que não existia era o AVISO. Numa tela de celular, tocar e nada mudar é
 * indistinguível de um botão quebrado: o arquivo desceu, a pessoa não viu, e
 * concluiu que a plataforma falhou. Então o botão diz o que aconteceu e onde
 * procurar, e deixa ao lado a saída de quem só queria conferir na tela.
 *
 * `download` com o arquivo na mesma origem é o que garante a pasta padrão em
 * vez de abrir no visualizador. Sem `target`, de propósito: dentro do aplicativo
 * instalado, uma aba nova para um anexo às vezes abre em branco e fecha sozinha.
 */
export function DownloadLink({
  href,
  fileName,
  viewHref,
  label,
  tone = "neutral",
}: {
  href: string;
  fileName: string;
  /** Mesmo arquivo, servido para o navegador mostrar em vez de baixar. */
  viewHref?: string;
  label: string;
  tone?: "leaf" | "neutral";
}) {
  const [baixou, setBaixou] = useState(false);

  return (
    <div className="space-y-2">
      <motion.a
        href={href}
        download={fileName}
        onClick={() => setBaixou(true)}
        whileTap={{ scale: 0.97 }}
        className={
          tone === "leaf"
            ? "flex h-12 w-full items-center justify-center gap-2 rounded-control bg-leaf-400 font-semibold text-abyss-950"
            : "flex h-11 w-full items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
        }
      >
        <Download className={tone === "leaf" ? "size-5" : "size-4"} aria-hidden />
        {label}
      </motion.a>

      {baixou ? (
        <p role="status" className="rounded-xl bg-leaf-400/10 px-3 py-2 text-xs leading-relaxed text-leaf-300">
          <span className="font-semibold">{fileName}</span> foi para a pasta <span className="font-semibold">Downloads</span> do
          aparelho. No celular, procure em Downloads ou na notificação do navegador.
        </p>
      ) : (
        <p className="text-center text-[0.7rem] leading-relaxed text-mist-500">
          Vai para a pasta Downloads do aparelho.
          {viewHref && (
            <>
              {" "}
              <a href={viewHref} target="_blank" rel="noreferrer" className="font-semibold text-mist-300 underline underline-offset-2">
                Ver na tela
              </a>{" "}
              sem baixar.
            </>
          )}
        </p>
      )}
    </div>
  );
}
