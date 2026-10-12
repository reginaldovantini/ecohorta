import { cn } from "@/lib/utils/cn";

/*
 * A MARCA DA ECOHORTA — a mesma que está na caixa eletrônica do captador.
 *
 * Três folhas num ramo, cada uma nascendo de um ponto diferente do talo, com a
 * nervura central clara. A primeira versão que desenhei era uma folha só,
 * dividida ao meio, e estava errada: é o ramo que identifica a marca.
 *
 * Desenhada em vetor, e não colada como imagem, por um motivo prático: o
 * arquivo que existe do logotipo tem 152 × 216 px, o que basta para um selo de
 * 50 px e borra em qualquer coisa maior. Em vetor ela fica nítida do favicon de
 * 16 px à projeção da banca, sem precisar de três arquivos.
 *
 * Esta é a versão para FUNDO ESCURO: o verde abre um tom para não sumir, e o
 * nome fica claro. No impresso, sobre branco, valem o verde-escuro original e o
 * nome em verde — é a mesma marca, vestida para o lugar onde aparece.
 */

/** Uma folha: base e ponta afinadas, barriga à direita, nervura por dentro. */
const FOLHA = "M0 0 C 28 -12, 33 -34, 14 -58 C -4 -40, -9 -18, 0 0 Z";
const NERVURA = "M2 -5 C 8 -23, 12 -41, 13 -53";

/** Posição de cada folha ao longo do talo: é o que abre os vãos entre elas. */
const RAMO = [
  { x: 4, y: -34, giro: 26, escala: 3.3 },
  { x: 1, y: -8, giro: -32, escala: 2.5 },
  { x: -3, y: 10, giro: -72, escala: 1.95 },
] as const;

interface LeafProps {
  className?: string;
  /** Verde das folhas. O padrão é o tom para fundo escuro. */
  tone?: string;
}

export function EcoHortaLeaf({ className, tone = "#2f9e44" }: LeafProps) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <g transform="translate(240 372)" fill={tone}>
        <path d="M6 -46 C 2 -16, 0 6, -8 40" stroke={tone} strokeWidth="12" strokeLinecap="round" fill="none" />
        {RAMO.map(({ x, y, giro, escala }) => (
          <g key={giro} transform={`translate(${x} ${y}) rotate(${giro}) scale(${escala})`}>
            <path d={FOLHA} />
            <path d={NERVURA} stroke="#ffffff" strokeOpacity="0.92" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Assinatura da marca, como está impressa no captador. */
export const ECOHORTA_SLOGAN = "Água inteligente para um futuro sustentável";

/** Marca completa: ramo, nome e assinatura. */
export function EcoHortaLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <EcoHortaLeaf className="size-16 shrink-0 drop-shadow-[0_3px_12px_rgb(64_192_90/0.35)]" />
      <div className="min-w-0">
        <p className="font-display text-[1.6rem] font-bold leading-none tracking-tight text-mist-50">EcoHorta</p>
        <p className="mt-2 text-[0.6rem] font-semibold uppercase leading-[1.5] tracking-[0.1em] text-leaf-300/90">
          {ECOHORTA_SLOGAN}
        </p>
      </div>
    </div>
  );
}
