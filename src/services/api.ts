import type { IControlStatus, IPayloadESP32 } from "../types/esp32";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Generic Request ───────────────────────────────────
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ─── Types ─────────────────────────────────────────────

export interface IDevice {
  id: string;
  device_id: string;
  name: string;
  payload: IPayloadESP32;
  is_online: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface ISite {
  id: string;
  organization_id: string;
  name: string;
  location: string;
  timezone: string;
  created_at: string;
}

export interface IGreenhouse {
  id: string;
  site_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface IZone {
  id: string;
  greenhouse_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface IRecipe {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  recipe_type: string;
  is_active: boolean;
  steps: IRecipeStep[];
  created_at: string;
}

export interface IRecipeStep {
  id: string;
  recipe_id: string;
  step_order: number;
  action: string;
  target_channel: string;
  duration_sec: number;
  parameters: Record<string, unknown>;
  safety_condition: string;
}

export interface ISchedule {
  id: string;
  zone_id: string | null;
  recipe_id: string | null;
  valve_number: number;
  name: string;
  schedule_type: string;
  cron_expression: string;
  start_at: string | null;
  start_window_min: number;
  duration_sec: number;
  origin: string;
  is_enabled: boolean;
  version: number;
  next_execution_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IScheduleRun {
  id: string;
  schedule_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface IManualCommand {
  id: string;
  command_id: string;
  device_id: string;
  origin: string;
  actor: string;
  action: string;
  target_channel: string;
  status: string;
  priority: number;
  requested_at: string;
  dispatched_at: string | null;
  acked_at: string | null;
  created_at: string;
}

export interface IAlarmEvent {
  id: string;
  alarm_rule_id: string;
  device_id: string | null;
  status: string;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  rule_name: string;
  rule_severity: string;
}

export interface IAlarmRule {
  id: string;
  zone_id: string | null;
  name: string;
  condition_type: string;
  channel_key: string;
  threshold_value: number | null;
  severity: string;
  is_enabled: boolean;
}

export interface IAuditEvent {
  id: string;
  event_type: string;
  actor: string;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ITelemetryRecord {
  id: number;
  device_id: string;
  temperatura_c: number;
  umidade_pct: number;
  pressao_hpa: number;
  fluxo_detectado: boolean;
  vazao_lpm: number;
  sinal_wifi_dbm: number;
  recorded_at: string;
}

export interface ITelemetryPage {
  items: ITelemetryRecord[];
  total: number;
  page: number;
  page_size: number;
}

// ─── Devices ───────────────────────────────────────────

export const listDevices = () => request<IDevice[]>("/devices");
export const getDevice = (id: string) => request<IDevice>(`/devices/${id}`);
export const sendControl = (id: string, control: IControlStatus) =>
  request<{ status: string }>(`/devices/${id}/control`, { method: "POST", body: JSON.stringify(control) });
export const emergencyStop = (id: string) =>
  request<{ status: string }>(`/devices/${id}/emergency-stop`, { method: "POST" });

// ─── Telemetry ─────────────────────────────────────────

export const getLatestTelemetry = (id: string, limit = 50) =>
  request<ITelemetryRecord[]>(`/devices/${id}/telemetry/latest?limit=${limit}`);

export const getTelemetryHistory = (id: string, page = 1, pageSize = 20) =>
  request<ITelemetryPage>(`/devices/${id}/telemetry/history?page=${page}&page_size=${pageSize}`);

// ─── Organizations ─────────────────────────────────────

export const listOrganizations = () => request<IOrganization[]>("/organizations");
export const createOrganization = (data: Partial<IOrganization>) =>
  request<IOrganization>("/organizations", { method: "POST", body: JSON.stringify(data) });

// ─── Sites ─────────────────────────────────────────────

export const listSites = (orgId: string) => request<ISite[]>(`/sites?org_id=${orgId}`);

// ─── Greenhouses ───────────────────────────────────────

export const listGreenhouses = (siteId: string) => request<IGreenhouse[]>(`/greenhouses?site_id=${siteId}`);

// ─── Zones ─────────────────────────────────────────────

export const listZones = (ghId: string) => request<IZone[]>(`/zones?greenhouse_id=${ghId}`);

// ─── Recipes ───────────────────────────────────────────

export const listRecipes = (orgId: string) => request<IRecipe[]>(`/recipes?org_id=${orgId}`);
export const getRecipe = (id: string) => request<IRecipe>(`/recipes/${id}`);
export const createRecipe = (data: Partial<IRecipe>) =>
  request<IRecipe>("/recipes", { method: "POST", body: JSON.stringify(data) });
export const deleteRecipe = (id: string) =>
  request<void>(`/recipes/${id}`, { method: "DELETE" });

// ─── Schedules ─────────────────────────────────────────

export const listSchedules = () => request<ISchedule[]>("/schedules");
export const getSchedule = (id: string) => request<ISchedule>(`/schedules/${id}`);
export const createSchedule = (data: Partial<ISchedule>) =>
  request<ISchedule>("/schedules", { method: "POST", body: JSON.stringify(data) });
export const updateSchedule = (id: string, data: Partial<ISchedule>) =>
  request<ISchedule>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteSchedule = (id: string) =>
  request<void>(`/schedules/${id}`, { method: "DELETE" });
export const enableSchedule = (id: string) =>
  request<void>(`/schedules/${id}/enable`, { method: "POST" });
export const disableSchedule = (id: string) =>
  request<void>(`/schedules/${id}/disable`, { method: "POST" });
export const listScheduleRuns = (id: string) => request<IScheduleRun[]>(`/schedules/${id}/runs`);

// ─── Commands ──────────────────────────────────────────

export const listCommands = (deviceId?: string) =>
  request<IManualCommand[]>(`/commands${deviceId ? `?device_id=${deviceId}` : ""}`);
export const createCommand = (data: { device_id: string; action: string; target_channel?: string }) =>
  request<IManualCommand>("/commands", { method: "POST", body: JSON.stringify(data) });

// ─── Alarms ────────────────────────────────────────────

export const listActiveAlarms = () => request<IAlarmEvent[]>("/alarms");
export const listAlarmHistory = () => request<IAlarmEvent[]>("/alarms/history");
export const ackAlarm = (id: string) =>
  request<void>(`/alarms/${id}/ack`, { method: "POST" });
export const listAlarmRules = () => request<IAlarmRule[]>("/alarm-rules");

// ─── Audit ─────────────────────────────────────────────

export const listAuditEvents = () => request<IAuditEvent[]>("/audit");

// ─── System ────────────────────────────────────────────

export const getSystemStatus = () => request<Record<string, string>>("/system/status");
export const healthCheck = () => request<{ status: string }>("/health");
