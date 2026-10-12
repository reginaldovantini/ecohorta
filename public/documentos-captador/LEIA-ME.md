# Materiais do captador

Os PDFs desta pasta aparecem na área administrativa, na etapa certa da
construção do captador (Administração → Captadores → Construção e conexão).

Para publicar um material, duas linhas no mesmo commit:

1. coloque o arquivo aqui, com o nome exato da tabela abaixo;
2. marque `ready: true` naquele material, em `src/lib/collector/setup-resources.ts`.

| Arquivo                             | Onde aparece             |
| ----------------------------------- | ------------------------ |
| `manual-construcao-captador.pdf`    | Etapa 2 — Montagem       |
| `artes-personalizacao-captador.pdf` | Etapa 3 — Personalização |

Enquanto `ready` for `false`, a plataforma mostra "Em preparação" em vez de um
link quebrado. A disponibilidade é declarada em código, e não descoberta lendo
esta pasta, porque ler a pasta obrigaria o build a rastrear o projeto inteiro
para dentro do servidor — e publicar um PDF exige um commit de qualquer forma.
