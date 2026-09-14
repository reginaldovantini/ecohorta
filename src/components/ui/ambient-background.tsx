/**
 * Vegetação desfocada ao fundo: dá profundidade e a sensação de natureza.
 * Camada fixa e estática (pintada uma vez), sem animação.
 */
const LEAF = "M0 0 C 30 -40 90 -46 130 -10 C 92 20 34 30 0 0 Z";

const leaves = [
  { x: -30, y: 90, rotate: -35, scale: 1.5, color: "#2fc46f", opacity: 0.22 },
  { x: -10, y: 170, rotate: 10, scale: 1.1, color: "#1f9955", opacity: 0.2 },
  { x: 330, y: 60, rotate: 200, scale: 1.4, color: "#2fc46f", opacity: 0.16 },
  { x: 360, y: 520, rotate: 160, scale: 1.8, color: "#1f9955", opacity: 0.18 },
  { x: -40, y: 700, rotate: -20, scale: 1.7, color: "#2fc46f", opacity: 0.14 },
  { x: 310, y: 820, rotate: 215, scale: 1.3, color: "#14a7da", opacity: 0.12 },
];

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg
        className="absolute left-1/2 top-0 h-full w-full max-w-[640px] -translate-x-1/2 blur-2xl"
        viewBox="0 0 400 900"
        preserveAspectRatio="xMidYMid slice"
      >
        {leaves.map((leaf, index) => (
          <path
            key={index}
            d={LEAF}
            fill={leaf.color}
            opacity={leaf.opacity}
            transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotate}) scale(${leaf.scale})`}
          />
        ))}
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_40%,transparent_40%,rgb(3_15_13/0.7))]" />
    </div>
  );
}
