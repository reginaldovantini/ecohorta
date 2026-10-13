#pragma once

#include <stdint.h>

// VOLUME A PARTIR DA DISTÂNCIA — a mesma conta do servidor, feita na placa.
//
// O servidor converte distância em litros para mostrar no aplicativo. A placa
// precisa da MESMA conta por outro motivo: é ela que decide o instante de fechar
// a válvula. Se esse instante dependesse de uma resposta HTTP, uma queda de
// Wi-Fi no meio da liberação deixaria a água correndo até o tempo máximo.
//
// Os quatro números vêm da plataforma na resposta de cada telemetria e ficam
// guardados na memória não volátil. Sem eles a placa NÃO abre a válvula: liberar
// água sem saber medir seria liberar por tempo, e tempo não é medida.

struct VolumeModel {
  // Distância do sensor até o nível ZERO (eixo da saída da válvula), em mm.
  float zeroDistanceMm = 0;
  // Distância até o nível MÁXIMO (borda do dreno de segurança), em mm.
  float maximumDistanceMm = 0;
  // Litros por milímetro de coluna. É o coeficiente medido na calibração.
  float constantLitersPerMm = 0;
  float capacityLiters = 0;

  bool valid() const { return constantLitersPerMm > 0 && capacityLiters > 0; }
};

// Litros úteis para uma distância medida. Limitado entre 0 e a capacidade, como
// no servidor: acima do máximo o excesso escorre pelo dreno, e abaixo do zero a
// água está na zona de decantação e não sai pela torneira.
float volumeFromDistance(const VolumeModel &model, float distanceMm);
