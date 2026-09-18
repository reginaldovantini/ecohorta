import { describe, expect, it } from "vitest";
import {
  assessSensorCompatibility,
  DEFAULT_DISTANCE_SENSOR,
  DISTANCE_SENSOR_MODELS,
  DISTANCE_SENSORS,
  isDistanceSensorModel,
  SENSOR_WIRING,
  sensorMatchesConfiguration,
} from "./distance-sensors";
import { wiringGuide } from "./wiring-guide";

/*
 * Sensores de distância suportados (VL53L0X e VL53L1X): especificações documentadas,
 * ligação oficial, manual de ligações por sensor e compatibilidade configurado × firmware.
 */

describe("sensores suportados", () => {
  it("são dois, com o VL53L1X como padrão dos captadores existentes", () => {
    expect(DISTANCE_SENSOR_MODELS).toEqual(["VL53L0X", "VL53L1X"]);
    expect(DEFAULT_DISTANCE_SENSOR).toBe("VL53L1X");
    expect(isDistanceSensorModel("VL53L0X")).toBe(true);
    expect(isDistanceSensorModel("vl53l0x")).toBe(false);
    expect(isDistanceSensorModel("HC-SR04")).toBe(false);
  });

  it("trazem só as especificações documentadas pelo fabricante", () => {
    expect(DISTANCE_SENSORS.VL53L0X).toMatchObject({
      documentedMaxRangeMm: 2000,
      fieldOfViewDeg: 25,
      identification: { register: "0xC0", value: "0xEE" },
      roi: null,
    });
    expect(DISTANCE_SENSORS.VL53L1X).toMatchObject({
      documentedMaxRangeMm: 4000,
      fieldOfViewDeg: 27,
      identification: { register: "0x010F", value: "0xEACC" },
    });
    for (const model of DISTANCE_SENSOR_MODELS) {
      expect(DISTANCE_SENSORS[model].chipSupply).toBe("2,6 V a 3,5 V no chip");
      expect(DISTANCE_SENSORS[model].emitter).toContain("940 nm");
    }
  });

  it("usam a mesma ligação oficial: 4 vias, GPIO21/GPIO22, 100 kHz e sem XSHUT/GPIO1", () => {
    expect(SENSOR_WIRING).toMatchObject({
      board: "ESP32 DevKit V1",
      sdaGpio: 21,
      sclGpio: 22,
      i2cClockHz: 100_000,
      cableConductors: 4,
      cableLengthCm: 50,
      unusedPins: ["XSHUT", "GPIO1"],
    });
  });
});

describe("manual de ligações", () => {
  it.each(DISTANCE_SENSOR_MODELS)("%s: mesma pinagem, com cabo de 4 vias e XSHUT/GPIO1 fora do cabo", (model) => {
    const guide = wiringGuide(model);
    expect(guide.model).toBe(model);
    expect(guide.connections.map(({ via, sensorPin, esp32 }) => [via, sensorPin.split(" ")[0], esp32])).toEqual([
      [1, "VCC", "Alimentação adequada ao módulo (3V3 na maioria)"],
      [2, "GND", "GND"],
      [3, "SDA", "GPIO21 (D21)"],
      [4, "SCL", "GPIO22 (D22)"],
      [null, "XSHUT,", "Não ligar"],
    ]);
    expect(guide.sections.find((section) => section.id === "cabo")?.title).toBe("Cabo de 4 vias, ~50 cm instalado");
    const ids = guide.sections.map((section) => section.id);
    expect(ids).toEqual(["cabo", "posicao", "orientacao", "umidade", "janela", "teste", "calibracao", "especificos"]);
  });

  it.each(DISTANCE_SENSOR_MODELS)("%s: não assume 5 V e manda medir SDA/SCL antes de ligar", (model) => {
    const { power } = wiringGuide(model);
    expect(power.intro).toContain("depende do módulo");
    expect(power.options[0]!.connectTo).toContain("3V3");
    expect(power.options[1]!.connectTo).toBe("Somente 3V3. 5 V danifica o sensor");
    expect(power.check.join(" ")).toContain("no máximo 3,3 V");
  });

  it("muda conforme o sensor: especificações, identificação no teste e cuidados específicos", () => {
    const l0x = wiringGuide("VL53L0X");
    const l1x = wiringGuide("VL53L1X");
    const spec = (guide: typeof l0x, label: string) => guide.specs.find((item) => item.label === label)?.value;
    expect(spec(l0x, "Alcance documentado")).toContain("até 2 m");
    expect(spec(l1x, "Alcance documentado")).toContain("até 4 m");
    expect(spec(l0x, "ROI")).toBeUndefined();
    expect(spec(l1x, "ROI")).toContain("16×16");
    expect(l0x.sections.find((s) => s.id === "teste")?.steps?.join(" ")).toContain("[sensor] VL53L0X pronto (id 0xEE)");
    expect(l1x.sections.find((s) => s.id === "teste")?.steps?.join(" ")).toContain("[sensor] VL53L1X pronto (id 0xEACC)");
    expect(l0x.sections.at(-1)?.title).toBe("Cuidados específicos do VL53L0X");
    expect(l0x.sections.at(-1)?.bullets?.join(" ")).toContain("fora do alcance");
    expect(l1x.sections.at(-1)?.title).toBe("Cuidados específicos do VL53L1X");
  });
});

describe("compatibilidade: sensor configurado × firmware", () => {
  const base = { configured: "VL53L0X" as const, online: true };

  it("compatível quando o firmware usa o driver do sensor configurado e o sensor respondeu", () => {
    const result = assessSensorCompatibility({ ...base, reported: "VL53L0X", diagnostics: { sensor_state: "ready", model_id: "0xEE", i2c_ack: true } });
    expect(result.state).toBe("compatible");
  });

  it("incompatível quando o firmware usa outro driver", () => {
    const result = assessSensorCompatibility({ ...base, reported: "VL53L1X", diagnostics: { sensor_state: "ready" } });
    expect(result.state).toBe("incompatible");
    expect(result.message).toContain("driver do VL53L1X");
    expect(result.message).toContain("configurado para o VL53L0X");
  });

  it("incompatível quando o dispositivo no I²C não se identifica como o sensor configurado", () => {
    const result = assessSensorCompatibility({ ...base, reported: "VL53L0X", diagnostics: { sensor_state: "not_found", i2c_ack: true, model_id: "0x42" } });
    expect(result.state).toBe("incompatible");
    expect(result.message).toContain("0x42");
  });

  it("sensor ausente quando ninguém responde no endereço", () => {
    const result = assessSensorCompatibility({ ...base, reported: "VL53L0X", diagnostics: { sensor_state: "not_found", i2c_ack: false } });
    expect(result.state).toBe("sensor_missing");
    expect(result.message).toContain("GPIO21");
  });

  it("falha do sensor em timeout ou erro ao iniciar", () => {
    expect(assessSensorCompatibility({ ...base, reported: "VL53L0X", diagnostics: { sensor_state: "timeout" } }).state).toBe("sensor_fault");
    expect(assessSensorCompatibility({ ...base, reported: "VL53L0X", diagnostics: { sensor_state: "error" } }).state).toBe("sensor_fault");
  });

  it("sem conclusão quando offline, sem configuração no firmware ou sem informar o sensor", () => {
    expect(assessSensorCompatibility({ ...base, online: false, reported: "VL53L1X", diagnostics: null }).state).toBe("offline");
    expect(assessSensorCompatibility({ ...base, reported: null, diagnostics: { sensor_state: "not_configured" } }).state).toBe("awaiting_config");
    expect(assessSensorCompatibility({ ...base, reported: null, diagnostics: null }).state).toBe("not_reported");
  });

  it("volume só com leituras do driver configurado (firmware antigo, sem informar o sensor, é aceito)", () => {
    expect(sensorMatchesConfiguration("VL53L0X", "VL53L0X")).toBe(true);
    expect(sensorMatchesConfiguration("VL53L0X", "VL53L1X")).toBe(false);
    expect(sensorMatchesConfiguration("VL53L0X", undefined)).toBe(true);
    expect(sensorMatchesConfiguration("VL53L0X", null)).toBe(true);
  });
});

describe("endereço I²C × identificação e módulo do EC-001", () => {
  it("os dois sensores usam o endereço 0x29; a identificação vem de registradores diferentes", () => {
    expect(SENSOR_WIRING.address).toBe("0x29");
    expect(DISTANCE_SENSORS.VL53L0X.identification).toEqual({ name: "model ID", register: "0xC0", registerBits: 8, value: "0xEE" });
    expect(DISTANCE_SENSORS.VL53L1X.identification).toEqual({ name: "sensor ID", register: "0x010F", registerBits: 16, value: "0xEACC" });
    for (const model of DISTANCE_SENSOR_MODELS) {
      const identification = wiringGuide(model).specs.find((item) => item.label === "Identificação")!.value;
      expect(identification).toContain("não um endereço I²C");
      expect(identification).not.toContain("0x29");
    }
  });

  it("o CJMCU-531 do EC-001 é documentado como VL53L1X, nunca como VL53L0X", () => {
    expect(DISTANCE_SENSORS.VL53L1X.knownModules.join(" ")).toContain("CJMCU-531");
    expect(DISTANCE_SENSORS.VL53L0X.knownModules).toEqual([]);
    const moduleOf = (model: "VL53L0X" | "VL53L1X") => wiringGuide(model).specs.find((item) => item.label === "Módulo")!.value;
    expect(moduleOf("VL53L1X")).toBe("CJMCU-531 (módulo do EC-001): baseado no VL53L1X. Configure VL53L1X.");
    expect(moduleOf("VL53L0X")).toContain("O CJMCU-531 do EC-001 é um VL53L1X: não o configure como VL53L0X.");
  });
});
