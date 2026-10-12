/*
 * INSTALAR A ECOHORTA NO CELULAR — e por que isto não é um botão só.
 *
 * Instalar um PWA parece uma coisa e são quatro, porque cada navegador faz de
 * um jeito:
 *
 *   Android/Chrome  o navegador avisa que dá para instalar e a plataforma abre
 *                   a janela nativa. Um toque resolve.
 *   iPhone/Safari   não existe API nenhuma. A pessoa precisa tocar em
 *                   Compartilhar e depois em "Adicionar à Tela de Início".
 *                   Sem instruções ilustradas, ninguém descobre sozinho.
 *   Computador      ícone de instalar na barra de endereço. Mas quem está no
 *                   computador provavelmente quer o app no CELULAR, onde as
 *                   missões acontecem — então a tela manda a pessoa para lá.
 *   Navegador de    link aberto dentro do WhatsApp, Instagram ou Facebook não
 *   aplicativo      instala nada. É a causa nº 1 de "não funciona comigo", e o
 *                   único conserto é abrir no navegador de verdade.
 *
 * Este módulo decide qual desses caminhos mostrar. Fica separado da tela, e
 * puro, porque é regra de negócio disfarçada de detecção: errar aqui faz uma
 * pessoa desistir achando que o aplicativo está quebrado.
 */

export type InstallPlatform = "android" | "ios" | "desktop" | "unknown";

export type InstallPath =
  /** O navegador ofereceu a instalação: um botão basta. */
  | "prompt"
  /** iPhone e iPad: passo a passo pelo menu Compartilhar. */
  | "ios-share"
  /** Computador: instala pela barra de endereço, mas o celular é melhor. */
  | "desktop"
  /** Dentro do WhatsApp/Instagram: precisa reabrir no navegador. */
  | "in-app-browser"
  /** Já está instalado — ou a pessoa está rodando pelo ícone agora. */
  | "installed";

export interface InstallContext {
  userAgent: string;
  /** A página está rodando pelo ícone instalado (display-mode: standalone). */
  standalone: boolean;
  /** O navegador disparou `beforeinstallprompt` e guardamos o evento. */
  promptAvailable: boolean;
}

/** Navegadores embutidos em aplicativos: não instalam PWA, por mais que tentem. */
const IN_APP = /\b(FBAN|FBAV|FB_IAB|Instagram|Line|Twitter|LinkedInApp|MicroMessenger|GSA)\b/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

export function detectPlatform(userAgent: string): InstallPlatform {
  const ua = userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ se apresenta como Mac; o que o denuncia é ter tela sensível ao
  // toque, mas pela UA o "Macintosh" com "Mobile" já basta na prática.
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "ios";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

export function installPath(context: InstallContext): InstallPath {
  if (context.standalone) return "installed";
  const plataforma = detectPlatform(context.userAgent);
  // O aviso do navegador embutido vem antes de tudo: dentro dele nada funciona,
  // nem no Android. Só não vale para iOS, onde o caminho manual funciona igual.
  if (isInAppBrowser(context.userAgent) && plataforma !== "ios") return "in-app-browser";
  if (context.promptAvailable) return "prompt";
  if (plataforma === "ios") return "ios-share";
  if (plataforma === "desktop") return "desktop";
  // Android sem `beforeinstallprompt`: ou já está instalado, ou o navegador não
  // suporta. O passo a passo do menu resolve os dois casos.
  return "ios-share";
}

/*
 * O NÍVEL DO TUBO — e por que ele não é uma barra de download.
 *
 * Não existe porcentagem de instalação de PWA: o navegador baixa o manifesto e
 * os ícones em milissegundos e acabou. Uma barrinha subindo de 0 a 100 seria
 * invenção, e este projeto não inventa número — é a mesma regra que proíbe
 * mostrar litro simulado como litro medido.
 *
 * Então o tubo marca ETAPAS REAIS, cada uma correspondendo a um evento que de
 * fato aconteceu no navegador.
 */
export type InstallStage = "checking" | "ready" | "prompting" | "installed";

export const STAGE_LEVEL: Record<InstallStage, number> = {
  checking: 0.08,
  ready: 0.36,
  prompting: 0.72,
  installed: 1,
};

export const STAGE_LABEL: Record<InstallStage, string> = {
  checking: "Verificando o seu aparelho…",
  ready: "Pronto para instalar",
  prompting: "Confirme na janela do navegador",
  installed: "Instalado!",
};

export interface InstallGuide {
  title: string;
  /** Uma frase por passo, na ordem em que a pessoa toca nas coisas. */
  steps: string[];
  /** Aviso que explica por que o caminho é esse, quando não é óbvio. */
  note?: string;
}

export function installGuide(path: InstallPath, platform: InstallPlatform): InstallGuide {
  switch (path) {
    case "prompt":
      return {
        title: "Instalar no seu celular",
        steps: [
          "Toque no botão abaixo.",
          "Confirme em “Instalar” na janela do navegador.",
          "Pronto: o ícone aparece na sua tela inicial.",
        ],
      };

    case "ios-share":
      return {
        title: platform === "ios" ? "Adicionar à Tela de Início" : "Adicionar pelo menu do navegador",
        steps:
          platform === "ios"
            ? [
                "Toque no botão Compartilhar, na barra de baixo do Safari.",
                "Role a lista e toque em “Adicionar à Tela de Início”.",
                "Toque em “Adicionar”, no canto superior direito.",
              ]
            : [
                "Abra o menu do navegador (os três pontinhos).",
                "Toque em “Instalar aplicativo” ou “Adicionar à tela inicial”.",
                "Confirme.",
              ],
        note:
          platform === "ios"
            ? "No iPhone e no iPad só funciona pelo Safari — em outros navegadores a opção não aparece."
            : undefined,
      };

    case "desktop":
      return {
        title: "Melhor no celular",
        steps: [
          "Abra esta mesma página no navegador do celular.",
          "A instalação continua por lá, em dois toques.",
        ],
        note: "Dá para instalar no computador pelo ícone de instalar na barra de endereço — mas as missões acontecem no pátio, com o celular na mão.",
      };

    case "in-app-browser":
      return {
        title: "Abra no navegador do celular",
        steps: [
          "Toque nos três pontinhos, no canto da tela.",
          "Escolha “Abrir no navegador” (Chrome, Safari ou Edge).",
          "Volte a esta página por lá e a instalação fica disponível.",
        ],
        note: "Links abertos dentro do WhatsApp, Instagram ou Facebook rodam num navegador reduzido, que não instala aplicativos.",
      };

    case "installed":
      return {
        title: "Já está instalado",
        steps: ["Procure o ícone da EcoHorta na sua tela inicial."],
      };
  }
}
