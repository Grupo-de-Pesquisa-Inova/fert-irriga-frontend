import { onMount, onCleanup, createEffect } from "solid-js";
// Import seletivo (tree-shaking): só os módulos realmente usados, para manter
// o bundle enxuto em vez de puxar o ECharts inteiro.
import * as echarts from "echarts/core";
import { LineChart, GaugeChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

/**
 * Wrapper reativo do Apache ECharts para SolidJS.
 *
 * `option` é lido dentro de um `createEffect`, portanto qualquer signal usado
 * para montar a opção (ex.: telemetria, tema) dispara a re-renderização do
 * gráfico automaticamente.
 */
export function EChart(props: { option: unknown; class?: string }) {
  let el: HTMLDivElement | undefined;
  let chart: echarts.ECharts | undefined;

  onMount(() => {
    chart = echarts.init(el!, undefined, { renderer: "canvas" });

    // Reage a mudanças na opção (telemetria em tempo real, troca de tema…)
    createEffect(() => {
      const opt = props.option;
      chart!.setOption(opt as echarts.EChartsCoreOption, true);
    });

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el!);

    onCleanup(() => {
      ro.disconnect();
      chart?.dispose();
    });
  });

  return <div ref={el} class={props.class} style={{ width: "100%", height: "100%" }} />;
}
