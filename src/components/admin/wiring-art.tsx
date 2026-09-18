import type { DistanceSensorModel } from "@/lib/collector/distance-sensors";

/*
 * Ilustrações ESQUEMÁTICAS do manual de ligações (não são fotos nem desenho de uma placa
 * específica: módulos variam na cor, no regulador e na ordem dos pinos).
 */

/** Cores sugeridas para as vias (convenção Qwiic/STEMMA QT). O manual pede para anotar as cores reais. */
export const WIRE_COLORS = {
  VCC: { stroke: "#ef4444", name: "vermelho" },
  GND: { stroke: "#0b1210", name: "preto" },
  SDA: { stroke: "#3b82f6", name: "azul" },
  SCL: { stroke: "#eab308", name: "amarelo" },
} as const;

type WireName = keyof typeof WIRE_COLORS;
const WIRES: WireName[] = ["VCC", "GND", "SDA", "SCL"];

/** Linha de uma via; o GND (preto) ganha contorno para aparecer no fundo escuro. */
function Wire({ name, x1, y1, x2, y2, width = 3.5 }: { name: WireName; x1: number; y1: number; x2: number; y2: number; width?: number }) {
  return (
    <g strokeLinecap="round">
      {name === "GND" && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8fa39b" strokeWidth={width + 2} />}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={WIRE_COLORS[name].stroke} strokeWidth={width} />
    </g>
  );
}

/** Módulo do sensor com os 6 pinos: VCC, GND, SDA e SCL usados; XSHUT e GPIO1 sem ligação. */
export function SensorModuleArt({ model }: { model: DistanceSensorModel }) {
  const pins: { label: string; wire: WireName | null }[] = [
    { label: "VCC", wire: "VCC" },
    { label: "GND", wire: "GND" },
    { label: "SDA", wire: "SDA" },
    { label: "SCL", wire: "SCL" },
    { label: "XSHUT", wire: null },
    { label: "GPIO1", wire: null },
  ];
  return (
    <svg
      viewBox="0 0 300 138"
      role="img"
      aria-label={`Ilustração esquemática do módulo ${model}: pinos VCC, GND, SDA e SCL ligados; XSHUT e GPIO1 sem ligação.`}
      className="h-auto w-full"
    >
      <rect x="24" y="6" width="252" height="92" rx="12" fill="#173a4f" stroke="#2c5b75" strokeWidth="1.5" />
      <circle cx="42" cy="24" r="6" fill="#0a1e1a" stroke="#2c5b75" />
      <circle cx="258" cy="24" r="6" fill="#0a1e1a" stroke="#2c5b75" />
      {/* Encapsulamento do sensor: janelas do emissor e do receptor */}
      <rect x="122" y="18" width="56" height="28" rx="5" fill="#0b0f14" stroke="#33414f" />
      <circle cx="137" cy="32" r="6" fill="#3b2a55" />
      <circle cx="163" cy="32" r="6" fill="#1b2a3b" />
      <text x="150" y="64" textAnchor="middle" className="fill-mist-50 font-display" fontSize="13" fontWeight="700">
        {model}
      </text>
      {pins.map((pin, index) => {
        const x = 49 + index * 40.4;
        return (
          <g key={pin.label}>
            <text x={x} y="84" textAnchor="middle" fontSize="10" fontWeight="600" className={pin.wire ? "fill-mist-100" : "fill-mist-500"}>
              {pin.label}
            </text>
            <circle cx={x} cy="98" r="6" fill={pin.wire ? "#d4a72c" : "#4b5560"} />
            {pin.wire ? (
              <Wire name={pin.wire} x1={x} y1={104} x2={x} y2={132} />
            ) : (
              <g stroke="#ff5a69" strokeWidth="2" strokeLinecap="round">
                <line x1={x - 5} y1={114} x2={x + 5} y2={124} />
                <line x1={x + 5} y1={114} x2={x - 5} y2={124} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Stage({ n, y, title, lines }: { n: number; y: number; title: string; lines: string[] }) {
  return (
    <g>
      <circle cx="24" cy={y - 4} r="11" fill="#0e2621" stroke="#2ec5f0" strokeWidth="1.5" />
      <text x="24" y={y} textAnchor="middle" fontSize="11" fontWeight="700" className="fill-aqua-300">
        {n}
      </text>
      <text x="42" y={y} fontSize="12" fontWeight="700" className="fill-mist-50 font-display">
        {title}
      </text>
      {lines.map((line, index) => (
        <text key={line} x="42" y={y + 16 + index * 14} fontSize="10.5" className="fill-mist-300">
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({ y1, y2 }: { y1: number; y2: number }) {
  return (
    <g stroke="#638377" strokeWidth="2" strokeLinecap="round" fill="none">
      <line x1="24" y1={y1} x2="24" y2={y2} />
      <polyline points={`18,${y2 - 7} 24,${y2} 30,${y2 - 7}`} />
    </g>
  );
}

/**
 * SENSOR ↓ CABO 4 VIAS ↓ CAIXA ELETRÔNICA ↓ ESP32 DEVKIT V1, com as quatro vias do
 * sensor selecionado até os pinos do ESP32 (VCC → 3V3*, GND → GND, SDA → D21, SCL → D22).
 */
export function WiringDiagram({ model }: { model: DistanceSensorModel }) {
  const xs = [192, 218, 244, 270];
  const espPins = ["3V3*", "GND", "D21", "D22"];
  return (
    <svg
      viewBox="0 0 320 492"
      role="img"
      aria-label={`Diagrama de ligação do ${model}: sensor dentro da tampa, cabo de 4 vias de cerca de 50 cm, caixa eletrônica e ESP32 DevKit V1. VCC na alimentação adequada ao módulo, GND no GND, SDA no GPIO21 e SCL no GPIO22.`}
      className="h-auto w-full"
    >
      <Stage n={1} y={58} title="SENSOR" lines={[model, "dentro da tampa,", "voltado para baixo"]} />
      <Arrow y1={112} y2={146} />
      <Stage n={2} y={180} title="CABO 4 VIAS" lines={["~50 cm instalado", "VCC · GND · SDA · SCL"]} />
      <Arrow y1={222} y2={262} />
      <Stage n={3} y={292} title="CAIXA ELETRÔNICA" lines={["fechada, longe", "de respingos"]} />
      <Arrow y1={334} y2={374} />
      <Stage n={4} y={404} title="ESP32 DEVKIT V1" lines={["3V3* · GND", "GPIO21 · GPIO22"]} />

      {/* Tampa e módulo do sensor */}
      <text x="308" y="22" textAnchor="end" fontSize="9" className="fill-mist-500">
        tampa
      </text>
      <rect x="178" y="27" width="132" height="8" rx="2" fill="#2d5a4e" />
      <rect x="176" y="38" width="132" height="62" rx="8" fill="#173a4f" stroke="#2c5b75" strokeWidth="1.5" />
      <rect x="213" y="45" width="36" height="16" rx="3" fill="#0b0f14" stroke="#33414f" />
      <circle cx="223" cy="53" r="3.5" fill="#3b2a55" />
      <circle cx="239" cy="53" r="3.5" fill="#1b2a3b" />
      <text x="231" y="77" textAnchor="middle" fontSize="11" fontWeight="700" className="fill-mist-50 font-display">
        {model}
      </text>

      {/* Vias: do sensor aos pinos do ESP32 */}
      {WIRES.map((name, index) => (
        <Wire key={name} name={name} x1={xs[index]!} y1={100} x2={xs[index]!} y2={392} />
      ))}
      {WIRES.map((name, index) => (
        <g key={`pad-${name}`}>
          <text x={xs[index]} y="93" textAnchor="middle" fontSize="8.5" fontWeight="600" className="fill-mist-100">
            {name}
          </text>
          <circle cx={xs[index]} cy="100" r="4" fill="#d4a72c" />
        </g>
      ))}

      {/* Cabo de 4 vias */}
      <rect x="180" y="146" width="102" height="100" rx="16" fill="#ffffff" fillOpacity="0.07" stroke="#ffffff" strokeOpacity="0.18" />
      <text x="317" y="200" textAnchor="end" fontSize="10" className="fill-mist-300">
        ~50 cm
      </text>

      {/* Caixa eletrônica e prensa-cabo */}
      <rect x="170" y="270" width="144" height="214" rx="12" fill="none" stroke="#638377" strokeDasharray="5 4" strokeWidth="1.5" />
      <rect x="182" y="264" width="100" height="12" rx="3" fill="#1d4239" stroke="#2d5a4e" />

      {/* ESP32 DevKit V1 */}
      <rect x="176" y="380" width="132" height="96" rx="6" fill="#12304f" stroke="#24507a" strokeWidth="1.5" />
      {espPins.map((pin, index) => (
        <g key={pin}>
          <circle cx={xs[index]} cy="392" r="4.5" fill="#d4a72c" />
          <text x={xs[index]} y="410" textAnchor="middle" fontSize="9" fontWeight="700" className="fill-mist-50">
            {pin}
          </text>
        </g>
      ))}
      <rect x="201" y="420" width="60" height="42" rx="3" fill="#8a97a6" />
      <text x="231" y="445" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#0a1e1a">
        ESP32
      </text>
      <rect x="223" y="470" width="16" height="9" rx="1.5" fill="#6b7280" />
    </svg>
  );
}
