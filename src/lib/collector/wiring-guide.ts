import { DISTANCE_SENSORS, SENSOR_WIRING, type DistanceSensorModel } from "./distance-sensors";

/*
 * MANUAL DE LIGAÇÕES — conteúdo por sensor (Administração → Captadores → Ligações).
 * A ligação física é a mesma para os dois sensores; muda o driver do firmware e
 * os cuidados específicos. Especificações vêm de distance-sensors.ts (documentadas).
 */

export interface WiringConnection {
  /** Número da via no cabo de 4 vias; null = não vai pelo cabo. */
  via: number | null;
  sensorPin: string;
  esp32: string;
  note: string;
}

export interface GuideSection {
  id: string;
  title: string;
  bullets?: string[];
  steps?: string[];
}

export interface WiringGuide {
  model: DistanceSensorModel;
  kind: string;
  function: string;
  principle: string[];
  specs: { label: string; value: string }[];
  connections: WiringConnection[];
  power: { intro: string; options: { module: string; connectTo: string }[]; check: string[] };
  sections: GuideSection[];
  sources: string[];
}

const { sdaGpio, sclGpio, i2cClockHz, cableConductors, cableLengthCm, address, board } = SENSOR_WIRING;
const khz = `${i2cClockHz / 1000} kHz`;

const connections: WiringConnection[] = [
  { via: 1, sensorPin: "VCC (ou VIN)", esp32: "Alimentação adequada ao módulo (3V3 na maioria)", note: "Confira a tabela de alimentação. Nunca assuma 5 V." },
  { via: 2, sensorPin: "GND", esp32: "GND", note: "Terra comum entre o módulo e o ESP32." },
  { via: 3, sensorPin: "SDA", esp32: `GPIO${sdaGpio} (D${sdaGpio})`, note: "Dados do I²C." },
  { via: 4, sensorPin: "SCL", esp32: `GPIO${sclGpio} (D${sclGpio})`, note: `Relógio do I²C, ${khz}.` },
  { via: null, sensorPin: SENSOR_WIRING.unusedPins.join(", "), esp32: "Não ligar", note: "Não vão pelo cabo nesta versão." },
];

function specific(model: DistanceSensorModel): GuideSection {
  if (model === "VL53L0X") {
    return {
      id: "especificos",
      title: "Cuidados específicos do VL53L0X",
      bullets: [
        "O alcance de 2 m vale só no perfil de longo alcance e em condições favoráveis. No EC-001, a distância da tampa até o ZERO fica perto de 1,6–1,7 m: com o tubo vazio, o sensor pode ficar fora do alcance. Valide na bancada antes de calibrar.",
        "Leituras acima de 2 m são descartadas pelo firmware como fora da faixa.",
        "A biblioteca usada não informa sinal, luz ambiente nem status por amostra: o diagnóstico mostra amostras aceitas, dispersão e timeouts.",
        "Não tem ROI: o cone de visão não pode ser estreitado por software.",
      ],
    };
  }
  return {
    id: "especificos",
    title: "Cuidados específicos do VL53L1X",
    bullets: [
      "O ROI (16×16 por padrão) é um parâmetro de ensaio em firmware/include/config.h. Se mudar, anote e repita os testes.",
      "O diagnóstico traz, por amostra, o status da medição, o sinal e a luz ambiente (MCPS).",
      "Sob luz ambiente forte o alcance do modo longo cai bastante: mantenha a tampa fechada durante as medições.",
    ],
  };
}

export function wiringGuide(model: DistanceSensorModel): WiringGuide {
  const spec = DISTANCE_SENSORS[model];
  return {
    model,
    kind: "Sensor de distância a laser por tempo de voo (ToF)",
    function: "Mede a distância da tampa até a superfície da água. A plataforma converte essa distância em litros pela calibração do captador.",
    principle: [
      "Emite pulsos de luz infravermelha invisível (laser de 940 nm) e mede o tempo que a luz leva para ir até a superfície e voltar — o tempo de voo. Como a velocidade da luz é conhecida, o tempo vira distância.",
      "A distância vem do tempo, não do brilho. Mas a quantidade de luz que volta limita o alcance: água transparente ou agitada devolve menos luz que um alvo branco e fosco.",
      ...(spec.roi ? ["Os receptores (SPADs) formam uma matriz cuja região de interesse (ROI) pode ser reduzida para estreitar o campo de visão."] : []),
    ],
    specs: [
      { label: "Fabricante", value: spec.manufacturer },
      { label: "Alcance documentado", value: [spec.rangeSummary, ...spec.rangeDetails].join(" ") },
      { label: "Campo de visão", value: `${spec.fieldOfViewDeg}°` },
      { label: "Emissor", value: spec.emitter },
      { label: "Alimentação", value: `${spec.chipSupply}. O módulo pode ter regulador: confira na placa.` },
      { label: "Interface", value: `I²C, endereço padrão ${address} (7 bits), ${spec.i2cMaxClock}. A EcoHorta usa ${khz}.` },
      {
        label: "Identificação",
        value: `${spec.identification.name} ${spec.identification.value}, lido do registrador ${spec.identification.register} (${spec.identification.registerBits} bits) e conferido pelo firmware. É um valor do sensor, não um endereço I²C.`,
      },
      {
        label: "Módulo",
        value: spec.knownModules.length
          ? `${spec.knownModules.join(", ")}: baseado no ${model}. Configure ${model}.`
          : `Outro módulo compatível com o ${model}. O CJMCU-531 do EC-001 é um VL53L1X: não o configure como ${model}.`,
      },
      ...(spec.roi ? [{ label: "ROI", value: spec.roi }] : []),
      { label: "Driver no firmware", value: spec.firmwareDriver },
      { label: "Configuração do firmware", value: spec.firmwareSettings },
    ],
    connections,
    power: {
      intro: `O chip ${model} funciona com 2,6 V a 3,5 V. Aceitar 5 V depende do módulo (a plaquinha), não do sensor. E os GPIOs do ESP32 não toleram 5 V.`,
      options: [
        { module: "Com regulador e entrada que inclui 3,3 V", connectTo: "3V3 do DevKit (preferencial)" },
        { module: "Sem regulador (chip alimentado direto)", connectTo: "Somente 3V3. 5 V danifica o sensor" },
        { module: "Que exige 5 V (pouco comum)", connectTo: `VIN/5V só se SDA e SCL medirem até 3,3 V; senão, conversor de nível` },
      ],
      check: [
        "Ligue só VCC e GND do módulo, na tensão escolhida.",
        "Meça com multímetro SDA–GND e SCL–GND: no máximo 3,3 V (tipicamente 2,8 V ou 3,3 V).",
        `Se der perto de 5 V, não ligue em GPIO${sdaGpio}/${sclGpio}.`,
        "Anote o modelo do módulo, a tensão escolhida e as medidas.",
      ],
    },
    sections: [
      {
        id: "cabo",
        title: `Cabo de ${cableConductors} vias, ~${cableLengthCm} cm instalado`,
        bullets: [
          "Uma via para cada sinal: VCC, GND, SDA e SCL.",
          "Anote o comprimento real e a cor de cada via, com as mesmas cores nas duas pontas.",
          "Cabo plano: ordem SDA – GND – VCC – SCL. Pares trançados: SDA com GND e SCL com VCC.",
          `I²C a ${khz}, igual para os dois sensores. Não aumente para 400 kHz sem validação física.`,
          "Mantenha o cabo afastado dos fios da válvula e da fonte de 12 V.",
        ],
      },
      {
        id: "posicao",
        title: "Posição no coletor",
        bullets: [
          "Dentro da tampa superior, centralizado no eixo do tubo.",
          "Um único sensor por captador.",
          "No mínimo 40 mm acima do nível MÁXIMO; recomenda-se 100 mm ou mais.",
          `A distância da tampa até o ZERO precisa caber no alcance documentado (${spec.rangeSummary}).`,
        ],
      },
      {
        id: "orientacao",
        title: "Orientação do sensor",
        bullets: [
          "Janela do sensor voltada para baixo, perpendicular à superfície da água.",
          "Confira o prumo antes de fixar; o módulo não pode girar com o tempo.",
          `Cone de visão de ~${spec.fieldOfViewDeg}°: a 1,5 m ele é mais largo que o tubo e pode refletir nas paredes e nas luvas. Esse risco é medido na bancada, não corrigido por software.`,
        ],
      },
      {
        id: "umidade",
        title: "Cuidados contra umidade",
        bullets: [
          "Emendas soldadas e isoladas com termorretrátil.",
          "Passagem do cabo pela tampa vedada (prensa-cabo ou silicone), sem vedar a janela do sensor.",
          "Laço de gotejamento antes da caixa eletrônica: a água que condensar no cabo não escorre para dentro dela.",
          "Cabo preso perto do módulo (alívio de tração).",
          "Registre se aparecer condensação na janela do sensor.",
        ],
      },
      {
        id: "janela",
        title: "Janela óptica",
        bullets: [
          "Retire a película protetora de fábrica, se houver.",
          "Não cubra a janela com cola, silicone, verniz ou fita.",
          "Limpe só com pano macio e seco.",
          "Sem vidro ou acrílico na frente no primeiro teste: uma janela de proteção exige calibração de crosstalk do sensor e pode criar reflexos.",
        ],
      },
      {
        id: "teste",
        title: "Procedimento de teste",
        steps: [
          `Confira nesta tela: "Sensor configurado" = ${model}.`,
          "Com o USB desligado, monte e ligue conforme a tabela.",
          "Ligue o USB e abra o monitor serial: pio device monitor -d firmware.",
          `Espere as linhas "[config] sensor da plataforma: ${model}" e "[sensor] ${model} pronto (id ${spec.identification.value})".`,
          `Nesta tela, confira "Reportado pelo firmware" = ${model} e o estado "Compatível".`,
          "Abra a Bancada, inicie o ensaio e siga o teste sem água (docs/HARDWARE.md §8.5).",
          "Se aparecer \"NÃO encontrado\": confira a ligação. SDA e SCL invertidos é o erro mais comum.",
        ],
      },
      {
        id: "calibracao",
        title: "Procedimento de calibração",
        steps: [
          'Só calibre com o estado "Compatível" nesta tela.',
          "Abra a Calibração deste captador e registre as cinco etapas: 0 L, 1 L, 2 L, 3 L e nível máximo.",
          `A calibração fica vinculada ao ${model} e à revisão de hardware atual.`,
          "Trocar o sensor substitui a calibração ativa: será preciso calibrar de novo. A anterior fica no histórico.",
        ],
      },
      specific(model),
    ],
    sources: [
      `Especificações: datasheet do ${model} (STMicroelectronics).`,
      "Módulos (plaquinhas) variam: confira regulador, rótulos e a ordem dos pinos na sua placa.",
      `Ligação: ${board}, GPIO${sdaGpio} (SDA) e GPIO${sclGpio} (SCL), firmware/include/config.h.`,
    ],
  };
}
