import { createSignal, createEffect, onCleanup } from "solid-js";
import type { IPayloadESP32 } from "../types/esp32";

function getWsBase(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export type ConnectionState = "connecting" | "connected" | "disconnected";

interface UseDeviceWebSocketOptions {
  deviceID: string;
  onPayload?: (payload: IPayloadESP32) => void;
  onEvent?: (type: string, data: unknown) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

/**
 * Primitiva reativa SolidJS para conexão WebSocket com o backend Go.
 * ESP32 → MQTT → Backend Go → WebSocket → SolidJS
 */
export function createDeviceWebSocket(opts: UseDeviceWebSocketOptions) {
  const [connectionState, setConnectionState] = createSignal<ConnectionState>("disconnected");
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let mounted = true;

  const autoReconnect = opts.autoReconnect ?? true;
  const reconnectInterval = opts.reconnectInterval ?? 3000;

  function connect() {
    if (!opts.deviceID || !mounted) return;

    if (ws) {
      ws.close();
    }

    setConnectionState("connecting");
    ws = new WebSocket(`${getWsBase()}/ws/${opts.deviceID}`);

    ws.onopen = () => {
      if (!mounted) return;
      setConnectionState("connected");
      console.log(`[WS] Conectado ao device ${opts.deviceID}`);
    };

    ws.onmessage = (event) => {
      if (!mounted) return;
      try {
        const msg = JSON.parse(event.data);
        // Eventos tipados (device_event, command_status, emergency, alarmes)
        // vêm como {type, data}; telemetria bruta vem como IPayloadESP32 direto.
        if (msg && typeof msg === "object" && "type" in msg && "data" in msg) {
          opts.onEvent?.(msg.type, msg.data);
        } else {
          opts.onPayload?.(msg as IPayloadESP32);
        }
      } catch (err) {
        console.warn("[WS] Payload inválido:", err);
      }
    };

    ws.onclose = (event) => {
      if (!mounted) return;
      setConnectionState("disconnected");
      console.log(`[WS] Desconectado (code: ${event.code})`);

      if (autoReconnect && mounted && event.code !== 1000) {
        reconnectTimer = setTimeout(() => {
          console.log("[WS] Reconectando...");
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = () => {
      if (!mounted) return;
      setConnectionState("disconnected");
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close(1000, "manual disconnect");
  }

  // Auto-connect e cleanup
  connect();

  onCleanup(() => {
    mounted = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close(1000, "component unmounted");
  });

  return {
    connectionState,
    reconnect: connect,
    disconnect,
  };
}
