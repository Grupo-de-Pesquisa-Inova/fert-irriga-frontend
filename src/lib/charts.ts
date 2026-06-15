import type { ITelemetryRecord } from "../services/api";

// ─── Paleta Adobe Spectrum usada nos gráficos ──────────
const SPECTRUM = {
  blue: "#2680eb",
  purple: "#9256d9",
  orange: "#e68619",
  red: "#e34850",
  green: "#2d9d78",
};

interface ThemeColors {
  axis: string;
  text: string;
  panel: string;
  value: string;
  split: string;
}

const theme = (dark: boolean): ThemeColors =>
  dark
    ? { axis: "#393939", text: "#b3b3b3", panel: "#252525", value: "#f2f2f2", split: "rgba(255,255,255,0.06)" }
    : { axis: "#e1e1e1", text: "#6e6e6e", panel: "#ffffff", value: "#1b1b1b", split: "rgba(0,0,0,0.06)" };

/** Gradiente vertical suave para áreas (transparente embaixo). */
function areaGradient(color: string) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: color + "44" },
      { offset: 1, color: color + "00" },
    ],
  };
}

// ─── Gauge (mostrador) elegante estilo Spectrum ────────
export function gaugeOption(opts: {
  value: number;
  min: number;
  max: number;
  unit: string;
  color: string;
  dark: boolean;
  decimals?: number;
}) {
  const t = theme(opts.dark);
  const dec = opts.decimals ?? 1;
  return {
    series: [
      {
        type: "gauge",
        startAngle: 215,
        endAngle: -35,
        min: opts.min,
        max: opts.max,
        radius: "98%",
        center: ["50%", "56%"],
        progress: {
          show: true,
          width: 12,
          roundCap: true,
          itemStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 1,
              colorStops: [
                { offset: 0, color: opts.color + "99" },
                { offset: 1, color: opts.color },
              ],
            },
          },
        },
        axisLine: {
          roundCap: true,
          lineStyle: { width: 12, color: [[1, t.axis]] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 30,
          fontWeight: 700,
          offsetCenter: [0, "2%"],
          formatter: (v: number) => `${v.toFixed(dec)}${opts.unit}`,
          color: t.value,
          fontFamily: "'Source Code Pro', monospace",
        },
        data: [{ value: opts.value }],
      },
    ],
  };
}

// ─── Gráfico de tendência profissional (eixo Y duplo) ──
// Temperatura (°C, eixo esquerdo) × Umidade (%, eixo direito) ao longo do
// tempo, com horários reais, tooltip cruzado e áreas suaves.
export function trendOption(history: ITelemetryRecord[], dark: boolean) {
  const t = theme(dark);
  const times = history.map((r) =>
    new Date(r.recorded_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );

  return {
    aria: { enabled: true, description: "Gráfico de tendência de temperatura e umidade ao longo do tempo." },
    grid: { left: 52, right: 56, top: 48, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.axis,
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: t.value, fontSize: 12 },
      axisPointer: {
        type: "cross",
        lineStyle: { color: t.text, type: "dashed" },
        label: { backgroundColor: t.panel, color: t.value, borderColor: t.axis, borderWidth: 1 },
      },
      valueFormatter: undefined,
      formatter: (params: any[]) => {
        const head = `<div style="font-size:11px;color:${t.text};margin-bottom:6px">${params[0]?.axisValue ?? ""}</div>`;
        const rows = params
          .map((p) => {
            const unit = p.seriesName === "Temperatura" ? "°C" : "%";
            return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0">
              ${p.marker}
              <span style="flex:1">${p.seriesName}</span>
              <strong style="font-family:'Source Code Pro',monospace">${Number(p.value).toFixed(1)}${unit}</strong>
            </div>`;
          })
          .join("");
        return head + rows;
      },
    },
    legend: {
      data: ["Temperatura", "Umidade"],
      textStyle: { color: t.text },
      top: 8,
      right: 8,
      icon: "roundRect",
      itemWidth: 16,
      itemHeight: 8,
      itemGap: 18,
    },
    xAxis: {
      type: "category",
      data: times,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11, hideOverlap: true },
    },
    yAxis: [
      {
        type: "value",
        name: "°C",
        min: 0,
        max: 50,
        position: "left",
        nameTextStyle: { color: SPECTRUM.orange, fontSize: 11, fontWeight: 600, padding: [0, 0, 0, -28] },
        axisLine: { show: true, lineStyle: { color: SPECTRUM.orange } },
        axisLabel: { color: t.text, fontSize: 11 },
        splitLine: { lineStyle: { color: t.split } },
      },
      {
        type: "value",
        name: "%",
        min: 0,
        max: 100,
        position: "right",
        nameTextStyle: { color: SPECTRUM.blue, fontSize: 11, fontWeight: 600, padding: [0, -24, 0, 0] },
        axisLine: { show: true, lineStyle: { color: SPECTRUM.blue } },
        axisLabel: { color: t.text, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Temperatura",
        type: "line",
        yAxisIndex: 0,
        smooth: 0.35,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        sampling: "lttb",
        data: history.map((r) => +r.temperatura_c.toFixed(1)),
        lineStyle: { width: 2.5, color: SPECTRUM.orange },
        itemStyle: { color: SPECTRUM.orange, borderColor: t.panel, borderWidth: 2 },
        areaStyle: { color: areaGradient(SPECTRUM.orange) },
        emphasis: { focus: "series" },
      },
      {
        name: "Umidade",
        type: "line",
        yAxisIndex: 1,
        smooth: 0.35,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        sampling: "lttb",
        data: history.map((r) => +r.umidade_pct.toFixed(1)),
        lineStyle: { width: 2.5, color: SPECTRUM.blue },
        itemStyle: { color: SPECTRUM.blue, borderColor: t.panel, borderWidth: 2 },
        areaStyle: { color: areaGradient(SPECTRUM.blue) },
        emphasis: { focus: "series" },
      },
    ],
  };
}

// ─── VPD — Déficit de Pressão de Vapor (agronômico) ────
// Derivado de temperatura + umidade. Indica o "conforto" da planta na estufa.
export function computeVPD(tempC: number, umidPct: number): number {
  const svp = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  const vpd = svp * (1 - umidPct / 100);
  return Math.max(0, vpd);
}

export function classifyVPD(vpd: number): { label: string; color: string } {
  if (vpd < 0.4) return { label: "Muito úmido", color: "#2680eb" };
  if (vpd < 0.8) return { label: "Úmido", color: "#0fb5ae" };
  if (vpd <= 1.2) return { label: "Ideal", color: "#2d9d78" };
  if (vpd <= 1.6) return { label: "Seco", color: "#e68619" };
  return { label: "Muito seco", color: "#e34850" };
}

export function vpdGaugeOption(vpd: number, dark: boolean) {
  const t = theme(dark);
  return {
    series: [
      {
        type: "gauge",
        min: 0,
        max: 2,
        startAngle: 215,
        endAngle: -35,
        radius: "98%",
        center: ["50%", "58%"],
        axisLine: {
          lineStyle: {
            width: 12,
            color: [
              [0.2, "#2680eb"], // muito úmido  (0.0–0.4)
              [0.4, "#0fb5ae"], // úmido        (0.4–0.8)
              [0.6, "#2d9d78"], // ideal        (0.8–1.2)
              [0.8, "#e68619"], // seco         (1.2–1.6)
              [1.0, "#e34850"], // muito seco   (1.6–2.0)
            ],
          },
        },
        pointer: { show: true, length: "60%", width: 4, itemStyle: { color: t.value } },
        anchor: { show: true, size: 9, showAbove: true, itemStyle: { color: t.value } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 22,
          fontWeight: 700,
          offsetCenter: [0, "44%"],
          formatter: (v: number) => `${v.toFixed(2)} kPa`,
          color: t.value,
          fontFamily: "'Source Code Pro', monospace",
        },
        data: [{ value: vpd }],
      },
    ],
  };
}

// ─── Pressão barométrica ao longo do tempo ─────────────
export function pressureOption(history: ITelemetryRecord[], dark: boolean) {
  const t = theme(dark);
  const times = history.map((r) =>
    new Date(r.recorded_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
  const vals = history.map((r) => +r.pressao_hpa.toFixed(1));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max(1, (max - min) * 0.4);

  return {
    aria: { enabled: true, description: "Gráfico da pressão barométrica ao longo do tempo." },
    grid: { left: 58, right: 20, top: 24, bottom: 32 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.axis,
      borderWidth: 1,
      textStyle: { color: t.value, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: t.text, type: "dashed" } },
      valueFormatter: (v: number) => `${Number(v).toFixed(1)} hPa`,
    },
    xAxis: {
      type: "category",
      data: times,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      name: "hPa",
      min: Math.floor(min - pad),
      max: Math.ceil(max + pad),
      nameTextStyle: { color: SPECTRUM.purple, fontSize: 11, fontWeight: 600 },
      axisLabel: { color: t.text, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split } },
    },
    series: [
      {
        name: "Pressão",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        sampling: "lttb",
        data: vals,
        lineStyle: { width: 2.5, color: SPECTRUM.purple },
        itemStyle: { color: SPECTRUM.purple },
        areaStyle: { color: areaGradient(SPECTRUM.purple) },
      },
    ],
  };
}
