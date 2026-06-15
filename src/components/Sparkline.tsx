import { createMemo } from "solid-js";

/**
 * Mini-gráfico de tendência em SVG puro (leve, sem canvas).
 * Mostra a forma da série recente para leitura rápida da direção.
 */
export function Sparkline(props: { values: number[]; color: string; height?: number }) {
  const W = 100;
  const H = 100;

  const paths = createMemo(() => {
    const v = props.values;
    if (v.length < 2) return { line: "", area: "" };
    const min = Math.min(...v);
    const max = Math.max(...v);
    const range = max - min || 1;
    const step = W / (v.length - 1);
    const pts = v.map((val, i) => {
      const x = i * step;
      const y = H - 4 - ((val - min) / range) * (H - 8); // 4px de respiro topo/base
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    const line = pts.map((p, i) => (i ? "L" : "M") + p).join(" ");
    const area = `${line} L ${W} ${H} L 0 ${H} Z`;
    return { line, area };
  });

  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: `${props.height ?? 38}px`, display: "block" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={props.color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={props.color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={paths().area} fill={`url(#${gradId})`} />
      <path
        d={paths().line}
        fill="none"
        stroke={props.color}
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}
