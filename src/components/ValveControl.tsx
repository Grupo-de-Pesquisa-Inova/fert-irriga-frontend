import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AlertTriangle, Check, Droplets, Loader2, X } from "lucide-solid";
import {
  createCommand,
  getCommand,
  type IManualCommand,
} from "../services/api";
import styles from "./Scenarios.module.css";

export default function ValveControl(props: {
  target: string;
  device: string;
  online: boolean;
  backend: boolean;
  supported: boolean;
  emergency: boolean;
  scenarioActive: boolean;
  outputs: string[];
  onLive: () => void;
  onClose: () => void;
  onResult: (message: string, failed: boolean) => void;
}) {
  let closeButton!: HTMLButtonElement;
  const initial = props.outputs.includes(props.target);
  const desired = !initial;
  const verb = desired ? "Abrir" : "Fechar";
  const [phase, setPhase] = createSignal<
    "confirm" | "waiting" | "success" | "error"
  >("confirm");
  const [message, setMessage] = createSignal("");
  const [receipt, setReceipt] = createSignal<IManualCommand>();
  let poll: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let polling = false;
  let deadline = 0;
  const blocked = () =>
    !props.backend
      ? "Servidor indisponível."
      : !props.online
        ? "Controlador offline. Aguarde a reconexão."
        : !props.supported
          ? "O firmware precisa suportar o acionamento individual das válvulas do modelo."
          : props.emergency
            ? "Parada de emergência ativa."
            : props.scenarioActive || props.outputs.includes("M")
              ? "Encerre a execução e pare a bomba antes de alterar uma válvula individualmente."
              : props.outputs.includes(props.target) !== initial
                ? "O estado da válvula mudou. Feche este aviso e selecione-a novamente."
                : "";
  const finish = (state: "success" | "error", text: string) => {
    clearInterval(poll);
    setPhase(state);
    setMessage(text);
    props.onResult(text, state === "error");
  };
  createEffect(() => {
    if (
      phase() === "waiting" &&
      receipt()?.status === "executed" &&
      props.online &&
      props.backend &&
      props.outputs.includes(props.target) === desired
    ) {
      finish(
        "success",
        `Válvula ${props.target} ${desired ? "aberta" : "fechada"}. Estado confirmado pelo controlador.`,
      );
    }
  });
  onMount(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase() !== "waiting") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", escape);
    onCleanup(() => {
      disposed = true;
      clearInterval(poll);
      window.removeEventListener("keydown", escape);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  });
  async function check() {
    if (polling || !receipt() || disposed) return;
    if (Date.now() >= deadline) {
      finish(
        "error",
        "Sem confirmação do controlador. O comando pode ter sido aplicado; confira a conexão e o estado ao vivo antes de tentar novamente.",
      );
      return;
    }
    polling = true;
    try {
      const command = await getCommand(receipt()!.id);
      if (disposed || phase() !== "waiting") return;
      setReceipt(command);
      if (
        ["rejected", "failed", "conflicted", "expired"].includes(command.status)
      ) {
        finish(
          "error",
          command.result?.message ||
            "O controlador não confirmou o acionamento. Confira a telemetria.",
        );
      }
    } catch {
      /* Retry status only, never resend a physical command automatically. */
    } finally {
      polling = false;
    }
  }
  async function confirm() {
    if (phase() !== "confirm" || blocked()) return;
    setPhase("waiting");
    props.onLive();
    deadline = Date.now() + 25000;
    try {
      const command = await createCommand({
        device_id: props.device,
        action: desired ? "open_valve" : "close_valve",
        target_channel: props.target,
        parameters: { expected_state: initial },
        origin: "web_manual",
        actor: "web_3d",
      });
      if (disposed) return;
      setReceipt(command);
      if (phase() === "waiting") {
        poll = setInterval(() => void check(), 1000);
        void check();
      }
    } catch (e) {
      if (!disposed)
        finish(
          "error",
          `${e instanceof Error ? e.message : "Falha no envio."} Confira o estado ao vivo antes de repetir o comando.`,
        );
    }
  }
  return (
    <section
      class={styles.valvePanel}
      role="dialog"
      aria-modal="false"
      aria-labelledby="valve-dialog-title"
    >
      <header class={styles.modalHeader}>
        <div>
          <span class={styles.eyebrow}>CONTROLE MANUAL · ACIONAMENTO REAL</span>
          <h2 id="valve-dialog-title">
            {phase() === "success"
              ? "Acionamento confirmado"
              : `${verb} válvula ${props.target}?`}
          </h2>
        </div>
        <button
          ref={closeButton}
          class={styles.closeModal}
          aria-label="Fechar aviso da válvula"
          disabled={phase() === "waiting"}
          onClick={props.onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div class={`${styles.modalBody} ${styles.valveDialogBody}`}>
        <div class={styles.valveIdentity}>
          <Droplets size={26} />
          <strong>{props.target}</strong>
          <span>
            {props.online && props.backend
              ? props.outputs.includes(props.target)
                ? "Aberta agora"
                : "Fechada agora"
              : "Estado indisponível"}
          </span>
        </div>
        <Show when={phase() === "confirm"}>
          <p>
            Deseja realmente {desired ? "abrir" : "fechar"} esta válvula na
            estufa?
          </p>
          <p class={styles.hint}>
            Esta ação envia um comando ao controlador. Apenas {props.target}{" "}
            será alterada; a bomba não será ligada.
          </p>
          <Show when={blocked()}>
            <p class={styles.error} role="alert">
              <AlertTriangle size={17} />
              {blocked()}
            </p>
          </Show>
        </Show>
        <Show when={phase() === "waiting"}>
          <p class={styles.valveFeedback} role="status">
            <Loader2 size={18} />
            Aguardando confirmação do controlador…
          </p>
          <p class={styles.hint}>
            O modelo será atualizado pela telemetria recebida da estufa.
          </p>
        </Show>
        <Show when={phase() === "success" || phase() === "error"}>
          <p
            class={styles.valveFeedback}
            role={phase() === "error" ? "alert" : "status"}
          >
            {phase() === "success" ? (
              <Check size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
            {message()}
          </p>
        </Show>
      </div>
      <footer class={styles.modalFooter}>
        <button disabled={phase() === "waiting"} onClick={props.onClose}>
          {phase() === "confirm" ? "Cancelar" : "Fechar"}
        </button>
        <Show when={phase() === "confirm"}>
          <button
            class={styles.primary}
            disabled={!!blocked()}
            onClick={confirm}
          >
            Sim, {desired ? "abrir" : "fechar"} {props.target}
          </button>
        </Show>
      </footer>
    </section>
  );
}
