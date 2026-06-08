# FertIrriga Frontend

Dashboard web do sistema de fertirrigação automatizada **FertIrriga Edge**. Supervisão em tempo real do controlador ESP32: telemetria de sensores, telecomando manual, agendamentos, alarmes operacionais e histórico de coleta.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | SolidJS |
| Build | Vite 5 |
| Linguagem | TypeScript |
| Ícones | lucide-solid |
| Tempo real | WebSocket |

## Requisitos

- [Bun](https://bun.sh) (ou Node.js 18+)
- Backend [fert-irriga-backend](https://github.com/Grupo-de-Pesquisa-Inova/fert-irriga-backend) em execução

## Setup

```bash
# 1. Instalar dependências
bun install

# 2. (Opcional) configurar variáveis de ambiente
cp .env.example .env

# 3. Rodar em modo desenvolvimento
bun run dev
```

A aplicação sobe em `http://localhost:5173`. O `vite.config.ts` faz proxy de `/api` e `/ws` para o backend em `http://localhost:8080` — ajuste a porta se o seu backend usar outra.

## Scripts

| Comando | Descrição |
|---|---|
| `bun run dev` | Servidor de desenvolvimento com HMR |
| `bun run build` | Build de produção em `dist/` |
| `bun run preview` | Pré-visualização do build de produção |

## Variáveis de ambiente

Veja `.env.example`. Em desenvolvimento, todas podem ficar vazias (o proxy do Vite cobre API e WebSocket). Em produção, aponte `VITE_API_URL` e `VITE_WS_URL` para o backend.

## Estrutura

```
src/
├── App.tsx                  # Componente principal (abas, telemetria, controle)
├── App.module.css           # Estilos
├── hooks/
│   └── useDeviceWebSocket.ts # Conexão WebSocket reativa
├── services/
│   └── api.ts               # Cliente REST do backend
└── types/
    └── esp32.ts             # Tipos do payload do ESP32
```

## Funcionalidades

- **Painel & Telemetria** — leituras de clima e hidráulica em tempo real, com gráfico de tendências.
- **Controle & Agenda** — telecomando manual de válvulas/adubação e sincronização de horários.
- **Alarmes Operacionais** — alarmes ativos do dispositivo com reconhecimento (ACK).
- **Histórico (Coleta de Dados)** — histórico paginado das leituras de sensores persistidas no backend.

## Deploy em produção (Dokploy)

O frontend é servido por **nginx**, que entrega o SPA e faz **proxy reverso** de `/api` e `/ws` para o backend. Assim o navegador fala sempre com a mesma origem — **sem CORS** e **sem precisar rebuildar** quando o backend muda de endereço.

### Build da imagem

O [`Dockerfile`](./Dockerfile) faz o build com Bun e serve com nginx. O destino do backend é definido em runtime pela variável:

| Variável | Exemplo | Observação |
|---|---|---|
| `BACKEND_URL` | `http://fertirriga-backend:8080` | Nome do serviço do backend na rede interna do Docker |

O nginx resolve o backend de forma *lazy* (via DNS interno do Docker), então o container sobe mesmo que o backend ainda não esteja pronto.

### Passos no Dokploy

1. Crie uma **Application** apontando para este repositório (build via `Dockerfile`).
2. Defina `BACKEND_URL` com o nome interno do serviço do backend (ex.: `http://fertirriga-backend:8080`). Garanta que frontend e backend estão na **mesma rede** do Docker/Dokploy.
3. Atribua o **domínio público** (ex.: `app.seu-dominio.com`) — o Traefik do Dokploy cuida do HTTPS automaticamente.
4. Use `CORS_ORIGIN=https://app.seu-dominio.com` na configuração do backend.

Health check do container: `GET /healthz`.

## Licença

[MIT](./LICENSE) © Grupo de Pesquisa Inova
