import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js";
import styles from "./App.module.css";
import {
  Thermometer,
  Droplets,
  CloudRain,
  Activity,
  Moon,
  Sun,
  AlertTriangle,
  Power,
  Calendar,
  Wifi,
  Clock,
  Settings2,
  WifiOff,
  Loader2,
  FileText,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-solid";
import type { IPayloadESP32, IControlStatus } from "./types/esp32";
import { createDeviceWebSocket, type ConnectionState } from "./hooks/useDeviceWebSocket";
import {
  getDevice,
  sendControl,
  emergencyStop,
  getLatestTelemetry,
  getTelemetryHistory,
  listActiveAlarms,
  ackAlarm,
  type IAlarmEvent,
  type ITelemetryRecord
} from "./services/api";

// ─── Configuração ──────────────────────────────────────
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || "esp32-001";

// ─── Estado padrão (fallback quando offline) ───────────
const DEFAULT_PAYLOAD: IPayloadESP32 = {
  status_sistema: {
    conexao: { estado: "offline", sinal_wifi_dbm: 0, tempo_ligado_seg: 0 },
    sensores: {
      clima: { temperatura_c: 0, umidade_pct: 0, pressao_hpa: 0 },
      hidraulica: { fluxo_detectado: false, vazao_lpm: 0 },
    },
    operacao: { modo_atual: "stand-by", saidas_ativas: [] },
  },
  controle: {
    telecomando: {
      irrigacao: { conjunto_1: false, conjunto_2: false },
      adubacao: {
        solucao_1: { bag_1: false, bag_2: false },
        solucao_2: { bag_1: false, bag_2: false },
      },
    },
    agendamento: {
      irrigacao: { conjunto_1: "08:00", conjunto_2: "08:30" },
      adubacao: {
        sol_1_bag_1: "09:00",
        sol_1_bag_2: "09:30",
        sol_2_bag_1: "10:00",
        sol_2_bag_2: "10:30",
      },
    },
  },
  seguranca: { parada_emergencia: false, alerta_falha_fluxo: false },
};

// ─── Helpers ───────────────────────────────────────────
const formatUptime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

// ─── Componente Badge de Conexão ───────────────────────
function ConnectionBadge(props: { state: ConnectionState }) {
  const config = () => {
    switch (props.state) {
      case "connected": return { icon: <Wifi size={12} />, label: "Backend Online", cls: styles.online };
      case "connecting": return { icon: <Loader2 size={12} class={styles.spin} />, label: "Conectando...", cls: styles.connecting };
      case "disconnected": return { icon: <WifiOff size={12} />, label: "Backend Offline", cls: styles.offline };
    }
  };

  return (
    <div class={`${styles.chip} ${config().cls}`}>
      {config().icon}
      <span style={{ "margin-left": "4px" }}>{config().label}</span>
    </div>
  );
}

// ─── Componente Principal ──────────────────────────────
export default function App() {
  const [isDark, setIsDark] = createSignal(true);
  const [sysData, setSysData] = createSignal<IPayloadESP32>(DEFAULT_PAYLOAD);
  const [backendOnline, setBackendOnline] = createSignal(false);
  // Status real do ESP32 calculado pelo backend (via last_seen), NÃO o campo
  // `conexao.estado` autodeclarado pelo próprio ESP (que congela em "online").
  const [deviceOnline, setDeviceOnline] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"painel" | "controle" | "alarmes" | "historico">("painel");

  // Novos Sinais para as Funcionalidades Adicionais
  const [alarms, setAlarms] = createSignal<IAlarmEvent[]>([]);
  const [telemetryHistory, setTelemetryHistory] = createSignal<ITelemetryRecord[]>([]);

  // Histórico de coleta paginado (server-side, independente do gráfico)
  const HISTORY_PAGE_SIZE = 15;
  const [histRecords, setHistRecords] = createSignal<ITelemetryRecord[]>([]);
  const [histPage, setHistPage] = createSignal(1);
  const [histTotal, setHistTotal] = createSignal(0);
  const [histLoading, setHistLoading] = createSignal(false);
  const histTotalPages = () => Math.max(1, Math.ceil(histTotal() / HISTORY_PAGE_SIZE));

  function loadHistoryPage(page: number) {
    setHistLoading(true);
    getTelemetryHistory(DEVICE_ID, page, HISTORY_PAGE_SIZE)
      .then((res) => {
        setHistRecords(res.items ?? []);
        setHistTotal(res.total ?? 0);
        setHistPage(res.page ?? page);
      })
      .catch((err) => console.warn("[API] Erro ao buscar histórico de coleta:", err))
      .finally(() => setHistLoading(false));
  }

  // Sinal e helper para o Modal de Confirmação de UX
  const [confirmDialog, setConfirmDialog] = createSignal<{ title: string; onConfirm: () => void } | null>(null);

  function confirmToggle(label: string, currentValue: boolean, onConfirm: () => void) {
    const actionText = currentValue ? "desligar" : "ligar";
    setConfirmDialog({
      title: `Deseja realmente ${actionText} "${label}"?`,
      onConfirm
    });
  }

  let canvasRef: HTMLCanvasElement | undefined;

  // ─── Theme ─────────────────────────────────────────
  createEffect(() => {
    if (isDark()) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  // ─── Carregar dados iniciais do backend ────────────
  const fetchAllData = () => {
    getDevice(DEVICE_ID)
      .then((device) => {
        setSysData(device.payload);
        setBackendOnline(true);
        setDeviceOnline(device.is_online);
      })
      .catch(() => {
        console.warn("[API] Backend indisponível — usando estado padrão");
        setBackendOnline(false);
        setDeviceOnline(false);
      });

    // Buscar histórico de telemetria
    // (o backend pode responder `null` em vez de `[]` quando não há registros)
    getLatestTelemetry(DEVICE_ID, 20)
      .then((data) => {
        setTelemetryHistory((data ?? []).reverse()); // Ordena cronológico para o gráfico
      })
      .catch((err) => console.warn("[API] Erro ao buscar telemetria:", err));

    // Buscar alarmes ativos
    listActiveAlarms()
      .then((data) => setAlarms(data ?? []))
      .catch((err) => console.warn("[API] Erro ao buscar alarmes:", err));
  };

  onMount(() => {
    fetchAllData();
    // Poll suave a cada 5s para manter alarmes e auditoria atualizados
    const timer = setInterval(fetchAllData, 5000);
    onCleanup(() => clearInterval(timer));
  });

  // ─── WebSocket — telemetria em tempo real ──────────
  const { connectionState } = createDeviceWebSocket({
    deviceID: DEVICE_ID,
    onPayload: (payload) => {
      setSysData(payload);
      // Se chegou telemetria em tempo real, o ESP32 está comprovadamente vivo.
      setDeviceOnline(true);
      // Ao receber dados via WebSocket, append no histórico para atualizar o gráfico instantaneamente
      const newRec: ITelemetryRecord = {
        id: Date.now(),
        device_id: DEVICE_ID,
        temperatura_c: payload.status_sistema.sensores.clima.temperatura_c,
        umidade_pct: payload.status_sistema.sensores.clima.umidade_pct,
        pressao_hpa: payload.status_sistema.sensores.clima.pressao_hpa,
        fluxo_detectado: payload.status_sistema.sensores.hidraulica.fluxo_detectado,
        vazao_lpm: payload.status_sistema.sensores.hidraulica.vazao_lpm,
        sinal_wifi_dbm: payload.status_sistema.conexao.sinal_wifi_dbm,
        recorded_at: new Date().toISOString()
      };
      setTelemetryHistory((prev: ITelemetryRecord[]) => {
        const next = [...prev, newRec];
        if (next.length > 25) next.shift(); // Limita 25 pontos na tela
        return next;
      });
    },
  });

  createEffect(() => {
    setBackendOnline(connectionState() === "connected");
  });

  // Ao abrir a aba de histórico, carrega a primeira página da coleta.
  createEffect(() => {
    if (activeTab() === "historico") {
      loadHistoryPage(1);
    }
  });

  // ─── Enviar controle ao backend ────────────────────
  async function handleControlChange(newControl: IControlStatus) {
    setSysData((prev: IPayloadESP32) => ({ ...prev, controle: newControl }));

    if (!backendOnline()) return;

    setSending(true);
    try {
      await sendControl(DEVICE_ID, newControl);
    } catch (err) {
      console.error("[API] Erro ao enviar controle:", err);
    } finally {
      setSending(false);
    }
  }

  // ─── Parada de Emergência ─────────────────────────
  async function handleEmergencyStop() {
    try {
      await emergencyStop(DEVICE_ID);
      fetchAllData();
    } catch (err) {
      console.error("[API] Erro na parada de emergência:", err);
    }
  }

  // ─── Reconhecer Alarme ────────────────────────────
  async function handleAckAlarm(id: string) {
    try {
      await ackAlarm(id);
      listActiveAlarms().then((data) => setAlarms(data ?? []));
    } catch (err) {
      console.error("[API] Erro ao reconhecer alarme:", err);
    }
  }

  // Helper para atualizar controle
  function updateControl(updater: (prev: IControlStatus) => IControlStatus) {
    const newControl = updater(sysData().controle);
    handleControlChange(newControl);
  }

  // ─── Efeito para desenhar o gráfico HTML Canvas ─────
  createEffect(() => {
    const history = telemetryHistory();
    const tab = activeTab(); // Dependência reativa de aba ativa!
    if (tab !== "painel" || !canvasRef || history.length === 0) return;

    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    // Redimensionamento HD Canvas
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasRef.getBoundingClientRect();
    canvasRef.width = rect.width * dpr;
    canvasRef.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Limpar tela
    ctx.clearRect(0, 0, w, h);

    // Grid e bordas
    ctx.strokeStyle = isDark() ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();
    }

    const paddingLeft = 35;
    const paddingRight = 15;
    const paddingTop = 20;
    const paddingBottom = 20;
    const chartW = w - paddingLeft - paddingRight;
    const chartH = h - paddingTop - paddingBottom;

    const maxTemp = 50;
    const minTemp = 0;
    const maxUmid = 100;
    const minUmid = 0;

    // Helper para mapear coordenadas
    const getX = (index: number) => paddingLeft + (index / (history.length - 1)) * chartW;
    const getY = (val: number, min: number, max: number) => {
      const pct = (val - min) / (max - min);
      return h - paddingBottom - pct * chartH;
    };

    // Desenhar Linha de Temperatura (Laranja)
    ctx.beginPath();
    ctx.strokeStyle = "#ff7a00";
    ctx.lineWidth = 2.5;
    history.forEach((rec: ITelemetryRecord, idx: number) => {
      const x = getX(idx);
      const y = getY(rec.temperatura_c, minTemp, maxTemp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Gradiente abaixo da Temperatura
    const tempGrad = ctx.createLinearGradient(0, paddingTop, 0, h - paddingBottom);
    tempGrad.addColorStop(0, "rgba(255, 122, 0, 0.15)");
    tempGrad.addColorStop(1, "rgba(255, 122, 0, 0.0)");
    ctx.beginPath();
    history.forEach((rec: ITelemetryRecord, idx: number) => {
      const x = getX(idx);
      const y = getY(rec.temperatura_c, minTemp, maxTemp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(getX(history.length - 1), h - paddingBottom);
    ctx.lineTo(getX(0), h - paddingBottom);
    ctx.closePath();
    ctx.fillStyle = tempGrad;
    ctx.fill();

    // Desenhar Linha de Umidade (Azul)
    ctx.beginPath();
    ctx.strokeStyle = "#007aff";
    ctx.lineWidth = 2.5;
    history.forEach((rec: ITelemetryRecord, idx: number) => {
      const x = getX(idx);
      const y = getY(rec.umidade_pct, minUmid, maxUmid);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Gradiente abaixo da Umidade
    const umidGrad = ctx.createLinearGradient(0, paddingTop, 0, h - paddingBottom);
    umidGrad.addColorStop(0, "rgba(0, 122, 255, 0.12)");
    umidGrad.addColorStop(1, "rgba(0, 122, 255, 0.0)");
    ctx.beginPath();
    history.forEach((rec: ITelemetryRecord, idx: number) => {
      const x = getX(idx);
      const y = getY(rec.umidade_pct, minUmid, maxUmid);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(getX(history.length - 1), h - paddingBottom);
    ctx.lineTo(getX(0), h - paddingBottom);
    ctx.closePath();
    ctx.fillStyle = umidGrad;
    ctx.fill();

    // Textos de escala
    ctx.fillStyle = isDark() ? "#8a8a93" : "#71717a";
    ctx.font = "10px monospace";
    ctx.fillText("50°C", 5, paddingTop + 4);
    ctx.fillText("25°C", 5, paddingTop + chartH / 2 + 4);
    ctx.fillText("0°C", 5, h - paddingBottom + 4);
  });

  // ─── Atalhos reactivos ────────────────────────────
  const s = () => sysData().status_sistema;
  const c = () => sysData().controle;
  // Verdade do backend (last_seen) — não o `conexao.estado` autodeclarado pelo ESP.
  const isOnline = () => deviceOnline();

  return (
    <div class={styles.container}>
      {/* HEADER */}
      <header class={styles.header}>
        <div class={styles.titleArea}>
          <div class={styles.logo} style={{ background: "var(--bg-base)" }}>
            <span style={{ "font-size": "20px", "font-weight": "800", color: "var(--fg-base)" }}>FI</span>
          </div>
          <h1 class={styles.title}>FertIrriga Edge Dashboard</h1>
          <div class={`${styles.chip} ${isOnline() ? styles.online : styles.offline}`}>
            <span class={styles.dot} />
            {isOnline() ? "ESP32 Conectado" : "ESP32 Desconectado"}
          </div>
          <ConnectionBadge state={connectionState()} />
        </div>

        <button class={styles.iconBtn} onClick={() => setIsDark(!isDark())} aria-label="Toggle Theme">
          {isDark() ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {/* PARADA DE EMERGÊNCIA (Sempre Visível) */}
      <Show when={sysData().seguranca.parada_emergencia}>
        <div class={styles.alert} style={{ "margin-bottom": "-20px" }}>
          <AlertTriangle size={18} />
          <span>PARADA DE EMERGÊNCIA ATIVA — ATUADORES BLOQUEADOS POR SEGURANÇA</span>
          <button class={styles.emergencyResetBtn} onClick={handleEmergencyStop} disabled={sending()}>
            RESETAR SISTEMA
          </button>
        </div>
      </Show>

      {/* NAVEGAÇÃO POR ABAS (TABS SELECTOR) */}
      <div class={styles.tabsContainer}>
        <button
          class={`${styles.tabBtn} ${activeTab() === "painel" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("painel")}
        >
          <Activity size={16} />
          Painel & Telemetria
        </button>
        <button
          class={`${styles.tabBtn} ${activeTab() === "controle" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("controle")}
        >
          <Power size={16} />
          Controle & Agenda
        </button>
        <button
          class={`${styles.tabBtn} ${activeTab() === "alarmes" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("alarmes")}
        >
          <AlertTriangle size={16} />
          Alarmes Operacionais
          <Show when={alarms().length > 0}>
            <span class={styles.badgeCount}>{alarms().length}</span>
          </Show>
        </button>
        <button
          class={`${styles.tabBtn} ${activeTab() === "historico" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("historico")}
        >
          <FileText size={16} />
          Histórico (Coleta de Dados)
        </button>
      </div>

      {/* ─── ABA 1: PAINEL & TELEMETRIA ────────────────────── */}
      <Show when={activeTab() === "painel"}>
        <section class={styles.sectionWrapper}>
          <div class={styles.sectionHeader}>
            <Activity size={20} />
            Supervisão Física do ESP32
          </div>

          <div class={styles.bentoGrid}>
            {/* Card: Conexão & Uptime */}
            <div class={`${styles.card} ${styles.span2}`}>
              <div class={styles.cardTop}><Wifi size={16} /> Rede & Controlador</div>
              <div style={{ "margin-top": "auto", display: "flex", "flex-direction": "column" }}>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Força do Sinal Wi-Fi</span>
                  <span class={styles.infoValue}>{s().conexao.sinal_wifi_dbm} dBm</span>
                </div>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Uptime do ESP32</span>
                  <span class={styles.infoValue}>
                    <Clock size={14} style={{ display: "inline", "margin-right": "4px", "vertical-align": "-2px" }} />
                    {formatUptime(s().conexao.tempo_ligado_seg)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card: Operação */}
            <div class={`${styles.card} ${styles.span2}`}>
              <div class={styles.cardTop}><Settings2 size={16} /> Operação Hidráulica</div>
              <div style={{ "margin-top": "auto", display: "flex", "flex-direction": "column" }}>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Modo do Sistema</span>
                  <span class={styles.infoValue} style={{ "text-transform": "uppercase", color: "var(--success)" }}>{s().operacao.modo_atual}</span>
                </div>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Canais Ativos</span>
                  <span class={styles.infoValue} style={{ "font-size": "12px" }}>
                    {!s().operacao.saidas_ativas || s().operacao.saidas_ativas.length === 0 ? "Nenhum" : s().operacao.saidas_ativas.join(", ")}
                  </span>
                </div>
              </div>
            </div>

            {/* Sensores Ambientais */}
            <div class={`${styles.card} ${styles.span1}`}>
              <div class={styles.cardTop}><Thermometer size={16} /> Temperatura</div>
              <div class={styles.cardValue}>
                {s().sensores.clima.temperatura_c.toFixed(1)}<span class={styles.cardUnit}>°C</span>
              </div>
            </div>

            <div class={`${styles.card} ${styles.span1}`}>
              <div class={styles.cardTop}><Droplets size={16} /> Umidade do Ar</div>
              <div class={styles.cardValue}>
                {s().sensores.clima.umidade_pct.toFixed(1)}<span class={styles.cardUnit}>%</span>
              </div>
            </div>

            <div class={`${styles.card} ${styles.span1}`}>
              <div class={styles.cardTop}><CloudRain size={16} /> Pressão barométrica</div>
              <div class={styles.cardValue}>
                {s().sensores.clima.pressao_hpa.toFixed(1)}<span class={styles.cardUnit}>hPa</span>
              </div>
            </div>

            {/* Detector de Fluxo */}
            <div class={`${styles.card} ${styles.span1}`}>
              <div class={styles.cardTop}><Activity size={16} /> Fluxo Hidráulico</div>
              <div class={styles.cardValue} style={{ color: s().sensores.hidraulica.fluxo_detectado ? "var(--success)" : "inherit" }}>
                {s().sensores.hidraulica.fluxo_detectado ? "ATIVO" : "NULO"}
                <span class={styles.cardUnit}>{s().sensores.hidraulica.vazao_lpm.toFixed(1)} L/m</span>
              </div>
            </div>
          </div>
        </section>

        {/* GRÁFICOS DE TELEMETRIA CANVAS */}
        <section class={styles.sectionWrapper} style={{ "margin-top": "24px" }}>
          <div class={styles.sectionHeader}>
            <Activity size={20} />
            Gráfico de Histórico e Tendências (Tempo Real)
          </div>
          <div class={styles.card} style={{ width: "100%", padding: "20px" }}>
            <div style={{ display: "flex", gap: "20px", "font-size": "13px", "font-weight": "600", "margin-bottom": "8px" }}>
              <span style={{ color: "#ff7a00" }}>● Temperatura (°C)</span>
              <span style={{ color: "#007aff" }}>● Umidade do Ar (%)</span>
            </div>
            <div class={styles.chartContainer}>
              <canvas ref={canvasRef} class={styles.chartCanvas}></canvas>
            </div>
          </div>
        </section>
      </Show>

      {/* ─── ABA 2: CONTROLE & AGENDA ─────────────────────── */}
      <Show when={activeTab() === "controle"}>
        <div style={{ display: "grid", "grid-template-columns": "repeat(2, 1fr)", gap: "24px" }}>
          {/* Telecomando Manual */}
          <section class={styles.sectionWrapper}>
            <div class={styles.sectionHeader}>
              <Power size={20} />
              Telecomando Manual
              <Show when={sending()}><Loader2 size={16} class={styles.spin} style={{ "margin-left": "8px" }} /></Show>
            </div>

            <div class={styles.card}>
              <div class={styles.actionGroup}>
                <div class={styles.actionTitle}>Irrigação</div>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Conjunto de válvulas - Bag 1</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.irrigacao.conjunto_1}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.irrigacao.conjunto_1;
                        confirmToggle("Irrigação do Conjunto Bag 1", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, irrigacao: { ...prev.telecomando.irrigacao, conjunto_1: checked } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Conjunto de válvulas - Bag 2</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.irrigacao.conjunto_2}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.irrigacao.conjunto_2;
                        confirmToggle("Irrigação do Conjunto Bag 2", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, irrigacao: { ...prev.telecomando.irrigacao, conjunto_2: checked } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
              </div>

              <div class={styles.actionGroup} style={{ "margin-bottom": "0" }}>
                <div class={styles.actionTitle}>Fertirrigação Soluções</div>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação Ativa - Solução 1 Bag 1</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.adubacao.solucao_1.bag_1}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.adubacao.solucao_1.bag_1;
                        confirmToggle("Adubação com Solução 1 no Bag 1", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, adubacao: { ...prev.telecomando.adubacao, solucao_1: { ...prev.telecomando.adubacao.solucao_1, bag_1: checked } } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação Ativa - Solução 1 Bag 2</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.adubacao.solucao_1.bag_2}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.adubacao.solucao_1.bag_2;
                        confirmToggle("Adubação com Solução 1 no Bag 2", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, adubacao: { ...prev.telecomando.adubacao, solucao_1: { ...prev.telecomando.adubacao.solucao_1, bag_2: checked } } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação Ativa - Solução 2 Bag 1</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.adubacao.solucao_2.bag_1}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.adubacao.solucao_2.bag_1;
                        confirmToggle("Adubação com Solução 2 no Bag 1", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, adubacao: { ...prev.telecomando.adubacao, solucao_2: { ...prev.telecomando.adubacao.solucao_2, bag_1: checked } } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação Ativa - Solução 2 Bag 2</span>
                  <div class={styles.toggle}>
                    <input type="checkbox" checked={c().telecomando.adubacao.solucao_2.bag_2}
                      onClick={(e) => {
                        e.preventDefault();
                        const checked = !c().telecomando.adubacao.solucao_2.bag_2;
                        confirmToggle("Adubação com Solução 2 no Bag 2", !checked, () => {
                          updateControl((prev) => ({
                            ...prev, telecomando: { ...prev.telecomando, adubacao: { ...prev.telecomando.adubacao, solucao_2: { ...prev.telecomando.adubacao.solucao_2, bag_2: checked } } }
                          }));
                        });
                      }} />
                    <span class={styles.slider}></span>
                  </div>
                </label>
              </div>
            </div>
          </section>

          {/* Sincronização de Agenda Local */}
          <section class={styles.sectionWrapper}>
            <div class={styles.sectionHeader}>
              <Calendar size={20} />
              Sincronização de Agenda Local
            </div>
            <div class={styles.card}>
              <div class={styles.actionGroup}>
                <div class={styles.actionTitle}>Horários de Irrigação</div>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Válvulas Bag 1</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.irrigacao.conjunto_1}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, irrigacao: { ...prev.agendamento.irrigacao, conjunto_1: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Válvulas Bag 2</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.irrigacao.conjunto_2}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, irrigacao: { ...prev.agendamento.irrigacao, conjunto_2: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
              </div>

              <div class={styles.actionGroup} style={{ "margin-bottom": "0" }}>
                <div class={styles.actionTitle}>Programação de Fertirrigação</div>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação com Solução 1 Bag 1</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_1_bag_1}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_1_bag_1: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação com Solução 1 Bag 2</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_1_bag_2}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_1_bag_2: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação com Solução 2 Bag 1</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_2_bag_1}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_2_bag_1: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
                <label class={styles.switchRow}>
                  <span class={styles.switchLabel}>Adubação com Solução 2 Bag 2</span>
                  <div class={styles.timeWrapper}>
                    <Clock size={16} />
                    <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_2_bag_2}
                      onInput={(e) => updateControl((prev) => ({
                        ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_2_bag_2: e.currentTarget.value } }
                      }))} />
                  </div>
                </label>
              </div>
            </div>
          </section>
        </div>
      </Show>

      {/* ─── ABA 3: ALARMES OPERACIONAIS ─────────────────── */}
      <Show when={activeTab() === "alarmes"}>
        <section class={styles.sectionWrapper}>
          <div class={styles.sectionHeader}>
            <AlertTriangle size={20} />
            Supervisão de Alarmes
          </div>
          <div class={styles.card} style={{ "min-height": "320px" }}>
            <div class={styles.actionTitle}>Alarmes Ativos no Dispositivo</div>
            
            <Show
              when={alarms().length > 0}
              fallback={
                <div class={styles.noAlarms}>
                  <CheckCircle size={16} />
                  <span>Nenhum alarme operacional ativo. Sensor seguro.</span>
                </div>
              }
            >
              <div class={styles.alarmList}>
                <For each={alarms()}>
                  {(alarm: IAlarmEvent) => {
                    const severity = () => alarm.rule_severity || "info";
                    return (
                    <div class={`${styles.alarmItem} ${styles[severity()] ?? ""}`}>
                      <div class={styles.alarmInfo}>
                        <span class={styles.alarmRuleName}>{alarm.rule_name}</span>
                        <span class={styles.alarmMeta}>
                          Disparado em: {new Date(alarm.triggered_at).toLocaleTimeString()} · Severidade: {severity().toUpperCase()}
                        </span>
                      </div>
                      <button class={styles.alarmAckBtn} onClick={() => handleAckAlarm(alarm.id)}>
                        Reconhecer
                      </button>
                    </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </section>
      </Show>

      {/* ─── ABA 4: HISTÓRICO (COLETA DE DADOS) ──────────── */}
      <Show when={activeTab() === "historico"}>
        <section class={styles.sectionWrapper}>
          <div class={styles.sectionHeader}>
            <FileText size={20} />
            Histórico de Coleta de Telemetria
          </div>
          <div class={styles.card} style={{ "min-height": "420px" }}>
            <div class={styles.actionTitle}>
              Leituras dos Sensores Enviadas pelo ESP32 (mais recentes primeiro)
              <Show when={histLoading()}><Loader2 size={14} class={styles.spin} style={{ "margin-left": "8px" }} /></Show>
            </div>

            <Show
              when={histRecords().length > 0}
              fallback={
                <div class={styles.noAlarms}>
                  <Activity size={16} />
                  <span>Nenhuma leitura coletada ainda. Aguardando telemetria do ESP32.</span>
                </div>
              }
            >
              <div class={styles.dataTableWrap}>
                <table class={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Horário</th>
                      <th>Temp. (°C)</th>
                      <th>Umidade (%)</th>
                      <th>Pressão (hPa)</th>
                      <th>Fluxo</th>
                      <th>Vazão (L/m)</th>
                      <th>Wi-Fi (dBm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={histRecords()}>
                      {(rec: ITelemetryRecord) => (
                        <tr>
                          <td>{new Date(rec.recorded_at).toLocaleString()}</td>
                          <td>{rec.temperatura_c.toFixed(1)}</td>
                          <td>{rec.umidade_pct.toFixed(1)}</td>
                          <td>{rec.pressao_hpa.toFixed(1)}</td>
                          <td class={rec.fluxo_detectado ? styles.flowYes : styles.flowNo}>
                            {rec.fluxo_detectado ? "ATIVO" : "—"}
                          </td>
                          <td>{rec.vazao_lpm.toFixed(1)}</td>
                          <td>{rec.sinal_wifi_dbm}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>

              <div class={styles.pagination}>
                <span class={styles.paginationInfo}>
                  {histTotal()} leituras · Página {histPage()} de {histTotalPages()}
                </span>
                <div class={styles.paginationControls}>
                  <button
                    class={styles.pageBtn}
                    disabled={histPage() <= 1 || histLoading()}
                    onClick={() => loadHistoryPage(histPage() - 1)}
                  >
                    <ChevronLeft size={16} /> Anterior
                  </button>
                  <button
                    class={styles.pageBtn}
                    disabled={histPage() >= histTotalPages() || histLoading()}
                    onClick={() => loadHistoryPage(histPage() + 1)}
                  >
                    Próxima <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </section>
      </Show>

      {/* MODAL DE CONFIRMAÇÃO DE CONTROLE */}
      <Show when={confirmDialog()} keyed>
        {(dialog) => (
          <div class={styles.modalOverlay}>
            <div class={styles.modalContent}>
              <AlertTriangle size={32} class={styles.modalIcon} />
              <h3 class={styles.modalTitle}>Confirmar Comando Manual</h3>
              <p class={styles.modalText}>{dialog.title}</p>
              <div class={styles.modalActions}>
                <button class={styles.modalCancelBtn} onClick={() => setConfirmDialog(null)}>
                  Cancelar
                </button>
                <button class={styles.modalConfirmBtn} onClick={() => {
                  dialog.onConfirm();
                  setConfirmDialog(null);
                }}>
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
