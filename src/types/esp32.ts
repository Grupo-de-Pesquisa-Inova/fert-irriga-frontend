export interface ISensorData {
  clima: {
    temperatura_c: number;
    umidade_pct: number;
    pressao_hpa: number;
  };
  hidraulica: {
    fluxo_detectado: boolean;
    vazao_lpm: number;
  };
}

export interface IConnectionStatus {
  estado: "online" | "offline";
  sinal_wifi_dbm: number;
  tempo_ligado_seg: number;
}

export interface IOperationStatus {
  modo_atual:
    | "stand-by"
    | "irrigacao agendada"
    | "irrigacao telecomandada"
    | "acionamento manual";
  saidas_ativas: string[];
}

export interface ISystemStatus {
  conexao: IConnectionStatus;
  sensores: ISensorData;
  operacao: IOperationStatus;
}

export interface IControlStatus {
  telecomando: {
    irrigacao: {
      conjunto_1: boolean;
      conjunto_2: boolean;
    };
    adubacao: {
      solucao_1: { bag_1: boolean; bag_2: boolean };
      solucao_2: { bag_1: boolean; bag_2: boolean };
    };
  };
  agendamento: {
    irrigacao: {
      conjunto_1: string;
      conjunto_2: string;
    };
    adubacao: {
      sol_1_bag_1: string;
      sol_1_bag_2: string;
      sol_2_bag_1: string;
      sol_2_bag_2: string;
    };
  };
}

export interface ISecurityStatus {
  parada_emergencia: boolean;
  alerta_falha_fluxo: boolean;
}

export interface IPayloadESP32 {
  status_sistema: ISystemStatus;
  controle: IControlStatus;
  seguranca: ISecurityStatus;
}
