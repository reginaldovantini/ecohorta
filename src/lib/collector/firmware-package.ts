/*
 * O PROGRAMA DO ESP32, PRONTO PARA UM CAPTADOR.
 *
 * Quem replica o projeto montou o tubo seguindo o manual e agora precisa gravar
 * um programa numa placa. Essa pessoa pode nunca ter programado — e é aqui que
 * ela desiste, se a plataforma só disser "compile o firmware".
 *
 * Então a plataforma entrega o que falta e nada além: um arquivo `secrets.h`
 * com a identidade DAQUELE captador, e um passo a passo que não presume nada.
 * O resto do código já está no repositório e é igual para todos.
 *
 * O QUE NÃO VAI NO ARQUIVO: a senha do Wi-Fi da escola.
 *
 * Seria cômodo gerar o programa já com a rede dentro. Mas esse arquivo vai para
 * a pasta de downloads, às vezes para o e-mail, às vezes para um computador
 * compartilhado da secretaria — e a senha do Wi-Fi da escola iria junto. O
 * ESP32 pergunta a rede a quem está na frente dele, como uma TV nova, e guarda
 * na própria memória.
 */

export interface FirmwareIdentity {
  collectorCode: string;
  deviceKey: string;
  /** Token do dispositivo, em claro. Aparece UMA vez; o banco guarda só o hash. */
  deviceToken: string;
  apiBaseUrl: string;
  /** Rede que o ESP32 cria para ser configurado e atender missões offline. */
  hotspotSsid: string;
  hotspotPassword: string;
}

/**
 * Conteúdo de `firmware/include/secrets.h`.
 *
 * É o único arquivo diferente entre dois captadores. Tudo o que o identifica
 * está aqui, e nada daqui está no Git.
 */
export function secretsHeader(identity: FirmwareIdentity): string {
  const linhas = [
    "#pragma once",
    "",
    "// ====================================================================",
    `// EcoHorta Inteligente — identidade do captador ${identity.collectorCode}`,
    "//",
    "// Gerado pela plataforma. NÃO versione este arquivo e não o compartilhe:",
    "// o token abaixo é o que autoriza este captador a enviar medições.",
    "//",
    "// A rede Wi-Fi NÃO está aqui de propósito. Ao ligar, o ESP32 cria a própria",
    `// rede (${identity.hotspotSsid}) e pergunta a rede da escola a quem estiver`,
    "// na frente dele. A senha fica guardada na memória da placa, não num arquivo.",
    "// ====================================================================",
    "",
    `#define DEVICE_ID "${identity.deviceKey}"`,
    `#define COLLECTOR_CODE "${identity.collectorCode}"`,
    `#define DEVICE_TOKEN "${identity.deviceToken}"`,
    `#define API_BASE_URL "${identity.apiBaseUrl}"`,
    "",
    "// Rede que a placa cria para ser configurada, e que um estudante liga no",
    "// celular para atender o captador quando a internet da escola falha.",
    `#define SETUP_AP_SSID "${identity.hotspotSsid}"`,
    `#define SETUP_AP_PASSWORD "${identity.hotspotPassword}"`,
    "",
    "// Certificado da plataforma. Vazio usa conexão sem verificação — só em bancada.",
    'static const char API_ROOT_CA[] = "";',
    "",
  ];
  return linhas.join("\n");
}

export interface FlashingStep {
  title: string;
  /** Instruções em frases curtas. Nenhuma presume experiência anterior. */
  lines: string[];
  /** Comando ou trecho a copiar, quando existir. */
  copy?: string;
  /** Erro comum nesta etapa e como sair dele. */
  whenItFails?: string;
}

/**
 * Passo a passo da gravação, escrito para quem nunca abriu um ambiente de
 * programação. Cada etapa diz o que vai acontecer na tela e o que fazer quando
 * não acontecer — travar sozinho é o que faz a pessoa desistir.
 */
export function flashingGuide(identity: FirmwareIdentity): FlashingStep[] {
  return [
    {
      title: "1. Instale o programa que grava a placa",
      lines: [
        "No computador, instale o Visual Studio Code (gratuito).",
        "Dentro dele, abra a aba de Extensões e instale a extensão PlatformIO IDE.",
        "A instalação demora alguns minutos na primeira vez: ela baixa as ferramentas sozinha.",
      ],
      whenItFails: "Se a extensão não terminar de instalar, feche e abra o Visual Studio Code uma vez.",
    },
    {
      title: "2. Baixe o projeto do captador",
      lines: [
        "Baixe o projeto EcoHorta e descompacte numa pasta.",
        "No Visual Studio Code, abra essa pasta.",
      ],
    },
    {
      title: "3. Coloque a identidade deste captador",
      lines: [
        `Baixe o arquivo secrets.h deste captador (${identity.collectorCode}) aqui nesta tela.`,
        "Salve dentro da pasta do projeto, em firmware/include/.",
        "Esse arquivo é o que diz à placa qual captador ela é. Não envie para ninguém.",
      ],
    },
    {
      title: "4. Ligue a placa no computador",
      lines: [
        "Conecte o ESP32 ao computador com um cabo USB de dados.",
        "Cabo só de carregar não serve: o computador precisa reconhecer a placa.",
      ],
      whenItFails:
        "Se o computador não reconhecer, troque o cabo primeiro. Se continuar, instale o driver CP2102 ou CH340 — está escrito no chip quadrado ao lado da entrada USB.",
    },
    {
      title: "5. Grave o programa",
      lines: [
        "No Visual Studio Code, abra o terminal e rode o comando abaixo.",
        "A primeira gravação demora: o PlatformIO baixa as bibliotecas do sensor.",
        "Ao terminar aparece SUCCESS em verde.",
      ],
      copy: "pio run -d firmware -e esp32dev -t upload",
      whenItFails:
        "Erro de porta ocupada: feche o monitor serial e tente de novo. Erro de permissão no Linux: adicione seu usuário ao grupo dialout.",
    },
    {
      title: "6. Configure a rede Wi-Fi",
      lines: [
        "Assim que ligar, a placa cria a própria rede Wi-Fi.",
        `No celular, conecte-se à rede ${identity.hotspotSsid} usando a senha ${identity.hotspotPassword}.`,
        "Uma página abre sozinha com a lista de redes disponíveis.",
        "Escolha a rede da escola, digite a senha dela e confirme.",
        "A placa reinicia e passa a enviar medições.",
      ],
      whenItFails:
        "Se a página não abrir sozinha, digite 192.168.4.1 no navegador. Se a rede da escola não aparecer na lista, aproxime o captador do roteador para o primeiro teste.",
    },
    {
      title: "7. Confira aqui na plataforma",
      lines: [
        "Volte a esta tela: quando a placa falar, a etapa de conexão fica verde sozinha.",
        "A partir daí o captador já envia distância, mas ainda não entrega litros.",
        "Falta a calibração, que é a próxima etapa.",
      ],
    },
  ];
}
