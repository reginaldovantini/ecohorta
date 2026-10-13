import { describe, expect, it } from "vitest";
import { nextAction, setupJourney, SETUP_STEPS, type SetupFacts } from "./setup-journey";

const inicio: SetupFacts = {
  registered: true,
  marked: [],
  deviceRegistered: false,
  everConnected: false,
  calibrated: false,
  activated: false,
};

const journey = (facts: Partial<SetupFacts> = {}) => setupJourney({ ...inicio, ...facts });
const estados = (facts: Partial<SetupFacts> = {}) => journey(facts).steps.map((step) => step.state);

describe("uma etapa por vez", () => {
  it("logo após o cadastro, a vez é da montagem", () => {
    const atual = journey();
    expect(atual.currentStep).toBe("montagem");
    expect(estados()).toEqual(["done", "current", "locked", "locked", "locked", "locked", "locked"]);
    expect(nextAction(atual)).toBe("Baixar o manual e montar o captador");
  });

  it("marcar a montagem passa a vez para a identificação", () => {
    expect(journey({ marked: ["montagem"] }).currentStep).toBe("identificacao");
  });

  it("as etapas seguintes dizem por que esperam", () => {
    const bloqueadas = journey().steps.filter((step) => step.state === "locked");
    expect(bloqueadas).toHaveLength(5);
    for (const step of bloqueadas) expect(step.blockedBy).toBeTruthy();
    expect(journey().steps.find((s) => s.id === "calibracao")!.blockedBy).toMatch(/conectado/);
  });

  it("só a etapa atual traz o que fazer agora", () => {
    const comAcao = journey().steps.filter((step) => step.action !== null);
    expect(comAcao).toHaveLength(1);
    expect(comAcao[0]!.id).toBe("montagem");
  });
});

describe("fatos valem mais que marcações", () => {
  it("o ESP32 ter falado dá a conexão por feita, sem ninguém marcar nada", () => {
    const atual = journey({ marked: ["montagem", "identificacao"], everConnected: true });
    expect(atual.steps.find((s) => s.id === "conexao")!.state).toBe("done");
    expect(atual.currentStep).toBe("calibracao");
  });

  it("baixar o programa registra a placa, e isso cumpre a etapa do firmware", () => {
    const baixado = journey({ marked: ["montagem", "identificacao"], deviceRegistered: true });
    expect(baixado.steps.find((s) => s.id === "firmware")!.state).toBe("done");
    // Mas ter o programa não é estar conectado: a vez agora é da conexão.
    expect(baixado.currentStep).toBe("conexao");
  });

  it("uma placa falando cumpre firmware e conexão de uma vez, sem ninguém marcar nada", () => {
    const falando = journey({ marked: ["montagem", "identificacao"], everConnected: true });
    expect(falando.steps.find((s) => s.id === "firmware")!.state).toBe("done");
    expect(falando.steps.find((s) => s.id === "conexao")!.state).toBe("done");
    expect(falando.currentStep).toBe("calibracao");
  });

  it("marcar à mão não alcança o firmware: ele vem do cadastro da placa", () => {
    const soMarcado = journey({ marked: ["montagem", "identificacao", "firmware"] });
    expect(soMarcado.steps.find((s) => s.id === "firmware")!.state).toBe("current");
  });

  it("marcar a calibração não existe: ela vem da medição", () => {
    const atual = journey({ marked: [...SETUP_STEPS], everConnected: true });
    expect(atual.steps.find((s) => s.id === "calibracao")!.state).toBe("current");
    expect(atual.live).toBe(false);
  });
});

describe("voltar atrás", () => {
  it("perder a calibração devolve a pessoa para a etapa certa", () => {
    const antes = journey({ marked: ["montagem", "identificacao"], everConnected: true, calibrated: true, activated: true });
    expect(antes.live).toBe(true);

    // Trocou o sensor: a calibração anterior deixa de valer.
    const depois = journey({ marked: ["montagem", "identificacao"], everConnected: true, calibrated: false, activated: true });
    expect(depois.currentStep).toBe("calibracao");
    expect(depois.live).toBe(false);
  });

  it("o captador que perdeu a conexão volta à etapa de conexão", () => {
    const atual = journey({ marked: ["montagem", "identificacao"], everConnected: false, calibrated: false });
    expect(atual.currentStep).toBe("firmware");
  });
});

describe("chegada", () => {
  const completo = { marked: ["montagem", "identificacao"], everConnected: true, calibrated: true, activated: true };

  it("com tudo feito, o captador está na rede", () => {
    const atual = journey(completo);
    expect(atual.currentStep).toBeNull();
    expect(atual.completed).toBe(atual.total);
    expect(atual.live).toBe(true);
    expect(nextAction(atual)).toMatch(/no ar/i);
  });

  it("calibrado mas ainda não ativado para na verificação, e não finge que acabou", () => {
    const atual = journey({ ...completo, activated: false });
    expect(atual.currentStep).toBe("verificacao");
    expect(atual.live).toBe(false);
  });

  it("a verificação não se marca à mão: ela espelha os fatos", () => {
    const semCalibracao = journey({ marked: ["montagem", "identificacao"], everConnected: true, activated: true });
    expect(semCalibracao.steps.find((s) => s.id === "verificacao")!.state).toBe("locked");
    expect(journey(completo).steps.find((s) => s.id === "verificacao")!.state).toBe("done");
  });

  it("conta o progresso para a tela mostrar quanto falta", () => {
    expect(journey().completed).toBe(1);
    expect(journey({ marked: ["montagem"] }).completed).toBe(2);
    expect(journey(completo).completed).toBe(7);
  });
});

describe("toda etapa se explica", () => {
  it("cada uma tem título e uma frase do que acontece nela", () => {
    for (const step of journey().steps) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.summary.length).toBeGreaterThan(20);
      // Frase inteira, com ponto: é texto de orientação, não rótulo.
      expect(step.summary.endsWith(".")).toBe(true);
    }
  });

  it("são sete etapas, do cadastro à verificação", () => {
    expect(SETUP_STEPS).toEqual([
      "cadastro",
      "montagem",
      "identificacao",
      "firmware",
      "conexao",
      "calibracao",
      "verificacao",
    ]);
  });
});
