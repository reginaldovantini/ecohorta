# Design System — EcoHorta

> Guia vivo: rode `npm run dev` e abra **/design** no navegador ou no celular.

## Conceito

**"Laboratório no fundo da lagoa"**: tecnologia + natureza + ciência + jogo.

- **Tema escuro como padrão:** a água brilha, o visual lembra jogo e dashboard de IoT, e a tela OLED gasta menos bateria.
- **Aparência:** sem estética infantil. É uma edtech profissional com identidade própria.
- **Movimento com propósito:** toda animação representa um estado real do sistema.

## Cores (`src/app/globals.css`)

| Token | Papel | Uso |
|---|---|---|
| `abyss-*` | Superfícies | Fundo, cards e navegação |
| `mist-*` | Texto | `mist-50` títulos, `mist-300` corpo, `mist-400` legendas |
| `aqua-*` | **Água, cor primária** | Volume, ações principais, captador |
| `leaf-*` | Reúso e sucesso | Litros reutilizados, missão concluída, dispositivo pronto |
| `sun-*` | XP e conquistas | Barra de XP, recompensas |
| `ember-*` | Atenção | Captador de 86% a 95% |
| `alert-*` | Crítico | Captador de 96% a 100%, falhas |
| `sim-*` | **Exclusiva da simulação** | Selo SIMULAÇÃO. Nunca usar em dado real |

## Tipografia

Todas as fontes são carregadas pelo `next/font`, hospedadas junto com o app e sem requisição ao Google.

| Fonte | Classe | Uso |
|---|---|---|
| Space Grotesk | `font-display` | Títulos e números grandes (sempre com `tabular-nums`) |
| Inter | `font-sans` (padrão) | Textos e interface |
| JetBrains Mono | `font-mono` | Telemetria e dados técnicos |

O utilitário `eyebrow` é o sobretítulo em caixa alta usado em rótulos de métricas.

## Forma e espaço

- **Espaçamento:** múltiplos de 4 px (escala do Tailwind). Margem lateral de telas `px-5` (20 px).
- **Raios:** `rounded-card` (24 px) para cards e `rounded-control` (16 px) para botões e campos. Chips usam `rounded-full`.
- **Toque:** altura mínima de 44 px nos controles. O botão `md` tem 48 px e o `lg`, 56 px.
- **Profundidade:** borda de 1 px `white/6%` com brilho interno sutil, em vez de sombras pesadas.
- **Área segura do iPhone:** utilitários `pt-safe` e `pb-safe`.

## Componentes (`src/components/ui`)

| Componente | Descrição |
|---|---|
| `Button` | Variantes `primary`, `leaf`, `secondary`, `ghost` e `danger`; tamanhos `sm`, `md` e `lg`; retorno tátil com efeito de mola |
| `Surface` | Painel base. Tons `default`, `raised`, `aqua`, `leaf`, `ember`, `alert` e `sim` |
| `Chip` | Rótulo compacto com ícone e os mesmos tons |
| `StatusPill` | Estado do dispositivo com ponto pulsante quando está ativo |
| `SimulationBadge` | Selo obrigatório para dados simulados |
| `ProgressBar` | XP, volume e desafios. Anima com `translateX` na GPU |
| `AnimatedNumber` | Número que rola até o novo valor |
| `Skeleton` | Carregamento |
| `BottomSheet` | Painel inferior com arraste pela alça, Esc e foco |

## Movimento

- **Biblioteca:** `motion/react` para molas e animações de layout; CSS `@keyframes` para loops decorativos (ondas, bolhas).
- **Propriedades animadas:** apenas `transform` e `opacity`. Nunca `width`, `height` ou `top`.
- **Acessibilidade:** `prefers-reduced-motion` desativa os loops decorativos.
- **Referências:** toque 120 ms, transição 240 ms, entrada de tela 400 ms; efeito de mola de `stiffness` 400–520 e `damping` 30–38 para elementos interativos.
