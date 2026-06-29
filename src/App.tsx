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
  LayoutDashboard,
  Cpu,
  Menu,
  Waves,
  Leaf,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
} from "lucide-solid";
import type { IPayloadESP32, IControlStatus } from "./types/esp32";
import { createDeviceWebSocket, type ConnectionState } from "./hooks/useDeviceWebSocket";
import { EChart } from "./components/EChart";
import { Sparkline } from "./components/Sparkline";
import { gaugeOption, trendOption, pressureOption, computeVPD, classifyVPD } from "./lib/charts";
import {
  getDevice,
  sendControl,
  emergencyReset,
  createCommand,
  getLatestTelemetry,
  getTelemetryHistory,
  listActiveAlarms,
  ackAlarm,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  enableSchedule,
  disableSchedule,
  type IAlarmEvent,
  type ITelemetryRecord,
  type ISchedule
} from "./services/api";

// ─── Configuração ──────────────────────────────────────
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || "esp32-001";

type Tab = "painel" | "controle" | "alarmes" | "historico" | "agendamentos" | "sistema";

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

// ─── Componente Principal ──────────────────────────────
export default function App() {
  const [isDark, setIsDark] = createSignal(true);
  const [sysData, setSysData] = createSignal<IPayloadESP32>(DEFAULT_PAYLOAD);
  const [backendOnline, setBackendOnline] = createSignal(false);
  // Status real do ESP32 calculado pelo backend (via last_seen), NÃO o campo
  // `conexao.estado` autodeclarado pelo próprio ESP (que congela em "online").
  const [deviceOnline, setDeviceOnline] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [controlError, setControlError] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<Tab>("painel");
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [showVpdInfo, setShowVpdInfo] = createSignal(false);

  // Novos Sinais para as Funcionalidades Adicionais
  const [alarms, setAlarms] = createSignal<IAlarmEvent[]>([]);
  const [telemetryHistory, setTelemetryHistory] = createSignal<ITelemetryRecord[]>([]);

  // Schedule state
  const [schedules, setSchedules] = createSignal<ISchedule[]>([]);
  const [showScheduleModal, setShowScheduleModal] = createSignal(false);
  const [editingSchedule, setEditingSchedule] = createSignal<ISchedule | null>(null);
  const [scheduleForm, setScheduleForm] = createSignal({
    name: '',
    valve_number: 1,
    schedule_type: 'one_time' as string,
    start_at: '',
    duration_sec: 1800,
    is_enabled: true,
  });

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

  // Ao abrir a aba de agendamentos, recarrega os dados.
  createEffect(() => {
    if (activeTab() === "agendamentos") {
      loadSchedules();
    }
  });

  // ─── Enviar controle ao backend ────────────────────
  async function handleControlChange(newControl: IControlStatus) {
    if (!backendOnline()) {
      setControlError("Backend offline. Comando não enviado.");
      return;
    }
    setSending(true);
    setControlError(null);
    try {
      await sendControl(DEVICE_ID, newControl);
    } catch (err) {
      console.error("[API] Erro ao enviar controle:", err);
      setControlError(err instanceof Error ? err.message : "Erro ao enviar comando.");
    } finally {
      setSending(false);
    }
  }

  const controlsDisabled = () =>
    sending() || !backendOnline() || !isOnline() || sysData().seguranca.parada_emergencia;

  async function sendValveCommand(targetChannel: string, desiredState: boolean) {
    if (controlsDisabled()) {
      setControlError("Controle bloqueado: verifique backend, ESP32 e parada de emergência.");
      return;
    }

    setSending(true);
    setControlError(null);
    try {
      await createCommand({
        device_id: DEVICE_ID,
        action: desiredState ? "open_valve" : "close_valve",
        target_channel: targetChannel,
        origin: "web_manual",
        actor: "operator",
      });
      window.setTimeout(fetchAllData, 1200);
    } catch (err) {
      console.error("[API] Erro ao enviar comando manual:", err);
      setControlError(err instanceof Error ? err.message : "Erro ao enviar comando manual.");
    } finally {
      setSending(false);
    }
  }

  function requestValveToggle(label: string, currentValue: boolean, targetChannel: string) {
    const nextValue = !currentValue;
    confirmToggle(label, currentValue, () => {
      void sendValveCommand(targetChannel, nextValue);
    });
  }

  // ─── Parada de Emergência ─────────────────────────
  async function handleEmergencyReset() {
    setSending(true);
    setControlError(null);
    try {
      await emergencyReset(DEVICE_ID);
      window.setTimeout(fetchAllData, 800);
    } catch (err) {
      console.error("[API] Erro ao resetar emergência:", err);
      setControlError(err instanceof Error ? err.message : "Erro ao resetar emergência.");
    } finally {
      setSending(false);
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

  // ─── Schedule Functions ─────────────────────────────
  async function loadSchedules() {
    try {
      const data = await listSchedules();
      setSchedules(data ?? []);
    } catch (err) {
      console.warn("[API] Erro ao buscar agendamentos:", err);
    }
  }

  function resetScheduleForm() {
    setEditingSchedule(null);
    setScheduleForm({
      name: '',
      valve_number: 1,
      schedule_type: 'one_time',
      start_at: '',
      duration_sec: 1800,
      is_enabled: true,
    });
  }

  function openEditSchedule(schedule: ISchedule) {
    setEditingSchedule(schedule);
    setScheduleForm({
      name: schedule.name,
      valve_number: schedule.valve_number,
      schedule_type: schedule.schedule_type,
      start_at: schedule.start_at ?? '',
      duration_sec: schedule.duration_sec,
      is_enabled: schedule.is_enabled,
    });
    setShowScheduleModal(true);
  }

  async function handleScheduleSubmit(e: Event) {
    e.preventDefault();
    const form = scheduleForm();
    const editing = editingSchedule();
    try {
      if (editing) {
        await updateSchedule(editing.id, {
          name: form.name,
          valve_number: form.valve_number,
          schedule_type: form.schedule_type,
          start_at: form.start_at || null,
          duration_sec: form.duration_sec,
          is_enabled: form.is_enabled,
        });
      } else {
        await createSchedule({
          name: form.name,
          valve_number: form.valve_number,
          schedule_type: form.schedule_type,
          start_at: form.start_at || null,
          duration_sec: form.duration_sec,
          is_enabled: form.is_enabled,
        });
      }
      await loadSchedules();
      setShowScheduleModal(false);
      resetScheduleForm();
    } catch (err) {
      console.error("[API] Erro ao salvar agendamento:", err);
    }
  }

  async function handleDeleteSchedule(id: string) {
    if (!confirm('Excluir este agendamento?')) return;
    try {
      await deleteSchedule(id);
      await loadSchedules();
    } catch (err) {
      console.error("[API] Erro ao excluir agendamento:", err);
    }
  }

  async function handleToggleSchedule(schedule: ISchedule) {
    try {
      if (schedule.is_enabled) {
        await disableSchedule(schedule.id);
      } else {
        await enableSchedule(schedule.id);
      }
      await loadSchedules();
    } catch (err) {
      console.error("[API] Erro ao alterar agendamento:", err);
    }
  }

  // Helper para atualizar controle
  function updateControl(updater: (prev: IControlStatus) => IControlStatus) {
    const newControl = updater(sysData().controle);
    setSysData((prev: IPayloadESP32) => ({ ...prev, controle: newControl }));
    handleControlChange(newControl);
  }

  // ─── Atalhos reactivos ────────────────────────────
  const s = () => sysData().status_sistema;
  const c = () => sysData().controle;
  // Verdade do backend (last_seen) — não o `conexao.estado` autodeclarado pelo ESP.
  const isOnline = () => deviceOnline();

  // ─── Derivados para os gráficos do painel ─────────
  const series = (key: "temperatura_c" | "umidade_pct" | "pressao_hpa") =>
    telemetryHistory().map((r) => r[key]);

  // Variação na janela exibida (último - primeiro) para a seta de tendência.
  function trend(key: "temperatura_c" | "umidade_pct" | "pressao_hpa") {
    const v = series(key);
    if (v.length < 2) return { delta: 0, dir: "flat" as const };
    const delta = v[v.length - 1] - v[0];
    const dir = Math.abs(delta) < 0.05 ? "flat" : delta > 0 ? "up" : "down";
    return { delta, dir } as { delta: number; dir: "up" | "down" | "flat" };
  }

  const vpd = () => computeVPD(s().sensores.clima.temperatura_c, s().sensores.clima.umidade_pct);

  // Estado real das 6 saídas físicas do ESP (telecomando).
  const valves = () => {
    const tc = c().telecomando;
    return [
      { label: "Irrigação 1", on: tc.irrigacao.conjunto_1 },
      { label: "Irrigação 2", on: tc.irrigacao.conjunto_2 },
      { label: "Adubação S1·B1", on: tc.adubacao.solucao_1.bag_1 },
      { label: "Adubação S1·B2", on: tc.adubacao.solucao_1.bag_2 },
      { label: "Adubação S2·B1", on: tc.adubacao.solucao_2.bag_1 },
      { label: "Adubação S2·B2", on: tc.adubacao.solucao_2.bag_2 },
    ];
  };

  // ─── Navegação ────────────────────────────────────
  const navItems: { id: Tab; label: string; icon: any }[] = [
    { id: "painel", label: "Painel", icon: LayoutDashboard },
    { id: "controle", label: "Controle & Agenda", icon: Power },
    { id: "alarmes", label: "Alarmes", icon: AlertTriangle },
    { id: "historico", label: "Histórico", icon: FileText },
    { id: "agendamentos", label: "Agendamentos", icon: Calendar },
    { id: "sistema", label: "Sistema", icon: Cpu },
  ];

  const pageMeta: Record<Tab, { title: string; subtitle: string }> = {
    painel: { title: "Painel da Estufa", subtitle: "Telemetria crucial em tempo real" },
    controle: { title: "Controle & Agenda", subtitle: "Telecomando manual e horários locais" },
    alarmes: { title: "Alarmes Operacionais", subtitle: "Supervisão de eventos do dispositivo" },
    historico: { title: "Histórico de Coleta", subtitle: "Leituras de telemetria registradas" },
    agendamentos: { title: "Agendamentos", subtitle: "Executados no ESP32 (RTC) — funcionam mesmo sem internet" },
    sistema: { title: "Sistema & Dispositivo", subtitle: "Diagnóstico do controlador ESP32" },
  };

  function goTo(tab: Tab) {
    setActiveTab(tab);
    setSidebarOpen(false);
  }

  // Selo de variação (seta + delta) usado nos cards do painel.
  const TrendChip = (p: { t: { delta: number; dir: "up" | "down" | "flat" }; unit: string }) => (
    <span class={styles.trendChip} title="Variação na janela exibida">
      {p.t.dir === "up" ? <TrendingUp size={13} /> : p.t.dir === "down" ? <TrendingDown size={13} /> : <Minus size={13} />}
      {(p.t.delta >= 0 ? "+" : "") + p.t.delta.toFixed(1) + p.unit}
    </span>
  );

  return (
    <div class={styles.app}>
      {/* ─── SIDEBAR LATERAL ──────────────────────────── */}
      <Show when={sidebarOpen()}>
        <div class={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      </Show>

      <aside class={`${styles.sidebar} ${sidebarOpen() ? styles.sidebarOpen : ""}`}>
        <div class={styles.brand}>
          <img src="/fertirriga.avif" alt="FertIrriga" class={styles.brandLogo} />
          <div class={styles.brandText}>
            <span class={styles.brandName}>FertIrriga</span>
            <span class={styles.brandSub}>Edge Dashboard</span>
          </div>
        </div>

        <nav class={styles.nav}>
          <For each={navItems}>
            {(item) => {
              const Icon = item.icon;
              return (
                <button
                  class={`${styles.navItem} ${activeTab() === item.id ? styles.navActive : ""}`}
                  onClick={() => goTo(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <Show when={item.id === "alarmes" && alarms().length > 0}>
                    <span class={styles.navBadge}>{alarms().length}</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </nav>

        <div class={styles.sidebarFooter}>
          <div class={`${styles.statusPill} ${isOnline() ? styles.pillOk : styles.pillBad}`}>
            <span class={styles.dot} />
            {isOnline() ? "ESP32 Conectado" : "ESP32 Offline"}
          </div>
          <div class={`${styles.statusPill} ${styles.pillSubtle}`}>
            {connectionState() === "connected" ? <Wifi size={13} /> :
             connectionState() === "connecting" ? <Loader2 size={13} class={styles.spin} /> :
             <WifiOff size={13} />}
            {connectionState() === "connected" ? "Backend Online" :
             connectionState() === "connecting" ? "Conectando…" : "Backend Offline"}
          </div>
          <button class={styles.themeBtn} onClick={() => setIsDark(!isDark())}>
            {isDark() ? <Sun size={16} /> : <Moon size={16} />}
            {isDark() ? "Tema Claro" : "Tema Escuro"}
          </button>
        </div>
      </aside>

      {/* ─── CONTEÚDO PRINCIPAL ───────────────────────── */}
      <main class={styles.main}>
        <header class={styles.topbar}>
          <button class={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <div class={styles.pageTitleArea}>
            <h1 class={styles.pageTitle}>{pageMeta[activeTab()].title}</h1>
            <p class={styles.pageSubtitle}>{pageMeta[activeTab()].subtitle}</p>
          </div>
          <Show when={sending()}>
            <div class={styles.savingChip}><Loader2 size={14} class={styles.spin} /> Enviando…</div>
          </Show>
        </header>

        {/* PARADA DE EMERGÊNCIA (Sempre Visível) */}
        <Show when={sysData().seguranca.parada_emergencia}>
          <div class={styles.alert}>
            <AlertTriangle size={18} />
            <span>PARADA DE EMERGÊNCIA ATIVA — ATUADORES BLOQUEADOS POR SEGURANÇA</span>
            <button class={styles.emergencyResetBtn} onClick={handleEmergencyReset} disabled={sending()}>
              RESETAR SISTEMA
            </button>
          </div>
        </Show>

        {/* ─── PÁGINA 1: PAINEL ───────────────────────── */}
        <Show when={activeTab() === "painel"}>
          {/* Mostradores (gauges) com a telemetria crucial + sparklines */}
          <div class={styles.gaugeGrid}>
            <div class={styles.gaugeCard}>
              <div class={styles.gaugeHead}>
                <Thermometer size={16} /> Temperatura
                <TrendChip t={trend("temperatura_c")} unit="°" />
              </div>
              <div class={styles.gaugeChart}>
                <EChart option={gaugeOption({ value: s().sensores.clima.temperatura_c, min: 0, max: 50, unit: "°", color: "#e68619", dark: isDark() })} class={styles.fill} />
              </div>
              <div class={styles.gaugeBottom}><Sparkline values={series("temperatura_c")} color="#e68619" /></div>
            </div>

            <div class={styles.gaugeCard}>
              <div class={styles.gaugeHead}>
                <Droplets size={16} /> Umidade do Ar
                <TrendChip t={trend("umidade_pct")} unit="%" />
              </div>
              <div class={styles.gaugeChart}>
                <EChart option={gaugeOption({ value: s().sensores.clima.umidade_pct, min: 0, max: 100, unit: "%", color: "#2680eb", dark: isDark() })} class={styles.fill} />
              </div>
              <div class={styles.gaugeBottom}><Sparkline values={series("umidade_pct")} color="#2680eb" /></div>
            </div>

            <div class={styles.gaugeCard}>
              <div class={styles.gaugeHead}>
                <CloudRain size={16} /> Pressão
                <TrendChip t={trend("pressao_hpa")} unit="" />
              </div>
              <div class={styles.gaugeChart}>
                <EChart option={gaugeOption({ value: s().sensores.clima.pressao_hpa, min: 950, max: 1050, unit: "", color: "#9256d9", dark: isDark(), decimals: 0 })} class={styles.fill} />
              </div>
              <div class={styles.gaugeBottom}><Sparkline values={series("pressao_hpa")} color="#9256d9" /></div>
            </div>

            {/* VPD — déficit de pressão de vapor (conforto da planta) */}
            <div class={styles.gaugeCard}>
              <div class={styles.gaugeHead}>
                <Leaf size={16} /> VPD
                <button
                  class={styles.infoBtn}
                  aria-label="O que é VPD?"
                  aria-expanded={showVpdInfo()}
                  onClick={() => setShowVpdInfo((v) => !v)}
                >
                  <Info size={14} />
                </button>
                <Show
                  when={isOnline()}
                  fallback={<span class={styles.trendChip}>Sem dados</span>}
                >
                  <span class={styles.trendChip} style={{ color: classifyVPD(vpd()).color, "border-color": classifyVPD(vpd()).color }}>
                    {classifyVPD(vpd()).label}
                  </span>
                </Show>
              </div>

              <Show when={showVpdInfo()}>
                <div class={styles.infoBackdrop} onClick={() => setShowVpdInfo(false)} />
                <div class={styles.infoPopover} role="dialog" aria-label="Sobre o VPD">
                  <div class={styles.infoTitle}>VPD — Déficit de Pressão de Vapor</div>
                  <p class={styles.infoText}>
                    Mede o “poder de secagem” do ar — é o que governa a transpiração da planta na estufa.
                  </p>
                  <p class={styles.infoText}>
                    Calculado a partir da <strong>temperatura e umidade</strong> que o ESP32 já envia — não é um sensor novo.
                  </p>
                  <div class={styles.infoRanges}>
                    <span><span class={styles.infoDot} style={{ background: "#2680eb" }} /> &lt; 0,8 kPa — úmido demais (risco de fungo)</span>
                    <span><span class={styles.infoDot} style={{ background: "#2d9d78" }} /> 0,8–1,2 kPa — ideal</span>
                    <span><span class={styles.infoDot} style={{ background: "#e68619" }} /> &gt; 1,2 kPa — seco (estresse hídrico)</span>
                  </div>
                </div>
              </Show>

              <div class={styles.gaugeChart}>
                <Show
                  when={isOnline()}
                  fallback={<div class={styles.gaugeEmpty}><span class={styles.gaugeEmptyValue}>—</span><span class={styles.gaugeEmptyHint}>ESP32 offline</span></div>}
                >
                  <EChart option={gaugeOption({ value: vpd(), min: 0, max: 2, unit: "", color: classifyVPD(vpd()).color, dark: isDark(), decimals: 2 })} class={styles.fill} />
                </Show>
              </div>
              <div class={styles.gaugeBottom}><span class={styles.gaugeFootText}>kPa · ideal 0,8–1,2</span></div>
            </div>
          </div>

          {/* Tendência (principal) + Estado hidráulico/válvulas */}
          <div class={styles.dashRow}>
            <div class={styles.panel}>
              <div class={styles.panelHead}>
                <Activity size={16} />
                <span>Tendência — Temperatura × Umidade (tempo real)</span>
              </div>
              <div class={styles.chartMain}>
                <Show
                  when={telemetryHistory().length > 1}
                  fallback={<div class={styles.emptyChart}><Activity size={20} /> Aguardando telemetria do ESP32…</div>}
                >
                  <EChart option={trendOption(telemetryHistory(), isDark())} class={styles.fill} />
                </Show>
              </div>
            </div>

            <div class={styles.panel}>
              <div class={styles.panelHead}>
                <Power size={16} /> Estado Hidráulico
                <span class={styles.panelHint}>{valves().filter((v) => v.on).length}/6 ativas</span>
              </div>
              <div class={styles.panelBody}>
                <div class={styles.valveGrid}>
                  <For each={valves()}>
                    {(v) => (
                      <div
                        class={`${styles.valveItem} ${v.on ? styles.valveOn : ""}`}
                        role="status"
                        aria-label={`${v.label}: ${v.on ? "ligada" : "desligada"}`}
                      >
                        <span class={styles.valveDot} />
                        <span class={styles.valveLabel}>{v.label}</span>
                        <span class={styles.valveState}>{v.on ? "LIGADA" : "—"}</span>
                      </div>
                    )}
                  </For>
                </div>
                <div class={styles.flowNote}>
                  <Waves size={14} />
                  <span>Fluxo / vazão: <strong>sem sensor no ESP32</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Pressão ao longo do tempo */}
          <div class={styles.panel}>
            <div class={styles.panelHead}>
              <CloudRain size={16} />
              <span>Pressão barométrica ao longo do tempo</span>
            </div>
            <div class={styles.chartWide}>
              <Show
                when={telemetryHistory().length > 1}
                fallback={<div class={styles.emptyChart}><Activity size={20} /> Aguardando telemetria do ESP32…</div>}
              >
                <EChart option={pressureOption(telemetryHistory(), isDark())} class={styles.fill} />
              </Show>
            </div>
          </div>
        </Show>

        {/* ─── PÁGINA 2: CONTROLE & AGENDA ────────────── */}
        <Show when={activeTab() === "controle"}>
          <div class={styles.twoCol}>
            {/* Telecomando Manual */}
            <section class={styles.panel}>
              <div class={styles.panelHead}>
                <Power size={16} /> Telecomando Manual
              </div>
              <div class={styles.panelBody}>
                <div class={styles.actionGroup}>
                  <div class={styles.actionTitle}>Irrigação</div>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Válvula 1</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.irrigacao.conjunto_1} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Irrigação Válvula 1", c().telecomando.irrigacao.conjunto_1, "irrigacao_conj1");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Válvula 2</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.irrigacao.conjunto_2} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Irrigação Válvula 2", c().telecomando.irrigacao.conjunto_2, "irrigacao_conj2");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                </div>

                <div class={styles.actionGroup} style={{ "margin-bottom": "0" }}>
                  <div class={styles.actionTitle}>Fertirrigação Soluções</div>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Solução 1 - Válvula 1</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.adubacao.solucao_1.bag_1} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Adubação Solução 1 Válvula 1", c().telecomando.adubacao.solucao_1.bag_1, "adubacao_sol1_bag1");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Solução 1 - Válvula 2</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.adubacao.solucao_1.bag_2} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Adubação Solução 1 Válvula 2", c().telecomando.adubacao.solucao_1.bag_2, "adubacao_sol1_bag2");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Solução 2 - Válvula 1</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.adubacao.solucao_2.bag_1} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Adubação Solução 2 Válvula 1", c().telecomando.adubacao.solucao_2.bag_1, "adubacao_sol2_bag1");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Solução 2 - Válvula 2</span>
                    <div class={styles.toggle}>
                      <input type="checkbox" checked={c().telecomando.adubacao.solucao_2.bag_2} disabled={controlsDisabled()}
                        onClick={(e) => {
                          e.preventDefault();
                          requestValveToggle("Adubação Solução 2 Válvula 2", c().telecomando.adubacao.solucao_2.bag_2, "adubacao_sol2_bag2");
                        }} />
                      <span class={styles.slider}></span>
                    </div>
                  </label>
                </div>
                <Show when={controlError()}>
                  <div class={styles.controlError}>
                    <AlertTriangle size={14} />
                    <span>{controlError()}</span>
                  </div>
                </Show>
                <Show when={controlsDisabled() && !controlError()}>
                  <div class={styles.flowNote}>
                    <Info size={14} />
                    <span>Controle manual indisponível enquanto backend, ESP32 ou segurança não estiverem liberados.</span>
                  </div>
                </Show>
              </div>
            </section>

            {/* Sincronização de Agenda Local */}
            <section class={styles.panel}>
              <div class={styles.panelHead}>
                <Calendar size={16} /> Sincronização de Agenda Local
              </div>
              <div class={styles.panelBody}>
                <div class={styles.actionGroup}>
                  <div class={styles.actionTitle}>Horários de Irrigação</div>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Válvula 1</span>
                    <div class={styles.timeWrapper}>
                      <input type="time" class={styles.timeInput} value={c().agendamento.irrigacao.conjunto_1}
                        onInput={(e) => updateControl((prev) => ({
                          ...prev, agendamento: { ...prev.agendamento, irrigacao: { ...prev.agendamento.irrigacao, conjunto_1: e.currentTarget.value } }
                        }))} />
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Válvula 2</span>
                    <div class={styles.timeWrapper}>
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
                    <span class={styles.switchLabel}>Adubação Solução 1 Válvula 1</span>
                    <div class={styles.timeWrapper}>
                      <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_1_bag_1}
                        onInput={(e) => updateControl((prev) => ({
                          ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_1_bag_1: e.currentTarget.value } }
                        }))} />
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Adubação Solução 1 Válvula 2</span>
                    <div class={styles.timeWrapper}>
                      <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_1_bag_2}
                        onInput={(e) => updateControl((prev) => ({
                          ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_1_bag_2: e.currentTarget.value } }
                        }))} />
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Adubação Solução 2 Válvula 1</span>
                    <div class={styles.timeWrapper}>
                      <input type="time" class={styles.timeInput} value={c().agendamento.adubacao.sol_2_bag_1}
                        onInput={(e) => updateControl((prev) => ({
                          ...prev, agendamento: { ...prev.agendamento, adubacao: { ...prev.agendamento.adubacao, sol_2_bag_1: e.currentTarget.value } }
                        }))} />
                    </div>
                  </label>
                  <label class={styles.switchRow}>
                    <span class={styles.switchLabel}>Adubação Solução 2 Válvula 2</span>
                    <div class={styles.timeWrapper}>
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

        {/* ─── PÁGINA 3: ALARMES ──────────────────────── */}
        <Show when={activeTab() === "alarmes"}>
          <section class={styles.panel}>
            <div class={styles.panelHead}><AlertTriangle size={16} /> Alarmes Ativos no Dispositivo</div>
            <div class={styles.panelBody}>
              <Show
                when={alarms().length > 0}
                fallback={
                  <div class={styles.noAlarms}>
                    <CheckCircle size={16} />
                    <span>Nenhum alarme operacional ativo. Sistema seguro.</span>
                  </div>
                }
              >
                <div class={styles.itemList}>
                  <For each={alarms()}>
                    {(alarm: IAlarmEvent) => {
                      const severity = () => alarm.rule_severity || "info";
                      return (
                        <div class={`${styles.listItem} ${styles[severity()] ?? ""}`}>
                          <div class={styles.itemInfo}>
                            <span class={styles.itemName}>{alarm.rule_name}</span>
                            <span class={styles.itemMeta}>
                              Disparado em: {new Date(alarm.triggered_at).toLocaleTimeString()} · Severidade: {severity().toUpperCase()}
                            </span>
                          </div>
                          <button class={styles.btn} onClick={() => handleAckAlarm(alarm.id)}>
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

        {/* ─── PÁGINA 4: HISTÓRICO ────────────────────── */}
        <Show when={activeTab() === "historico"}>
          <section class={styles.panel}>
            <div class={styles.panelHead}>
              <FileText size={16} /> Leituras dos Sensores (mais recentes primeiro)
              <Show when={histLoading()}><Loader2 size={14} class={styles.spin} style={{ "margin-left": "8px" }} /></Show>
            </div>
            <div class={styles.panelBody}>
              <Show
                when={histRecords().length > 0}
                fallback={
                  <div class={styles.noAlarms} style={{ color: "var(--text-secondary)" }}>
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

        {/* ─── PÁGINA 5: AGENDAMENTOS ─────────────────── */}
        <Show when={activeTab() === "agendamentos"}>
          <section class={styles.panel}>
            <div class={styles.panelHead}>
              <Calendar size={16} /> Agendamentos de Irrigação
              <button
                class={styles.btnPrimary}
                style={{ "margin-left": "auto" }}
                onClick={() => { resetScheduleForm(); setShowScheduleModal(true); }}
              >
                + Novo Agendamento
              </button>
            </div>
            <div class={styles.panelBody}>
              <div class={styles.flowNote} style={{ "margin-top": "0", "margin-bottom": "16px" }}>
                <Cpu size={14} />
                <span>Os agendamentos são sincronizados e executados pelo próprio ESP32 (relógio interno), continuando a disparar mesmo se a internet cair.</span>
              </div>
              <Show
                when={schedules().length > 0}
                fallback={
                  <div class={styles.noAlarms} style={{ color: "var(--text-secondary)" }}>
                    <Calendar size={16} />
                    <span>Nenhum agendamento configurado. Crie um novo agendamento.</span>
                  </div>
                }
              >
                <div class={styles.itemList}>
                  <For each={schedules()}>
                    {(schedule) => (
                      <div class={styles.listItem} style={{ opacity: schedule.is_enabled ? 1 : 0.55 }}>
                        <div class={styles.itemInfo}>
                          <span class={styles.itemName}>{schedule.name}</span>
                          <span class={styles.itemMeta}>
                            Válvula {schedule.valve_number} · {Math.floor(schedule.duration_sec / 60)} min · {schedule.schedule_type === 'recurring' ? 'Recorrente' : 'Único'}
                            {schedule.start_at ? ` · ${new Date(schedule.start_at).toLocaleString()}` : ''}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                          <button
                            class={styles.btn}
                            onClick={() => handleToggleSchedule(schedule)}
                          >
                            {schedule.is_enabled ? 'Desativar' : 'Ativar'}
                          </button>
                          <button class={styles.btn} onClick={() => openEditSchedule(schedule)}>Editar</button>
                          <button class={styles.btnDanger} onClick={() => handleDeleteSchedule(schedule.id)}>
                            Excluir
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </section>
        </Show>

        {/* ─── PÁGINA 6: SISTEMA & DISPOSITIVO ────────── */}
        <Show when={activeTab() === "sistema"}>
          <div class={styles.twoCol}>
            <section class={styles.panel}>
              <div class={styles.panelHead}><Wifi size={16} /> Rede & Controlador</div>
              <div class={styles.panelBody}>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Estado do ESP32</span>
                  <span class={styles.infoValue} style={{ color: isOnline() ? "var(--success)" : "var(--danger)" }}>
                    {isOnline() ? "Conectado" : "Offline"}
                  </span>
                </div>
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
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Conexão ao Backend</span>
                  <span class={styles.infoValue} style={{ color: backendOnline() ? "var(--success)" : "var(--danger)" }}>
                    {connectionState() === "connected" ? "Online" : connectionState() === "connecting" ? "Conectando" : "Offline"}
                  </span>
                </div>
              </div>
            </section>

            <section class={styles.panel}>
              <div class={styles.panelHead}><Settings2 size={16} /> Operação Hidráulica</div>
              <div class={styles.panelBody}>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Modo do Sistema</span>
                  <span class={styles.infoValue} style={{ "text-transform": "uppercase", color: "var(--accent)" }}>
                    {s().operacao.modo_atual}
                  </span>
                </div>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Canais Ativos</span>
                  <span class={styles.infoValue} style={{ "font-size": "13px" }}>
                    {!s().operacao.saidas_ativas || s().operacao.saidas_ativas.length === 0 ? "Nenhum" : s().operacao.saidas_ativas.join(", ")}
                  </span>
                </div>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Detector de Fluxo</span>
                  <span class={styles.infoValue} style={{ color: s().sensores.hidraulica.fluxo_detectado ? "var(--success)" : "var(--text-muted)" }}>
                    {s().sensores.hidraulica.fluxo_detectado ? "ATIVO" : "NULO"}
                  </span>
                </div>
                <div class={styles.infoRow}>
                  <span class={styles.infoLabel}>Identificador do Dispositivo</span>
                  <span class={styles.infoValue}>{DEVICE_ID}</span>
                </div>
              </div>
            </section>
          </div>
        </Show>

        {/* Schedule Modal */}
        <Show when={showScheduleModal()}>
          <div class={styles.modalOverlay} onClick={() => setShowScheduleModal(false)}>
            <div class={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ "max-width": "480px", "text-align": "left", "align-items": "stretch" }}>
              <h3 class={styles.modalTitle}>{editingSchedule() ? 'Editar Agendamento' : 'Novo Agendamento'}</h3>
              <form onSubmit={handleScheduleSubmit} style={{ display: "flex", "flex-direction": "column", gap: "16px", "margin-top": "16px" }}>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class={styles.formLabel}>Nome</label>
                  <input
                    type="text"
                    class={styles.formInput}
                    value={scheduleForm().name}
                    onInput={(e) => setScheduleForm(prev => ({ ...prev, name: e.currentTarget.value }))}
                    required
                    placeholder="Ex: Irrigação Manhã"
                  />
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class={styles.formLabel}>Válvula</label>
                  <select
                    class={styles.formInput}
                    value={scheduleForm().valve_number}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, valve_number: parseInt(e.currentTarget.value) }))}
                  >
                    <option value={1}>Válvula 1</option>
                    <option value={2}>Válvula 2</option>
                    <option value={3}>Válvula 3</option>
                    <option value={4}>Válvula 4</option>
                  </select>
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class={styles.formLabel}>Tipo</label>
                  <select
                    class={styles.formInput}
                    value={scheduleForm().schedule_type}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, schedule_type: e.currentTarget.value }))}
                  >
                    <option value="one_time">Único</option>
                    <option value="recurring">Recorrente</option>
                  </select>
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class={styles.formLabel}>Data/Hora de Início</label>
                  <input
                    type="datetime-local"
                    class={styles.formInput}
                    value={scheduleForm().start_at}
                    onInput={(e) => setScheduleForm(prev => ({ ...prev, start_at: e.currentTarget.value }))}
                  />
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class={styles.formLabel}>Duração (minutos)</label>
                  <input
                    type="number"
                    class={styles.formInput}
                    min="1"
                    max="480"
                    value={Math.floor(scheduleForm().duration_sec / 60)}
                    onInput={(e) => setScheduleForm(prev => ({ ...prev, duration_sec: parseInt(e.currentTarget.value) * 60 }))}
                    required
                  />
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={scheduleForm().is_enabled}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, is_enabled: e.currentTarget.checked }))}
                  />
                  <label class={styles.formLabel}>Ativo</label>
                </div>
                <div style={{ display: "flex", gap: "12px", "justify-content": "flex-end", "margin-top": "8px" }}>
                  <button type="button" class={styles.modalCancelBtn} onClick={() => setShowScheduleModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" class={styles.modalConfirmBtn}>
                    {editingSchedule() ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
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
      </main>
    </div>
  );
}
