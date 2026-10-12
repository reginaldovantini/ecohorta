import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/*
 * A MARCA DA ECOHORTA — gota e folha, lado a lado.
 *
 * A gota vem do ícone do aplicativo: mesma silhueta, mesmo azul, mesmo brilho.
 * A folha vem do captador. Juntas dizem a tese do projeto numa imagem só —
 * água que vira horta — e é por isso que nenhuma das duas aparece sozinha.
 *
 * Desenhada em vetor, e não colada como imagem, por um motivo prático: o
 * arquivo que existe do logotipo tem 152 × 216 px, o que basta para um selo de
 * 50 px e borra em qualquer coisa maior. Em vetor ela fica nítida do favicon de
 * 16 px à projeção da banca, sem precisar de três arquivos.
 */

export function EcoHortaMark({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = { gota: `g${uid}`, folha: `f${uid}`, brilho: `b${uid}` };

  return (
    <svg viewBox="0 0 136 116" className={className} aria-hidden>
      <defs>
        <linearGradient id={id.gota} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#9be6fa" />
          <stop offset="0.55" stopColor="#2ec5f0" />
          <stop offset="1" stopColor="#0a82bd" />
        </linearGradient>
        <linearGradient id={id.folha} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#6ee88c" />
          <stop offset="1" stopColor="#2b8a3e" />
        </linearGradient>
      </defs>

      {/* Folha, atrás e à direita. */}
      <g transform="translate(66 106) scale(1.12)" fill={`url(#${id.folha})`}>
        <path d="M0 0 C 30 -14, 48 -46, 36 -92 C 8 -68, -8 -32, 0 0 Z" />
        <path d="M3 -6 C 14 -34, 26 -62, 34 -85" stroke="#ffffff" strokeOpacity="0.82" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* Nervuras laterais, discretas. */}
        <g stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2.6" fill="none" strokeLinecap="round">
          <path d="M9 -22 C 16 -26, 22 -32, 26 -38" />
          <path d="M17 -44 C 23 -48, 28 -54, 31 -60" />
        </g>
      </g>

      {/* Gota, à frente e à esquerda — a mesma silhueta do ícone. */}
      <path
        d="M36 10 C 36 10, 6 54, 6 74 A 30 30 0 0 0 66 74 C 66 54, 36 10, 36 10 Z"
        fill={`url(#${id.gota})`}
      />
      <path
        d="M19 64 C 15 73, 14 80, 16 87"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Assinatura da marca, como está impressa no captador. */
export const ECOHORTA_SLOGAN = ["Água inteligente", "para um futuro sustentável"] as const;

/** Marca completa: símbolo, nome e assinatura. */
export function EcoHortaLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <EcoHortaMark className="h-14 w-auto shrink-0 drop-shadow-[0_3px_14px_rgb(46_197_240/0.3)]" />
      <div className="min-w-0">
        <p className="font-display text-[1.7rem] font-bold leading-none tracking-tight text-mist-50">
          Eco<span className="text-leaf-300">Horta</span>
        </p>
        <p className="mt-1.5 text-[0.58rem] font-semibold uppercase leading-[1.5] tracking-[0.14em] text-mist-400">
          {ECOHORTA_SLOGAN[0]}
          <br />
          {ECOHORTA_SLOGAN[1]}
        </p>
      </div>
    </div>
  );
}
