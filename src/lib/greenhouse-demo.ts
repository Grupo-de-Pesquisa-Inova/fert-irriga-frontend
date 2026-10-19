export const DEMO_DURATION = 16;

// Demonstration clock is independent of controller commands and irrigation timers.
export function demonstrationFrame(seconds: number) {
  const time = Math.max(0, seconds) % DEMO_DURATION;
  const opening = Math.min(1, time / 1.5);
  const closing = Math.max(0, 1 - (time - 13) / 1.5);
  return {
    time,
    valveOpening: Math.min(opening, closing),
    flowing: time >= 3 && time < 13,
    phase:
      time < 1.5
        ? "Abrindo válvulas"
        : time < 3
          ? "Acionando a bomba"
          : time < 13
            ? "Água percorrendo o sistema"
            : time < 14.5
              ? "Encerrando a irrigação"
              : "Ciclo demonstrado",
  };
}
