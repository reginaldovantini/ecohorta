"use client";

import { motion, useReducedMotion } from "motion/react";
import { CollectorTank } from "@/components/collector/collector-tank";

/*
 * O CICLO COMPLETO, EM MOVIMENTO: ar-condicionado → mangueira → captador.
 *
 * O tubo é a mesma peça que o aplicativo usa para mostrar o nível real — com a
 * água ondulando, as bolhas subindo, as gotas caindo lá dentro e o jato saindo
 * quando a válvula abre. Nada aqui é um desenho paralelo do captador: é o
 * captador do app, rodando um ciclo de demonstração.
 *
 * O que esta cena acrescenta é a ORIGEM da água, que no app não precisa
 * aparecer e aqui é o ponto inteiro: a condensadora pingando. Sem ela, quem
 * chega vê um tubo enchendo sozinho e não entende de onde vem a água.
 *
 * As gotas caem da ponta da mangueira até a boca do tubo e desaparecem ao
 * entrar — dali em diante quem continua a história é a animação interna do
 * próprio tanque.
 */

/** Medidas da cena em pixels, que é como a mangueira e o tubo se alinham. */
const CENA = { largura: 300, altura: 360 };
const TANQUE = { esquerda: 110, altura: 286 };
/** Boca do tubo: 27% da largura e 16% da altura do desenho do tanque. */
const BOCA = { x: TANQUE.esquerda + 0.27 * (0.516 * TANQUE.altura), y: CENA.altura - TANQUE.altura + 0.164 * TANQUE.altura };

const GOTAS = [0, 0.75, 1.5] as const;

export function CollectorInflowScene({ ratio, dispensing }: { ratio: number; dispensing: boolean }) {
  const reduced = useReducedMotion();

  return (
    <div className="relative mx-auto" style={{ width: CENA.largura, height: CENA.altura }}>
      <div className="absolute bottom-0" style={{ left: TANQUE.esquerda, height: TANQUE.altura }}>
        <CollectorTank
          ratio={ratio}
          urgency="normal"
          inflowActive={!dispensing}
          dispensing={dispensing}
          overflowing={false}
          showPercent
        />
      </div>

      <svg
        viewBox={`0 0 ${CENA.largura} ${CENA.altura}`}
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        aria-hidden
      >
        {/* ---------- Condensadora ---------- */}
        <g>
          <rect x="6" y="18" width="104" height="64" rx="10" fill="#c3cdd8" />
          <rect x="6" y="18" width="104" height="64" rx="10" fill="none" stroke="#95a3b1" strokeWidth="1.5" />
          <rect x="13" y="25" width="90" height="50" rx="7" fill="#a9b7c4" />
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="19" y1={33 + i * 10} x2="97" y2={33 + i * 10} stroke="#8795a4" strokeWidth="3" strokeLinecap="round" />
          ))}
          <circle cx="58" cy="52" r="15" fill="none" stroke="#7d8c9c" strokeWidth="2" />
          <circle cx="58" cy="52" r="3" fill="#7d8c9c" />
          {/* Suportes de parede */}
          <rect x="16" y="82" width="10" height="8" rx="2" fill="#7d8c9c" />
          <rect x="90" y="82" width="10" height="8" rx="2" fill="#7d8c9c" />
          {/* Brilho */}
          <path d="M14 26 h88" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </g>

        {/* ---------- Mangueira do dreno ---------- */}
        <path
          d={`M104 70 C 140 68, 152 40, ${BOCA.x + 24} 42 C ${BOCA.x + 6} 43, ${BOCA.x} 56, ${BOCA.x} 78`}
          fill="none"
          stroke="#cbd5df"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d={`M104 70 C 140 68, 152 40, ${BOCA.x + 24} 42 C ${BOCA.x + 6} 43, ${BOCA.x} 56, ${BOCA.x} 78`}
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.45"
        />

        {/* ---------- Gotas caindo para dentro do tubo ---------- */}
        {!reduced &&
          GOTAS.map((atraso) => (
            <motion.path
              key={atraso}
              // Gota com ponta para cima, como uma gota caindo de verdade.
              d="M0 0 c2.6 3.6 3.8 5.4 3.8 7.2 a3.8 3.8 0 0 1 -7.6 0 c0 -1.8 1.2 -3.6 3.8 -7.2z"
              fill="var(--color-aqua-300)"
              initial={{ x: BOCA.x, y: 82, opacity: 0 }}
              animate={{ y: [82, BOCA.y + 6], opacity: [0, 1, 1, 0], scaleY: [0.8, 1, 1.15, 1.15] }}
              transition={{ duration: 1.5, delay: atraso, repeat: Infinity, repeatDelay: 0.75, ease: "easeIn" }}
              style={{ x: BOCA.x }}
            />
          ))}

        {/* Respingo na boca do tubo, no compasso das gotas. */}
        {!reduced &&
          GOTAS.map((atraso) => (
            <motion.ellipse
              key={`respingo-${atraso}`}
              cx={BOCA.x}
              cy={BOCA.y + 7}
              rx="5"
              ry="1.6"
              fill="var(--color-aqua-200)"
              initial={{ opacity: 0, scaleX: 0.4 }}
              animate={{ opacity: [0, 0.65, 0], scaleX: [0.4, 1.3, 1.6] }}
              transition={{ duration: 0.55, delay: atraso + 1.35, repeat: Infinity, repeatDelay: 1.7, ease: "easeOut" }}
            />
          ))}
      </svg>
    </div>
  );
}
