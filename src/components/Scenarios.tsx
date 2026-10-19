import {
  createEffect,
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import {
  Play,
  Square,
  CalendarClock,
  Droplets,
  Timer,
  AlertTriangle,
  Activity,
  ArrowRight,
  ShieldCheck,
  Plus,
  Check,
  FlaskConical,
  RotateCcw,
  X,
  SlidersHorizontal,
  ArrowLeft,
} from "lucide-solid";
import catalog from "../data/scenarios.json";
import {
  deleteScenarioPlan,
  listScenarioPlans,
  saveScenarioPlan,
  startScenario,
  stopScenario,
  type ScenarioPlan,
  type ScenarioRun,
} from "../services/api";
import styles from "./Scenarios.module.css";
import ValveControl from "./ValveControl";
const Greenhouse3D = lazy(() => import("./Greenhouse3D"));
const labels: Record<ScenarioRun["status"], string> = {
  pending: "Aguardando confirmação",
  running: "Em execução",
  stopping: "Confirmando parada",
  uncertain: "Sem confirmação",
  completed: "Concluído",
  cancelled: "Interrompido",
  failed: "Não executado / falha",
};
export const activeRun = (r: ScenarioRun) =>
  ["pending", "running", "stopping", "uncertain"].includes(r.status);
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
function localInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function Scenarios(props: {
  device: string;
  online: boolean;
  backend: boolean;
  supported: boolean;
  valveSupported: boolean;
  outputs: string[];
  runs: ScenarioRun[];
  refresh: () => Promise<void>;
  flow: boolean;
  demonstration: boolean;
  onDemonstrationChange: (value: boolean) => void;
  emergency: boolean;
}) {
  const [selected, setSelected] = createSignal("cenario-09");
  const [valve, setValve] = createSignal("");
  const [duration, setDuration] = createSignal(300);
  const [plans, setPlans] = createSignal<ScenarioPlan[]>([]);
  const [editing, setEditing] = createSignal("");
  const [name, setName] = createSignal("");
  const [start, setStart] = createSignal(
    localInput(new Date(Date.now() + 3600000)),
  );
  const [repeat, setRepeat] = createSignal<"once" | "daily">("once");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [confirmStart, setConfirmStart] = createSignal(false);
  const [activationMode, setActivationMode] = createSignal<"now" | "schedule">(
    "now",
  );
  const [allHistory, setAllHistory] = createSignal(false);
  const [modalView, setModalView] = createSignal<
    "configure" | "agenda" | "history"
  >("configure");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [step, setStep] = createSignal(0);
  let dialog!: HTMLDialogElement;
  let modalTitle!: HTMLHeadingElement;
  let previousOverflow = "";
  function openModal(
    view: "configure" | "agenda" | "history",
    initialStep = 0,
  ) {
    setModalView(view);
    setStep(initialStep);
    setConfirmStart(false);
    setError("");
    if (!dialog.open) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      setModalOpen(true);
      dialog.showModal();
    } else {
      modalTitle.focus();
    }
  }
  function goStep(value: number) {
    setStep(value);
    setConfirmStart(false);
    modalTitle.focus();
  }
  function closeModal() {
    dialog.close();
  }
  function afterClose() {
    document.body.style.overflow = previousOverflow;
    setModalOpen(false);
    setConfirmStart(false);
  }
  onCleanup(() => {
    if (dialog?.open) document.body.style.overflow = previousOverflow;
  });
  createEffect(() => {
    if (!notice()) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    onCleanup(() => clearTimeout(timer));
  });
  const definition = () => catalog.find((c) => c.id === selected())!;
  const sources = [
    { id: "agua", label: "Água" },
    { id: "ad1", label: "Adubo 1" },
    { id: "ad2", label: "Adubo 2" },
  ];
  const destination = (c: (typeof catalog)[number]) =>
    c.outputs.includes("VG")
      ? c.outputs.includes("VL13")
        ? c.outputs.includes("VL46")
          ? "Todas as linhas"
          : "Linhas 1–3"
        : "Linhas 4–6"
      : "Retorno ao tanque";
  const choose = (id: string) => {
    setSelected(id);
    setConfirmStart(false);
  };
  function chooseSource(source: string) {
    const options = catalog.filter((c) => c.source === source);
    choose(
      (
        options.find((c) => destination(c) === destination(definition())) ??
        options[0]
      ).id,
    );
  }
  const running = () => props.runs.find(activeRun);
  const liveDefinition = () =>
    catalog.find(
      (c) =>
        c.outputs.length === props.outputs.length &&
        c.outputs.every((o) => props.outputs.includes(o)),
    );
  const validDuration = () =>
    Number.isInteger(duration()) && duration() >= 1 && duration() <= 7200;
  const canStart = () =>
    props.backend &&
    props.online &&
    props.supported &&
    !props.emergency &&
    !running() &&
    props.outputs.length === 0 &&
    validDuration();
  const loadPlans = async () => {
    setPlans(await listScenarioPlans(props.device));
    if (error() === "Não foi possível carregar os agendamentos.") setError("");
  };
  onMount(() => {
    void loadPlans().catch(() =>
      setError("Não foi possível carregar os agendamentos."),
    );
    const poll = setInterval(() => {
      void loadPlans().catch(() => {});
    }, 5000);
    onCleanup(() => {
      clearInterval(poll);
    });
  });
  async function action(fn: () => Promise<unknown>, success: string) {
    if (busy()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await props.refresh();
      await loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }
  function edit(p: ScenarioPlan) {
    setActivationMode("schedule");
    setConfirmStart(false);
    setEditing(p.id);
    setSelected(p.scenario_id);
    setDuration(p.duration_sec);
    setName(p.name);
    setStart(localInput(new Date(p.start_at)));
    setRepeat(p.repeat);
    openModal("configure", 2);
  }
  function reset() {
    setEditing("");
    setName("");
    setRepeat("once");
    setStart(localInput(new Date(Date.now() + 3600000)));
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!validDuration()) {
      setError("Duração deve estar entre 1 e 7200 segundos.");
      return;
    }
    await action(async () => {
      await saveScenarioPlan({
        id: editing(),
        device_id: props.device,
        scenario_id: selected(),
        name: name().trim() || definition().name,
        duration_sec: duration(),
        start_at: new Date(start()).toISOString(),
        repeat: repeat(),
        enabled: true,
      });
      reset();
      closeModal();
    }, "Agendamento salvo no servidor.");
  }

  return (
    <div class={styles.page}>
      <Show when={!props.supported}>
        <div class={styles.warning}>
          <AlertTriangle size={18} />
          <span>
            O controlador ainda não anunciou suporte aos cenários. Você pode
            explorar o modelo e preparar horários; a execução exige firmware
            compatível.
          </span>
        </div>
      </Show>
      <Show when={!props.backend || !props.online}>
        <div class={styles.warning} role="status">
          {!props.backend
            ? "Servidor indisponível. Os dados exibidos podem estar desatualizados."
            : "Controlador offline. Não é possível confirmar o estado físico da estufa."}
        </div>
      </Show>
      {/* Toasts flutuantes: mensagens não podem empurrar o modelo nem o painel. */}
      <div class={styles.toasts}>
        <Show when={error() && !modalOpen()}>
          <div class={styles.error} role="alert">
            {error()}
            <button aria-label="Fechar mensagem" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        </Show>
        <Show when={notice()}>
          <div class={styles.notice} role="status">
            {notice()}
          </div>
        </Show>
      </div>
      <div class={styles.workspace}>
        <div class={styles.modelColumn}>
          <Suspense fallback={<p>Preparando visualização…</p>}>
            <Greenhouse3D
              scenario={props.demonstration ? definition() : liveDefinition()}
              outputs={props.outputs}
              demonstration={props.demonstration}
              flowing={props.flow && props.online && props.backend}
              online={props.backend && props.online}
              onValveSelect={setValve}
              selectedValve={valve()}
              valvePanel={
<Show keyed when={valve()}>
        {(target) => (
          <ValveControl
            target={target}
            device={props.device}
            online={props.online}
            backend={props.backend}
            supported={props.valveSupported}
            emergency={props.emergency}
            scenarioActive={!!running()}
            outputs={props.outputs}
            onLive={() => {
              props.onDemonstrationChange(false);
              setError("");
              setNotice("");
            }}
            onClose={() => setValve("")}
            onResult={(message, failed) =>
              failed ? setError(message) : setNotice(message)
            }
          />
        )}
      </Show>
              }
            >
          <div class={styles.actionBar}>
            <button
              class={styles.primary}
              onClick={() => {
                reset();
                setActivationMode("now");
                openModal("configure");
              }}
            >
              <SlidersHorizontal size={16} /> Configurar irrigação
            </button>
            <div>
              <button onClick={() => openModal("agenda")}>
                <CalendarClock size={16} /> Agenda{" "}
                <span>
                  {plans().filter((p) => p.enabled && p.next_at).length}
                </span>
              </button>
              <button
                id="scenario-history"
                onClick={() => openModal("history")}
              >
                <Activity size={16} /> Atividade{" "}
                <span>{props.runs.length}</span>
              </button>
            </div>
          </div>
            </Greenhouse3D>
          </Suspense>
          <Show when={running()}>
            {(r) => (
              <div class={styles.runCard}>
                <div>
                  <strong>
                    {catalog.find((c) => c.id === r().scenario_id)?.name}
                  </strong>
                  <p>
                    {r().message ||
                      "Timer executado pelo controlador. O fechamento da página não interrompe a operação."}
                  </p>
                </div>
                <button
                  class={styles.stop}
                  disabled={busy() || !props.backend}
                  onClick={() =>
                    action(
                      () => stopScenario(props.device, r().id),
                      "Solicitação de parada registrada.",
                    )
                  }
                >
                  <Square size={15} /> Parar cenário
                </button>
              </div>
            )}
          </Show>
        </div>
      </div>
      <dialog
        ref={dialog}
        class={styles.modal}
        aria-labelledby="scenario-dialog-title"
        onClose={afterClose}
        onCancel={(e) => {
          if (busy()) e.preventDefault();
        }}
      >
        <header class={styles.modalHeader}>
          <div>
            <span class={styles.eyebrow}>
              {modalView() === "configure"
                ? editing()
                  ? "EDITAR AGENDAMENTO"
                  : "NOVA IRRIGAÇÃO"
                : "ESTUFA 01"}
            </span>
            <h2 ref={modalTitle} tabIndex={-1} id="scenario-dialog-title">
              {modalView() === "configure"
                ? [
                    "Escolha o percurso",
                    "Defina a duração",
                    "Revise e programe",
                  ][step()]
                : modalView() === "agenda"
                  ? "Agenda de irrigação"
                  : "Atividade da estufa"}
            </h2>
          </div>
          <button
            autofocus
            class={styles.closeModal}
            aria-label="Fechar modal"
            disabled={busy()}
            onClick={closeModal}
          >
            <X size={20} />
          </button>
        </header>
        <Show when={modalView() === "configure"}>
          <nav class={styles.modalSteps} aria-label="Etapas da configuração">
            <For each={["Percurso", "Duração", "Ativação"]}>
              {(label, i) => (
                <button
                  aria-current={step() === i() ? "step" : undefined}
                  disabled={busy() || (i() === 2 && !validDuration())}
                  onClick={() => goStep(i())}
                >
                  <span>{i() + 1}</span>
                  {label}
                </button>
              )}
            </For>
          </nav>
        </Show>
        <div class={styles.modalBody}>
          <Show when={error()}>
            <p class={styles.error} role="alert">
              {error()}
            </p>
          </Show>
          <Show when={modalView() === "configure"}>
            <section class={styles.panel} aria-label="Configurar ativação">
              <div class={styles.configurationGrid}>
                <Show when={step() === 0}>
                  <div class={styles.selectionColumn}>
                    <div class={styles.sourceBar}>
                      <div
                        class={styles.sourceOptions}
                        role="group"
                        aria-label="Origem da irrigação"
                      >
                        <For each={sources}>
                          {(source) => (
                            <button
                              aria-pressed={definition().source === source.id}
                              onClick={() => chooseSource(source.id)}
                            >
                              {source.id === "agua" ? (
                                <Droplets size={18} />
                              ) : (
                                <FlaskConical size={18} />
                              )}
                              <span>{source.label}</span>
                              <Show when={definition().source === source.id}>
                                <Check size={14} />
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class={styles.destinations}>
                      <div class={styles.destinationHeading}>
                        <span class={styles.stepLabel}>Destino</span>
                        <span></span>
                      </div>
                      <div
                        class={styles.destinationOptions}
                        role="group"
                        aria-label="Destino da irrigação"
                      >
                        <For
                          each={catalog.filter(
                            (c) => c.source === definition().source,
                          )}
                        >
                          {(c) => (
                            <button
                              aria-pressed={selected() === c.id}
                              onClick={() => choose(c.id)}
                            >
                              <Show
                                when={c.outputs.includes("VG")}
                                fallback={<RotateCcw size={27} />}
                              >
                                <span
                                  class={styles.bedDiagram}
                                  aria-hidden="true"
                                >
                                  <For each={[0, 1, 2, 3, 4, 5]}>
                                    {(line) => (
                                      <i
                                        data-active={c.outputs.includes(
                                          line < 3 ? "VL13" : "VL46",
                                        )}
                                      />
                                    )}
                                  </For>
                                </span>
                              </Show>
                              <span>
                                <strong>{destination(c)}</strong>
                                <small>
                                  {c.outputs.includes("VG")
                                    ? c.outputs.includes("VL13") &&
                                      c.outputs.includes("VL46")
                                      ? "6 linhas de cultivo"
                                      : "3 linhas de cultivo"
                                    : "Limpeza do sistema"}
                                </small>
                              </span>
                              <span class={styles.selectionMark}>
                                <Show when={selected() === c.id}>
                                  <Check size={12} />
                                </Show>
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                </Show>
                <Show when={step() === 1}>
                  <div class={styles.timingColumn}>
                    <label>
                      Duração (segundos)
                      <input
                        type="number"
                        min="1"
                        max="7200"
                        step="1"
                        value={duration()}
                        onInput={(e) => {
                          setDuration(e.currentTarget.valueAsNumber);
                          setConfirmStart(false);
                        }}
                      />
                    </label>
                    <div class={styles.presets} aria-label="Durações rápidas">
                      <For each={[60, 300, 600, 900]}>
                        {(seconds) => (
                          <button
                            aria-pressed={duration() === seconds}
                            onClick={() => {
                              setDuration(seconds);
                              setConfirmStart(false);
                            }}
                          >
                            {seconds / 60} min
                          </button>
                        )}
                      </For>
                    </div>
                    <p class={styles.hint}>
                      {validDuration()
                        ? `${Math.floor(duration() / 60)} min ${duration() % 60} s · parada automática`
                        : "Informe entre 1 e 7200 segundos."}
                    </p>
                  </div>
                </Show>
                <Show when={step() === 2}>
                  <div class={styles.activationColumn}>
                    <div class={styles.route}>
                      <Droplets size={18} />
                      <div>
                        <small>Origem</small>
                        <strong>
                          {definition().source === "agua"
                            ? "Água"
                            : definition().source === "ad1"
                              ? "Adubo 1"
                              : "Adubo 2"}
                        </strong>
                      </div>
                      <ArrowRight size={16} />
                      <div>
                        <small>Destino</small>
                        <strong>
                          {definition().name.includes("RETORNO")
                            ? "Retorno ao tanque"
                            : definition().name.split("→")[1]}
                        </strong>
                      </div>
                    </div>
                    <p class={styles.durationSummary}>
                      <Timer size={16} /> {Math.floor(duration() / 60)} min{" "}
                      {duration() % 60} s · parada automática
                    </p>
                    <div
                      class={`${styles.segment} ${styles.activationModes}`}
                      aria-label="Quando ativar"
                    >
                      <button
                        aria-pressed={activationMode() === "now"}
                        onClick={() => {
                          setActivationMode("now");
                          setConfirmStart(false);
                        }}
                      >
                        <Play size={14} /> Agora
                      </button>
                      <button
                        aria-pressed={activationMode() === "schedule"}
                        onClick={() => {
                          setActivationMode("schedule");
                          setConfirmStart(false);
                        }}
                      >
                        <CalendarClock size={15} /> Agendar
                      </button>
                    </div>
                    <Show when={activationMode() === "now"}>
                      <Show
                        when={!confirmStart()}
                        fallback={
                          <div
                            class={styles.confirm}
                            role="group"
                            aria-label="Confirmar ativação"
                          >
                            <p>
                              Ativar <strong>{definition().name}</strong> por{" "}
                              <strong>{duration()} segundos</strong>?
                            </p>
                            <div class={styles.actions}>
                              <button
                                disabled={busy() || !canStart()}
                                class={styles.primary}
                                onClick={() =>
                                  action(async () => {
                                    const r = await startScenario(
                                      props.device,
                                      selected(),
                                      duration(),
                                    );
                                    setConfirmStart(false);
                                    props.onDemonstrationChange(false);
                                    if (r.status === "failed")
                                      throw new Error(r.message);
                                    closeModal();
                                  }, "Comando registrado. Acompanhe o estado da execução.")
                                }
                              >
                                Confirmar ativação
                              </button>
                              <button onClick={() => setConfirmStart(false)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <button
                          class={styles.primary}
                          disabled={!canStart() || busy()}
                          onClick={() => setConfirmStart(true)}
                        >
                          <Play size={16} /> Ativar agora
                        </button>
                      </Show>
                      <Show when={!canStart()}>
                        <p class={styles.hint} role="status">
                          {!props.backend
                            ? "Servidor indisponível."
                            : !props.online
                              ? "Controlador offline."
                              : !props.supported
                                ? "O controlador não suporta cenários."
                                : props.emergency
                                  ? "Parada de emergência ativa."
                                  : running()
                                    ? "Aguarde a execução atual terminar."
                                    : props.outputs.length
                                      ? "Feche as válvulas em controle manual antes de iniciar um cenário."
                                      : "Revise a duração."}
                        </p>
                      </Show>
                      <p class={styles.safetyNote}>
                        <ShieldCheck size={15} /> A ativação exige sua
                        confirmação.
                      </p>
                    </Show>
                    <Show when={activationMode() === "schedule"}>
                      <form
                        id="scenario-schedule-form"
                        onSubmit={save}
                        class={styles.scheduleForm}
                      >
                        <label>
                          Nome
                          <input
                            maxLength={120}
                            placeholder={definition().name}
                            value={name()}
                            onInput={(e) => setName(e.currentTarget.value)}
                          />
                        </label>
                        <label>
                          Data e horário local
                          <input
                            type="datetime-local"
                            required
                            value={start()}
                            onInput={(e) => setStart(e.currentTarget.value)}
                          />
                        </label>
                        <label>
                          Repetição
                          <select
                            value={repeat()}
                            onChange={(e) =>
                              setRepeat(
                                e.currentTarget.value as "once" | "daily",
                              )
                            }
                          >
                            <option value="once">Uma vez</option>
                            <option value="daily">
                              Todos os dias (a cada 24 h)
                            </option>
                          </select>
                        </label>
                        <p class={styles.hint}>
                          Horário de{" "}
                          {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                          Requer servidor disponível; horários perdidos ficam no
                          histórico.
                        </p>
                      </form>
                    </Show>
                  </div>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={modalView() === "agenda"}>
            <section class={styles.panel}>
              <div class={styles.panelHeading}>
                <h3>
                  <CalendarClock size={17} /> Agenda{" "}
                  <span class={styles.count}>
                    {plans().filter((p) => p.enabled && p.next_at).length}
                  </span>
                </h3>
                <button
                  class={styles.textButton}
                  onClick={() => {
                    reset();
                    setActivationMode("schedule");
                    openModal("configure");
                  }}
                >
                  <Plus size={14} /> Agendar
                </button>
              </div>
              <Show
                when={plans().length}
                fallback={
                  <p class={styles.empty}>
                    Nenhuma ativação programada. Escolha um cenário e salve um
                    horário.
                  </p>
                }
              >
                <div class={styles.planGrid}>
                  <For each={plans()}>
                    {(p) => (
                      <article class={styles.plan}>
                        <div>
                          <strong>{p.name}</strong>
                          <span>
                            {catalog.find((c) => c.id === p.scenario_id)?.name}
                          </span>
                        </div>
                        <p>
                          {p.enabled && p.next_at
                            ? date(p.next_at)
                            : "Pausado / finalizado"}
                          <br />
                          {p.duration_sec}s ·{" "}
                          {p.repeat === "daily" ? "Diariamente" : "Uma vez"}
                        </p>
                        <div class={styles.actions}>
                          <button disabled={busy()} onClick={() => edit(p)}>
                            Editar
                          </button>
                          <button
                            disabled={busy() || !props.backend}
                            onClick={() =>
                              action(
                                () =>
                                  saveScenarioPlan({
                                    ...p,
                                    enabled: !p.enabled,
                                  }),
                                p.enabled
                                  ? "Agendamento pausado."
                                  : "Agendamento ativado.",
                              )
                            }
                          >
                            {p.enabled ? "Pausar" : "Ativar"}
                          </button>
                          <button
                            disabled={busy() || !props.backend}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Excluir o agendamento “${p.name}”? O histórico será mantido.`,
                                )
                              )
                                void action(
                                  () => deleteScenarioPlan(props.device, p.id),
                                  "Agendamento excluído.",
                                );
                            }}
                          >
                            Excluir
                          </button>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Show>
          <Show when={modalView() === "history"}>
            <section class={styles.panel}>
              <div class={styles.panelHeading}>
                <h3>
                  <Activity size={17} /> Atividade recente
                </h3>
                <span class={styles.count}>{props.runs.length}</span>
              </div>
              <p class={styles.hint}>
                Confirmações do controlador e falhas de execução.
              </p>
              <Show
                when={props.runs.length}
                fallback={
                  <p class={styles.empty}>Nenhuma execução registrada.</p>
                }
              >
                <div class={styles.history}>
                  <For
                    each={allHistory() ? props.runs : props.runs.slice(0, 4)}
                  >
                    {(r) => (
                      <article class={styles.historyRow}>
                        <div>
                          <strong>
                            {catalog.find((c) => c.id === r.scenario_id)
                              ?.name ?? r.scenario_id}
                          </strong>
                          <span>
                            {date(r.due_at)} · {r.duration_sec}s ·{" "}
                            {r.plan_id ? "Agendado" : "Manual"}
                          </span>
                        </div>
                        <span
                          class={`${styles.status} ${r.status === "failed" || r.status === "uncertain" ? styles.bad : r.status === "cancelled" ? styles.neutral : ""}`}
                        >
                          {labels[r.status]}
                        </span>
                        <details class={styles.runDetails}>
                          <summary>Detalhes da execução</summary>
                          <p>
                            {r.message ||
                              (r.status === "completed"
                                ? "Término confirmado pelo controlador."
                                : r.status === "cancelled"
                                  ? "Parada confirmada pelo controlador."
                                  : "Acompanhe a confirmação do controlador.")}
                          </p>
                          <Show when={r.error_code}>
                            <code>{r.error_code}</code>
                          </Show>
                        </details>
                      </article>
                    )}
                  </For>
                </div>
                <Show when={props.runs.length > 4}>
                  <button
                    class={styles.textButton}
                    onClick={() => setAllHistory(!allHistory())}
                  >
                    {allHistory()
                      ? "Mostrar menos"
                      : `Ver histórico completo (${props.runs.length})`}
                  </button>
                </Show>
              </Show>
              <p class={styles.footnote}>
                Sem comunicação, o estado físico da irrigação não pode ser
                confirmado.
              </p>
            </section>
          </Show>
        </div>
        <Show when={modalView() === "configure"}>
          <footer class={styles.modalFooter}>
            <button
              disabled={busy()}
              onClick={() => (step() ? goStep(step() - 1) : closeModal())}
            >
              <ArrowLeft size={15} /> {step() ? "Voltar" : "Cancelar"}
            </button>
            <Show
              when={step() < 2}
              fallback={
                <Show
                  when={activationMode() === "schedule"}
                  fallback={<span>Confira os dados antes de confirmar.</span>}
                >
                  <button
                    type="submit"
                    form="scenario-schedule-form"
                    class={styles.primary}
                    disabled={busy() || !props.backend || !validDuration()}
                  >
                    {editing() ? "Salvar alterações" : "Salvar agendamento"}
                  </button>
                </Show>
              }
            >
              <button
                class={styles.primary}
                disabled={step() === 1 && !validDuration()}
                onClick={() => goStep(step() + 1)}
              >
                Continuar <ArrowRight size={16} />
              </button>
            </Show>
          </footer>
        </Show>
      </dialog>
    </div>
  );
}
