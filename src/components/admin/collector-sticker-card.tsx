"use client";

import { motion } from "motion/react";
import { Download, Droplets, Printer, QrCode, Ruler } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { STICKER, stickerSize } from "@/lib/collector/qr-sticker";

/**
 * Adesivo do captador na tela de administração.
 *
 * Esta é a ponte entre o cadastro e o jogo: enquanto o adesivo não estiver
 * colado no tubo, ninguém consegue validar aquele captador nem fazer missão
 * nele. Por isso o cartão não é só um botão de baixar — ele explica o que fazer
 * com o arquivo, e insiste no único detalhe que costuma dar errado na impressão.
 */
export function CollectorStickerCard({ code, location }: { code: string; location: string }) {
  const { widthMm, heightMm } = stickerSize();

  return (
    <Surface tone="leaf" className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-leaf-400/20 text-leaf-300">
          <QrCode className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-display font-semibold text-mist-50">Adesivo do captador</p>
          <p className="mt-0.5 text-sm leading-relaxed text-mist-300">
            Sem ele colado no tubo, ninguém valida este captador nem faz missão nele.
          </p>
        </div>
      </div>

      <ol className="space-y-2.5">
        {[
          { icon: Download, texto: "Baixe o PDF e leve à gráfica — as instruções vão impressas nele." },
          { icon: Droplets, texto: "Peça adesivo VINIL com laminação: o tubo molha, e papel comum apaga o QR." },
          { icon: Printer, texto: "Tamanho real (100%). Nunca em “ajustar à página”." },
          { icon: Ruler, texto: `Confira com uma régua: o QR precisa medir ${STICKER.qrMm / 10} cm de lado.` },
        ].map(({ icon: Icon, texto }, index) => (
          <li key={index} className="flex gap-3 text-sm text-mist-300">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.07] text-leaf-300">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="pt-0.5">{texto}</span>
          </li>
        ))}
      </ol>

      <motion.a
        href={`/api/admin/collectors/${encodeURIComponent(code)}/sticker`}
        download={`adesivo-${code}.pdf`}
        whileTap={{ scale: 0.97 }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-leaf-400 font-semibold text-abyss-950"
      >
        <Download className="size-5" aria-hidden />
        Baixar PDF do adesivo
      </motion.a>

      <p className="text-xs leading-relaxed text-mist-400">
        Adesivo de {widthMm} × {heightMm} mm, com marcas de corte. O arquivo traz “{code} · {location}” fora da área
        colável, para não trocar os tubos na hora de colar.
      </p>
    </Surface>
  );
}

/** Botão compacto, para a lista de captadores. */
export function StickerLink({ code }: { code: string }) {
  return (
    <a
      href={`/api/admin/collectors/${encodeURIComponent(code)}/sticker`}
      download={`adesivo-${code}.pdf`}
      className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-control bg-white/[0.07] text-xs font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
    >
      <QrCode className="size-4" aria-hidden /> Adesivo
    </a>
  );
}
