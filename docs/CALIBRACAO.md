# Calibração experimental de volume — sensores VL53L0X e VL53L1X

> **Fases 2 e 3** · 17/09/2026. O volume em litros de cada captador vem de uma calibração **experimental e específica** daquele captador, feita no app: **Administração → Captadores → {código} → Calibração de volume**. A validação independente fica em **Bancada** (§13). O protocolo completo de montagem e testes do EC-001 físico está em [HARDWARE.md §8](./HARDWARE.md).

## 1. Princípio da medição

- O sensor de distância do captador (**VL53L0X ou VL53L1X**, escolhido na plataforma em **Ligações**) mede a **distância** do sensor até a superfície da água. Esse é o **dado físico primário**.
- A calibração é a mesma para os dois sensores (distância → calibração → volume), mas cada calibração vale só para o sensor e a configuração de hardware com que foi feita (§7).
- O **volume é derivado** no servidor pela calibração ativa do captador. O navegador nunca informa distâncias nem volumes.
- O firmware do ESP32 **não converte** distância em volume: envia `distance_mm` e o servidor calcula.

## 2. Geometria e posição do sensor

```text
          ┌──────────┐  sensor ToF no topo, centralizado, apontando para baixo
          │    ▼     │
          │          │  ← D (distância medida)
          │          │
 dreno ◄──┤~ ~ ~ ~ ~ │  NÍVEL MÁXIMO   Dmax  (saída do dreno de segurança)
          │          │
          │  volume  │  H = D0 − D     altura da coluna acima do zero
          │   útil   │  V = k × H      volume útil
          │          │
válvula ◄─┤─ ─ ─ ─ ─ │  NÍVEL ZERO     D0    (centro da saída da válvula esférica)
          │decantação│  abaixo do zero: fora do volume útil
          └──────────┘
```

| Termo | Definição |
|---|---|
| **D** | Distância medida (mm), estabilizada no servidor |
| **D0** | Distância no nível ZERO: centro da saída da válvula (0,00 L) |
| **Dmax** | Distância no nível máximo: saída do dreno de segurança |
| **H** | `D0 − D`: altura da coluna acima do zero. Negativa na zona de decantação |
| **k** | Litros por mm de coluna, **determinado experimentalmente** |

O tubo é PVC **DN100**. O diâmetro interno real é ligeiramente menor que 100 mm e **não é assumido**: ele sai da calibração como resultado.

### 2.1 ZERO físico

- **Referência geométrica adotada:** o ZERO do sistema é a **linha horizontal que passa pelo centro do furo de saída da válvula esférica** (eixo da saída). É uma referência **definida para o protótipo**, marcada por fora do tubo e na mangueira transparente.
- **Comportamento real do escoamento:** por gravidade, a água sai enquanto a superfície está acima da **borda inferior** do furo interno da saída, não do centro. Ao esvaziar pela válvula, o nível tende a parar **abaixo** do ZERO.
- **Volume residual:** a lâmina entre a borda inferior e o centro do furo **não entra no volume útil** e aparece como "abaixo do zero".
  - Estimativa: `V_residual ≈ k × Δh`, com `Δh` ≈ metade do diâmetro interno do furo.
  - Exemplo: furo de 20 mm → Δh ≈ 10 mm → com k ≈ 0,0074 L/mm, ≈ 0,07 L.
  - O `Δh` real será **medido** (mangueira transparente) quando a válvula for integrada. Nesta fase ela não é acionada.
- **A zona de decantação** (abaixo da saída) nunca faz parte do volume útil.
- **Mudar a definição do ZERO exige nova calibração.** Ela gera nova versão; o histórico fica preservado. Nunca se "desloca" o zero de uma calibração existente.

## 3. Procedimento físico com o EC-001

### Preparação

1. **Desvie o condensado.** Coloque a mangueira do ar-condicionado em um balde durante todo o procedimento. Água entrando invalida as leituras.
2. **Válvula fechada** o tempo todo. Nesta fase não há controle automático de válvula.
3. **Marque por fora do tubo**, com fita:
   - a linha do **zero** (centro da saída da válvula);
   - a linha do **máximo** (saída do dreno).
4. Separe uma **jarra ou proveta graduada** de pelo menos 1 L. Confira a graduação com uma balança: 1,000 kg de água ≈ 1,00 L.
5. Garanta que o tubo está **vertical** e que o sensor está **centralizado** e livre de condensação na lente.
6. Faça login com uma conta de **professor ou administrador** e abra a tela de calibração. Com a tela aberta, o dispositivo passa a enviar leituras a cada 1 s.

### Etapas (exatamente nesta ordem)

| Etapa | O que fazer | Botão | Campo salvo |
|---|---|---|---|
| 1 · 0,00 L | Deixe a superfície exatamente na linha do zero. Aguarde **Estável** | REGISTRAR ZERO | `zero_distance_mm` |
| 2 · 1,00 L | Adicione **exatamente 1,00 L**, despejando devagar pela parede. Aguarde **Estável** | REGISTRAR 1 L | `one_liter_distance_mm` |
| 3 · 2,00 L | Adicione mais 1,00 L (total 2,00 L). Aguarde | REGISTRAR 2 L | `two_liter_distance_mm` |
| 4 · 3,00 L | Adicione mais 1,00 L (total 3,00 L). Aguarde | REGISTRAR 3 L | `three_liter_distance_mm` |
| 5 · Máximo | Encha devagar até a linha da saída do dreno. Aguarde | REGISTRAR NÍVEL MÁXIMO | `maximum_distance_mm` |

- **O volume máximo não é digitado.** A capacidade é calculada (§5).
- O botão só funciona com a leitura **Estável**. O servidor usa a sua própria leitura estabilizada no momento do clique.
- Errou uma etapa? Toque em **Refazer** nela: a etapa é registrada de novo e as seguintes são descartadas.
- Ao final, a tela mostra o **resumo**: pontos, constante, diâmetro efetivo, capacidade, qualidade e gráfico.
  - **Consistente:** "Ativar calibração" grava uma **nova versão ativa**.
  - **Inconsistente:** "Calibração inconsistente. Revise as leituras e repita o procedimento." A tentativa fica registrada como versão recusada e a calibração anterior continua valendo.

### Depois

- Devolva a mangueira do condensado ao captador.
- Confira em **Água** o volume calculado ("Volume calculado por: Calibração vN").

## 4. Estabilização da leitura

Uma leitura instantânea **nunca** vira ponto de calibração.

1. Cada telemetria traz uma distância. O firmware já aplica a mediana de 9 amostras do sensor.
2. O servidor guarda as leituras recentes do captador (`collector_state.distance_samples`).
3. Na janela: descarta leituras inválidas (ausentes ou fora de 40–4.000 mm), calcula a mediana, rejeita outliers, mede a variação e a deriva.
4. A distância estabilizada é a **média das leituras aceitas**.

| Parâmetro (`src/lib/collector/distance-stability.ts`) | Valor | Significado |
|---|---|---|
| `windowSize` | 20 | Últimas leituras consideradas |
| `maxAgeMs` | 60.000 | Leituras mais antigas são ignoradas (o ESP32 leva ~1–3 s por leitura) |
| `minReadings` | 12 | Mínimo de leituras aceitas para "Estável" |
| `outlierMm` | 10 | Distância máxima até a mediana; acima disso é outlier (reflexo, gota) |
| `maxOutlierRatio` | 20% | Mais outliers que isso = nível ainda mudando |
| `maxInvalidRatio` | 30% | Mais leituras inválidas que isso = **Inválida** |
| `stableStdMm` | 2 mm | Desvio-padrão máximo das leituras aceitas (a "Variação ±") |
| `maxDriftMm` | 2 mm | Diferença máxima entre as médias da 1ª e da 2ª metade (água subindo ou descendo) |

| Estado | Quando |
|---|---|
| **Estabilizando** | Poucas leituras, muitos outliers, variação ou deriva acima do limite |
| **Estável** | Todas as condições atendidas: o botão REGISTRAR é liberado |
| **Inválida** | Sem leituras recentes, ou leituras ausentes/fora da faixa em excesso |

Na tela de **Bancada**, os mesmos estados aparecem como no instrumento: **ESTÁVEL**, **INSTÁVEL** (= Estabilizando) e **INVÁLIDO**. A bancada também mostra o **tempo médio entre leituras** (`averageIntervalMs`).

## 5. Modelo matemático

**Hipótese:** seção transversal constante (tubo cilíndrico) → volume proporcional à altura.

```text
H₁ = D0 − D1     (1,00 L)
H₂ = D0 − D2     (2,00 L)
H₃ = D0 − D3     (3,00 L)

V = k × H        reta que passa pela origem: o nível ZERO é 0,00 L por definição

k = (H₁·1 + H₂·2 + H₃·3) / (H₁² + H₂² + H₃²)      mínimos quadrados pela origem
```

**Por que pela origem:** o zero é definido fisicamente. Uma reta com intercepto livre "absorveria" um erro no zero em vez de revelá-lo. Nenhum polinômio é usado: não há justificativa experimental para curvatura num tubo de seção constante.

| Resultado | Fórmula |
|---|---|
| Volume atual | `V = k × (D0 − D_atual)`, limitado entre 0 e a capacidade |
| Percentual | `V ÷ capacidade` |
| Altura útil | `D0 − Dmax` |
| Capacidade efetiva | `C = k × (D0 − Dmax)` |
| Área efetiva | `A = k × 1.000.000` mm² (1 L = 1.000.000 mm³) |
| Diâmetro efetivo | `d = 2 × √(A ÷ π)` |
| Resíduos | `k × Hᵢ − Vᵢ` para 1, 2 e 3 L |
| R² | `1 − Σresíduos² ÷ 5` (5 = variância total de 0, 1, 2 e 3 L) |

**Exemplo** (tubo com 96,8 mm internos):
- A = π/4 × 96,8² = 7.359 mm², ou seja, 1 L ocupa 135,9 mm de coluna;
- k = 0,0073593 L/mm;
- com altura útil de 1.500 mm: C = 11,04 L;
- distância atual 1.236 mm com D0 = 1.700 mm: H = 464 mm, V = 3,41 L (31%).

**O diâmetro efetivo é um resultado da calibração.** Ele não substitui a dimensão física cadastrada (`collectors.nominal_diameter_mm`) e aparece sempre ao lado do nominal. A diferença inclui o diâmetro interno real, conexões dentro do tubo e o volume de peças submersas.

## 6. Qualidade: quando a calibração é aceita

`fitVolumeCalibration()` em `src/lib/collector/volume-calibration.ts`. **Nenhum ponto é descartado ou corrigido.**

| Verificação | Regra | Reprova quando |
|---|---|---|
| Leituras válidas | 40 ≤ D ≤ 4.000 mm | Leitura ausente, negativa ou impossível |
| Monotonicidade | D0 > D1 > D2 > D3 > Dmax | Pontos fora de ordem |
| Separação | Cada litro e o trecho 3 L → máximo ≥ 30 mm | Pontos repetidos ou quase iguais |
| Alinhamento | Maior resíduo ≤ 0,08 L | Algum ponto fora da reta |
| Consistência | Alturas de cada litro com desvio ≤ 10% da média | Um litro "mediu" diferente dos outros |
| Diâmetro plausível | 80%–105% do nominal (DN100: 80–105 mm) | Volume adicionado errado ou sensor mal posicionado |
| Altura plausível | 60%–130% da altura útil nominal (1.500 mm: 900–1.950 mm) | Máximo registrado no lugar errado |
| Capacidade plausível | 55%–125% da capacidade do tubo nominal (π/4·D²·H) | Combinação implausível |

**Qualidade:**
- **Boa:** aceita, com maior resíduo ≤ 0,03 L e desvio entre litros ≤ 4%.
- **Aceitável:** aceita, sem atingir os limites de "Boa".
- **Inconsistente:** qualquer verificação reprovada. **Não é ativada.**

Os limites estão em `CALIBRATION_QUALITY` e partem de:
- ~136 mm de coluna por litro;
- resolução prática de ±2 mm do sensor;
- erro de ±10–20 mL de uma jarra graduada.

## 7. Versões e histórico

Tabela `collector_calibrations`.

| Status | Significado |
|---|---|
| `draft` | Procedimento em andamento (no máximo 1 por captador). Sem versão |
| `active` | Calibração em uso (no máximo 1 por captador) |
| `superseded` | Foi ativa e foi substituída por uma versão mais nova |
| `rejected` | Concluída e inconsistente. Tem versão, nunca foi usada |
| `cancelled` | Procedimento abandonado. Sem versão |

- **Cada conclusão gera a próxima versão** (1, 2, 3…), ativa ou recusada.
- **Nada é apagado.** Um gatilho no banco (`protect_calibration_history`) bloqueia `DELETE` e qualquer alteração em calibração concluída. A única transição permitida é `active → superseded`.
- Cada registro guarda:
  - modelo do sensor, dispositivo, se é SIMULAÇÃO e quem calibrou;
  - as 5 distâncias e os detalhes de cada ponto (variação, leituras, horário);
  - constante, diâmetro, altura, capacidade, R², maior resíduo;
  - qualidade e relatório completo (`quality_report`);
  - dimensões nominais no momento e o algoritmo (`linear-origin-v1`).
- **Trocar de calibração não cria nem apaga água captada.** A base do balanço hídrico acompanha a mudança de conversão (`rebaseVolume`).
- **Durante o procedimento**, a água adicionada à mão **não conta como captada**. Iniciar a calibração abre um **ensaio de bancada**: o balanço ignora as variações de nível, as leituras são gravadas uma a uma e as missões ficam bloqueadas. O ensaio termina ao tocar **Encerrar ensaio** ou sozinho, 15 min depois que as telas de calibração e bancada forem fechadas.
- **A calibração vale só para o dispositivo que a fez.** Trocar o ESP32 ou alternar entre SIMULAÇÃO e REAL deixa a calibração ativa sem efeito: o volume fica desconhecido até calibrar de novo. Uma calibração do dispositivo virtual **nunca** converte leituras do captador físico.
- **A calibração vale só para o sensor e a revisão de hardware com que foi feita.** Cada registro guarda o sensor configurado (`sensor_model`: VL53L0X ou VL53L1X) e a revisão (`hardware_revision`).
  - Trocar o sensor em **Ligações** cria a próxima revisão, marca a calibração ativa como substituída e cancela a calibração em andamento: é preciso calibrar de novo.
  - Voltar ao sensor anterior **não** reativa a calibração antiga: a revisão é outra.
  - Leituras de um driver diferente do sensor configurado (**⚠️ INCOMPATIBILIDADE DE HARDWARE**) nunca viram volume, e a calibração não pode ser iniciada nem ter etapas registradas até o firmware usar o driver certo.

## 8. Telemetria e volume

| Situação | `volume_source` | Volume |
|---|---|---|
| Calibração ativa e distância válida | `calibration` | `k × (D0 − D)`; `volume_liters` enviado pelo dispositivo é **ignorado** (fica em `telemetry.device_volume_liters` para comparação) |
| Calibração ativa e distância ausente ou impossível | `none` | Desconhecido. Nada é inventado |
| Sem calibração e o dispositivo envia `volume_liters` | `device` | Valor do dispositivo (compatibilidade com o dispositivo virtual antes de calibrar) |
| Sem calibração e só distância (ESP32) | `none` | Desconhecido. Status exibido `CALIBRATING` e missões indisponíveis |

- **Cada linha de `telemetry` guarda:**
  - `collector_id`, `device_id`, `sensor_model`, `recorded_at`;
  - `distance_mm` (dado primário), `height_mm`, `volume_liters`, `fill_ratio` (percentual) e `level_state`;
  - `volume_source`, `calibration_id` (a versão sai por junção com a calibração, que é imutável) e `status`;
  - `sensor_diagnostics` (diagnóstico do sensor) e `bench_mode` (gravada integralmente durante um ensaio).
- **O snapshot do captador traz:**
  - `telemetry.heightMm` e `telemetry.volumeSource`;
  - `calibration`: versão ativa, sensor e revisão de hardware, e se ela **vale para o dispositivo e a configuração atuais** (`appliesToDevice`; `mismatch` diz o motivo quando não vale);
  - `hardware`: sensor configurado, sensor reportado pelo firmware e a compatibilidade entre os dois;
  - `benchMode`;
  - `info.capacityLiters` com a **capacidade efetiva estimada** calibrada.
- **Contrato do ESP32:** basta enviar a distância.

```json
{
  "device_id": "ESP32-001",
  "collector_code": "EC-001",
  "seq": 1842,
  "uptime_ms": 3600000,
  "distance_mm": 1236,
  "sensor_model": "VL53L1X",
  "hardware_revision": 1,
  "sensor_diagnostics": {
    "sensor_state": "ready", "model_id": "0xEACC", "i2c_ack": true, "i2c_clock_hz": 100000,
    "samples": 9, "valid_samples": 8, "min_mm": 1234, "max_mm": 1239,
    "signal_rate_mcps": 3.41, "ambient_rate_mcps": 0.12,
    "status_counts": { "range valid": 8, "signal failure": 1 },
    "last_status": "range valid", "read_ms": 472, "timing_budget_ms": 50,
    "distance_mode": "long", "roi": "16x16", "rssi_dbm": -61
  },
  "valve": "unknown",
  "status": "MAINTENANCE",
  "fw_version": "esp32-0.3.0"
}
```

## 9. Preparação para missões (sem mudar as regras atuais)

O relatório do comando aceita `start_distance_mm` e `end_distance_mm`. Com calibração ativa, o servidor calcula o reúso medido e grava:
- `device_commands.measured_reuse_liters = V(início) − V(fim)`;
- `device_commands.calibration_id`.

```text
Volume inicial 8,02 L → meta 3,00 L → volume final 5,01 L → reutilizado 3,01 L (medido)
```

Nesta fase **a conclusão e o XP continuam pelo relatório medido do dispositivo**. O valor derivado é registrado ao lado, para validação antes de assumir a decisão.

## 10. Dispositivo virtual (SIMULAÇÃO)

- **Captador SIM-001** (dispositivo `VIRTUAL-001`), separado do captador físico **EC-001**.
- **Mesma conversão:** usa `volumeFromDistance()` e `distanceFromVolume()` com a sua geometria: D0 = 1.589 mm, Dmax = 60 mm, 12 L.
- **Envia distância, volume, `sensor_model` e diagnóstico no formato do firmware** (amostras válidas, faixa mín.–máx., status). Envia também as distâncias inicial e final de cada liberação. Sinal e luz ambiente não são simulados: vão como `null`.
- **Novas ações da simulação** (professor/admin):
  - `set_volume` (litros): usada pelos botões "Colocar 1,00 L no captador virtual" na tela de calibração;
  - `set_distance` (mm): painel da simulação → "Distância do sensor".
- **Sensor do captador virtual:** o dispositivo virtual segue o sensor configurado em Ligações, como o ESP32; na simulação, a troca física é instantânea.
- **Calibrar o captador virtual** reproduz a sua geometria: diâmetro efetivo ≈ 100 mm e capacidade ≈ 12 L. A calibração fica marcada como **SIMULAÇÃO** no histórico.
- **Na simulação**, desligue o condensado simulado antes de calibrar (há um botão na etapa).

## 11. Limitações e riscos

- **Cone do sensor dentro de tubo estreito.** O VL53L1X tem campo de visão de ~27°; o VL53L0X, de ~25°.
  - A 1,5 m, o cone é muito mais largo que o tubo e pode refletir nas paredes e nas luvas.
  - **Sinais a observar:** calibração inconsistente, leituras instáveis perto do fundo, dispersão grande entre amostras.
  - **Não há correção por software.** Os testes da bancada ([HARDWARE.md §8.5–8.6](./HARDWARE.md)) medem o risco.
  - **Mitigações a testar:** alvo flutuante fosco, paredes lisas, ROI menor no firmware (só VL53L1X; parâmetro de ensaio registrado em cada leitura).
- **Alcance do VL53L0X:** até 2 m no perfil de longo alcance. Com a tampa a ~1,6–1,7 m do ZERO, a etapa de 0 L pode ficar fora do alcance: teste na bancada antes de calibrar.
- **Extrapolação.** Os pontos medidos cobrem só 0–3 L (~400 mm) e a capacidade até o dreno é **extrapolada** (~3,7×). Por isso ela é sempre chamada de **capacidade efetiva estimada** até ser validada (§13) com 5 L, 8 L e perto do máximo.
- **Nível ZERO vs. escoamento.** Ver §2.1: a lâmina entre a borda inferior e o centro da saída não é contada.
- **Temperatura e condensação na lente** alteram a leitura. Calibre nas condições de uso.
- **Superfície agitada** pela água que cai: por isso o condensado é desviado durante a calibração.
- **Erro da jarra graduada** entra direto na constante. Confira a jarra com balança.
- **Recalibre** quando o sensor for movido ou trocado, o tubo trocado ou a qualidade cair. A troca de modelo de sensor já exige a nova calibração automaticamente.

## 12. Arquivos

| Arquivo | Conteúdo |
|---|---|
| `src/lib/collector/volume-calibration.ts` | Modelo, ajuste, qualidade, conversão distância ↔ volume, reúso medido |
| `src/lib/collector/distance-stability.ts` | Estabilização da leitura |
| `src/lib/server/calibration-service.ts` | Procedimento, versões e ativação (servidor) |
| `src/lib/server/collector-service.ts` | Volume derivado na telemetria e no snapshot; ensaio de bancada; calibração presa ao dispositivo |
| `src/lib/collector/validation.ts` | Erro absoluto e percentual das validações, estatística descritiva |
| `src/lib/server/bench-service.ts` | Bancada: diagnóstico, observações, validações, exportação CSV |
| `src/app/api/admin/collectors/[code]/calibration/**` | Rotas da calibração |
| `src/app/api/admin/collectors/[code]/bench/**` | Rotas da bancada |
| `src/components/admin/*` | Telas de Captadores, Calibração e Bancada |
| `supabase/migrations/20260917000000_volume_calibration.sql` | Tabela versionada, gatilho de histórico, colunas de volume derivado, RLS |
| `supabase/migrations/20260917010000_physical_validation.sql` | Ensaio de bancada, diagnóstico do sensor, observações e validações imutáveis, RLS |
| `supabase/migrations/20260917230000_distance_sensor_configuration.sql` | Sensor de distância do captador e revisão de hardware, histórico de trocas, calibração vinculada à revisão, RLS |
| `src/lib/collector/distance-sensors.ts` | Sensores suportados, ligação oficial, compatibilidade configurado × firmware |
| `src/lib/server/hardware-service.ts` | Troca do sensor (confirmação, revisão, calibração substituída, histórico) |

## 13. Validação experimental independente

Depois de ativar uma calibração, a **Bancada** registra validações: um volume físico **conhecido** comparado com o volume que o sistema **calcula**.

- **Não altera a calibração.** É dado experimental, imutável (tabela `calibration_validations`, protegida por gatilho).
- **O operador informa só a referência física:**
  - volume conhecido;
  - método (balança, recipiente graduado ou outro);
  - massa, se usou balança;
  - nota.

  A distância e o volume calculado vêm da leitura **estável** do servidor.
- **Exige:**
  - ensaio de bancada ativo (a água colocada à mão não entra no balanço);
  - calibração ativa **deste dispositivo**;
  - leitura estável.
- **O que é registrado:**
  - captador, calibração (versão), dispositivo, sensor, REAL/SIMULAÇÃO, data e hora e quem registrou;
  - distância, desvio da leitura, número de leituras, altura, volume calculado (exibido) e bruto, e se estava abaixo do zero ou acima do máximo;
  - **erro** = calculado − conhecido (com sinal);
  - **erro absoluto** = `|Vcalculado − Vreal|`;
  - **erro percentual** = `(Vcalculado − Vreal) ÷ Vreal × 100` e o **absoluto** `|…| × 100` (nulos quando Vreal = 0).

| Exemplo | |
|---|---|
| Volume conhecido | 5,00 L |
| Volume calculado | 4,92 L |
| Erro | −0,08 L |
| Erro percentual | −1,6% |

- **Estatística na tela** (só da calibração ativa):
  - número de registros;
  - erro médio com sinal (viés);
  - erro absoluto médio;
  - maior erro absoluto;
  - erro percentual absoluto médio.
- **Não há limite de "bom" definido a priori:** os resultados são apresentados para análise.
- **Pontos recomendados:** 5 L, 8 L e perto da capacidade máxima, além de 0 L para verificar o zero. Repetir o ciclo ao menos duas vezes. Os pontos 5 L e 8 L **não** fazem parte da calibração.
- **Exportação:** CSV em Bancada → Dados para análise (separador `;`, vírgula decimal).
- **Até haver validações perto do máximo**, a capacidade continua sendo apresentada como **capacidade efetiva estimada**.
