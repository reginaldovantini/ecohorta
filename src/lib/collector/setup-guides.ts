import type { DocumentInput } from "./document-pdf";
import { DISTANCE_SENSORS, type DistanceSensorModel } from "./distance-sensors";
import { flashingGuide, FLASHING_LINKS } from "./firmware-package";

/*
 * OS DOIS MANUAIS QUE A ESCOLA LEVA PARA A MÃO.
 *
 * O conteúdo mora aqui, em texto, e não num PDF guardado numa pasta. A
 * diferença importa: um arquivo na pasta é igual para todo mundo e desatualiza
 * em silêncio; este sai com as medidas do tubo daquela escola, com o sensor que
 * ela escolheu e com o nome da rede que a placa dela vai criar.
 *
 * O manual de construção é honesto sobre o que ainda não tem: ele traz o que o
 * projeto mediu e decidiu, e diz com todas as letras onde faltam fotos. Um
 * manual que finge estar completo manda a escola cortar o tubo errado uma vez
 * só — e essa escola não volta.
 */

export interface GuideContext {
  collectorCode: string;
  schoolName: string;
  location: string;
  distanceSensor: DistanceSensorModel;
  nominalDiameterMm: number;
  nominalUsefulHeightMm: number;
  reserveLiters: number;
  hotspotSsid: string;
  hotspotPassword: string;
}

const rodape = (context: GuideContext) => `EcoHorta Inteligente · ${context.collectorCode} · ${context.schoolName}`;
const metro = (mm: number) => `${(mm / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} m`;

/** O manual de construção do tubo, com as medidas deste captador. */
export function constructionGuideDocument(context: GuideContext): DocumentInput {
  const sensor = DISTANCE_SENSORS[context.distanceSensor];
  return {
    title: "Manual de construção do captador",
    subtitle: `${context.collectorCode} · ${context.schoolName} · ${context.location}`,
    footer: rodape(context),
    sections: [
      {
        heading: "O que você vai construir",
        blocks: [
          {
            kind: "text",
            text:
              "Um tubo vertical que recebe a água que o ar-condicionado joga fora, guarda essa água e deixa um sensor " +
              "medir quanto tem lá dentro. Nada é automático: a água sai pela torneira, aberta por quem está no pátio, e " +
              "o sensor mede quanto saiu. É essa medição que conclui a missão de um estudante.",
          },
          {
            kind: "fields",
            items: [
              ["Diâmetro interno", `${context.nominalDiameterMm} mm (PVC DN100)`],
              ["Altura útil", `${metro(context.nominalUsefulHeightMm)} (do ZERO ao MÁXIMO)`],
              ["Reserva no fundo", `${context.reserveLiters.toLocaleString("pt-BR")} L`],
              ["Sensor escolhido", `${sensor.model} — ${sensor.rangeSummary}`],
            ],
          },
          {
            kind: "note",
            title: "Esta é a versão preliminar deste manual",
            text:
              "O texto traz as medidas, os cortes e as decisões já validadas no captador da escola que originou o " +
              "projeto. As fotos de cada etapa entram na próxima versão. Em caso de dúvida numa medida, pare e " +
              "pergunte antes de cortar: tubo cortado não volta.",
          },
        ],
      },
      {
        heading: "Materiais",
        blocks: [
          {
            kind: "bullets",
            items: [
              `Tubo de PVC DN100, cerca de ${metro(context.nominalUsefulHeightMm + 300)} (sobra para as conexões e o apoio).`,
              "Tampa de PVC DN100 para a parte de cima — é nela que o sensor é instalado.",
              "Cap ou tampão para o fundo, mais a saída da torneira.",
              "Torneira ou registro de esfera para a saída da água, na altura do ZERO.",
              "Mangueira transparente lateral, ligada ao tubo em cima e embaixo: é a régua visual, independente do sensor.",
              "Mangueira que traz a água do dreno do ar-condicionado.",
              `Sensor de distância ${sensor.model} (módulo pequeno, com quatro pinos: VCC, GND, SDA, SCL).`,
              "Placa ESP32 DevKit V1 e uma caixa plástica para abrigá-la, longe da água.",
              "Cabo de 4 vias, cerca de 50 cm, ligando o sensor da tampa até a placa na caixa.",
              "Fonte USB de 5 V para a placa, com tomada protegida da chuva.",
              "Cola de PVC, lixa, fita veda-rosca, abraçadeiras e suportes de fixação na parede.",
            ],
          },
        ],
      },
      {
        heading: "Montagem, passo a passo",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Escolha o lugar",
                lines: [
                  "O tubo fica embaixo do dreno do ar-condicionado, encostado numa parede que aguente o peso.",
                  "Cheio, ele passa de 12 kg: fixe em alvenaria, nunca só em divisória.",
                  "A saída da torneira precisa escoar para um lugar seguro, onde a água possa cair sem molhar passagem.",
                ],
              },
              {
                title: "Corte o tubo e monte a estrutura",
                lines: [
                  `Corte o tubo para a altura escolhida, lembrando que a altura ÚTIL deste captador é ${metro(context.nominalUsefulHeightMm)}.`,
                  "Lixe as bordas, limpe e cole o cap do fundo.",
                  "Instale a torneira no fundo, com veda-rosca, e teste com água antes de subir o tubo.",
                ],
                whenItFails: "Vazamento na torneira quase sempre é rosca sem veda-rosca suficiente. Desmonte e refaça: colar por cima não resolve.",
              },
              {
                title: "Marque o ZERO e o MÁXIMO",
                lines: [
                  "ZERO é a linha do centro da saída da torneira: abaixo dela a água não sai, e é a reserva do fundo.",
                  "MÁXIMO é a borda de baixo da saída do dreno de segurança, lá em cima.",
                  "Marque as duas linhas por fora do tubo, com fita e caneta, e cole uma régua na mangueira transparente com o 0 mm no ZERO.",
                ],
              },
              {
                title: "Instale o sensor na tampa",
                lines: [
                  "O sensor vai DENTRO da tampa de cima, centralizado no eixo do tubo e apontado para baixo.",
                  "Confira o prumo antes de fixar: sensor torto mede a parede, não a água.",
                  "Retire a película protetora de fábrica da janelinha do sensor, se houver.",
                  "Não passe cola, silicone, verniz nem fita sobre a janela do sensor.",
                  `Deixe pelo menos 10 cm entre o sensor e o nível MÁXIMO da água (o mínimo que o ${sensor.model} enxerga é 4 cm).`,
                ],
                whenItFails: "Se depois o aplicativo mostrar uma distância que não muda, quase sempre o sensor está lendo uma luva ou a entrada da mangueira. Anote tudo que fica dentro do tubo no caminho do sensor.",
              },
              {
                title: "Ligue o sensor à placa",
                lines: [
                  "O ESP32 fica na caixa plástica, fora do tubo e longe de respingo.",
                  "Use o cabo de 4 vias entre o sensor e a placa: VCC no 3V3, GND no GND, SDA no GPIO 21 e SCL no GPIO 22.",
                  "A tela de Ligações, na plataforma, mostra o desenho desta ligação para o seu sensor.",
                ],
                whenItFails: "Ligar o VCC do sensor no 5 V em vez do 3V3 queima o módulo. Confira duas vezes antes de energizar.",
              },
              {
                title: "Leve a água do ar-condicionado até o tubo",
                lines: [
                  "Ligue a mangueira do dreno à entrada de cima do tubo, com caimento contínuo — sem barriga no meio do caminho.",
                  "Deixe o dreno de segurança livre: é por ele que o excesso escapa quando o tubo enche.",
                ],
              },
              {
                title: "Marque como feito na plataforma",
                lines: [
                  "Com o tubo montado, o sensor na tampa e a placa na caixa, volte à etapa de Construção e toque em 'Montei o captador'.",
                  "A próxima etapa é imprimir o adesivo com o QR Code deste captador.",
                ],
              },
            ],
          },
        ],
      },
      {
        heading: "O que NÃO fazer",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Não instale válvula automática nesta fase: o sistema é por gravidade, e a válvula ainda está em estudo. A saída é manual.",
              "Não cubra a janela do sensor com acrílico ou vidro no primeiro teste: o reflexo atrapalha a medição.",
              "Não use papel comum no adesivo do QR: no pátio ele encharca, e um QR que não lê é missão que não acontece.",
              "Não beba a água do captador nem use em alimento. Ela é água de condensação, boa para rega e limpeza.",
            ],
          },
        ],
      },
    ],
  };
}

/** O manual de gravação da placa, com a identidade deste captador e sem o token. */
export function firmwareGuideDocument(context: GuideContext): DocumentInput {
  const sensor = DISTANCE_SENSORS[context.distanceSensor];
  return {
    title: "Como gravar o programa na placa",
    subtitle: `${context.collectorCode} · ${context.schoolName} · ${context.location}`,
    footer: rodape(context),
    sections: [
      {
        heading: "Antes de começar",
        blocks: [
          {
            kind: "text",
            text:
              "Você não vai escrever código. O programa do captador já está pronto e é igual para todas as escolas — o " +
              "que muda é um arquivo pequeno, com a identidade deste captador, que a plataforma gera para você baixar. " +
              "Este guia é para quem nunca abriu um programa de programação.",
          },
          {
            kind: "fields",
            items: [
              ["Captador", context.collectorCode],
              ["Sensor configurado", `${sensor.model} (${sensor.rangeSummary})`],
              ["Rede que a placa cria", context.hotspotSsid],
              ["Senha dessa rede", context.hotspotPassword],
            ],
          },
          {
            kind: "note",
            title: "O arquivo da identidade não vem neste papel",
            text:
              "O arquivo secrets.h, que diz à placa qual captador ela é, contém uma senha de dispositivo e por isso só " +
              "existe na tela da plataforma, na etapa do Programa do ESP32. Baixe-o de lá, no mesmo computador em que " +
              "você vai gravar a placa, e não o envie por mensagem para ninguém.",
          },
          {
            kind: "bullets",
            items: [
              "Um computador com internet (Windows, Mac ou Linux).",
              "Um cabo USB de DADOS — cabo só de carregar não funciona.",
              "A placa ESP32 do captador.",
              "Cerca de 40 minutos na primeira vez: boa parte é download.",
            ],
          },
        ],
      },
      {
        heading: "Passo a passo",
        blocks: [{ kind: "steps", items: flashingGuide(context) }],
      },
      {
        heading: "Endereços citados neste guia",
        blocks: [
          {
            kind: "fields",
            items: [
              ["Visual Studio Code", FLASHING_LINKS.vscode],
              ["Extensão PlatformIO", FLASHING_LINKS.platformio],
              ["Projeto do captador", FLASHING_LINKS.projeto],
              ["Driver USB (CP2102)", FLASHING_LINKS.drivers],
            ],
          },
        ],
      },
      {
        heading: "Quando algo não funciona",
        blocks: [
          {
            kind: "bullets",
            items: [
              "A placa não aparece no computador: troque o cabo antes de qualquer outra coisa. É a causa mais comum.",
              "A gravação falha dizendo que a porta está ocupada: feche o monitor serial e tente de novo.",
              "A rede do captador não aparece no celular: desligue e ligue a placa na tomada e procure de novo depois de um minuto.",
              "A página de configuração não abre sozinha: digite 192.168.4.1 no navegador do celular, já conectado à rede da placa.",
              "A etapa de Conexão não fica verde: confira se a rede escolhida é de 2,4 GHz. O ESP32 não enxerga redes de 5 GHz.",
            ],
          },
          {
            kind: "text",
            text:
              "Quando a placa falar com a plataforma, a etapa de Conexão acende sozinha na tela, sem ninguém marcar nada. " +
              "Daí em diante falta só a calibração, que é feita com água medida em jarra.",
          },
        ],
      },
    ],
  };
}
