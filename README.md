# crypto-demo

A privacy-focused cryptocurrency payment platform supporting **BTC, LTC, and XMR**. Inspired by Njalla — no emails, no KYC, mnemonic-only account recovery. Users sign up, deposit any supported coin, and accumulate a balance.

Everything runs inside a local **k3d** (Kubernetes-in-Docker) cluster that simulates a 3-node VPS topology. Zero cloud accounts required.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
└─────────────────────┬────────────────────────────────────────────┘
                      │ HTTP :8080
         ┌────────────▼────────────┐
         │  Traefik Ingress (k3d)  │  ← gateway node
         └──────┬──────────┬───────┘
                │          │
   ┌────────────▼──┐   ┌───▼─────────────┐
   │  Astro (web)  │   │  NestJS (api)   │  ← web / api nodes
   │  SSR, Node    │   │  REST + Prisma  │
   └───────────────┘   └──────┬──────────┘
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
 ┌──────▼──────┐   ┌──────────▼───────┐   ┌─────────▼────────┐
 │  PostgreSQL │   │      Redis       │   │   NBXplorer      │
 │  (Prisma)   │   │  (price cache)   │   │  BTC + LTC index │
 └─────────────┘   └──────────────────┘   └──────┬───────────┘
                                                  │
                                     ┌────────────▼───────────┐
                                     │  bitcoind   litecoind  │
                                     │  (pruned mainnet)      │
                                     └────────────────────────┘
        ┌─────────────────────────────────────────────────────┐
        │  monero-wallet-rpc  →  Tor  →  remote onion monerod │
        └─────────────────────────────────────────────────────┘
```

**Nodes (simulated VPS servers)**

| k3d node | role label | workloads |
|---|---|---|
| `k3d-crypto-server-0` | `gateway` | Traefik ingress |
| `k3d-crypto-agent-0` | `web` | Astro SSR |
| `k3d-crypto-agent-1` | `api` | NestJS, PostgreSQL, Redis, blockchain stack |

---

## Features

- **Auth** — username/password signup and login; JWT in an `httpOnly` cookie; mnemonic-based account recovery (no email required)
- **Multi-coin deposits** — BTC and LTC via HD wallet derivation (BIP84 native SegWit) tracked by NBXplorer; XMR via a dedicated subaddress per invoice using monero-wallet-rpc
- **Privacy** — CoinGecko price fetches routed through Tor; XMR daemon connects to remote onion nodes with automatic failover across 3 nodes; no third-party payment processor
- **Invoice lifecycle** — 30-minute TTL, 1 pending invoice per user per currency, expiry enforced by a cron job; BTC/LTC confirmed after 3+ on-chain confirmations
- **Rate limiting** — global 120 req/min; auth endpoints (login, signup, recover) further limited to 10 req/15 min to prevent brute force
- **Balance tracking** — separate balances for satoshis, litoshi, and piconero; exchange rates from CoinGecko with Redis → Postgres → hardcoded fallback chain
- **Soft delete** — settled transactions can be hidden from the UI; the row is retained with a `deletedAt` timestamp for auditing

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | Astro 5 (SSR, Node adapter) |
| Styling | Tailwind CSS v4 + DaisyUI v5 |
| Backend | NestJS 10, Passport JWT, `@nestjs/throttler` |
| ORM | Prisma 6, PostgreSQL 16 |
| Cache | Redis 7 |
| BTC / LTC | Bitcoin Core 29 + Litecoin Core 0.21 (pruned mainnet), NBXplorer 2.6 |
| XMR | monero-wallet-rpc 0.18, remote onion monerod via Tor |
| Privacy | Tor (SOCKS5 + Privoxy), HD wallet (no xpub reuse) |
| Orchestration | k3d (k3s in Docker), kubectl |
| Language | TypeScript throughout |

---

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| Node.js ≥ 20 | Build + local dev | [nodejs.org](https://nodejs.org) |
| pnpm 9 | Package manager | `npm i -g pnpm@9` |
| Docker Desktop | Everything | [docker.com](https://www.docker.com/products/docker-desktop/) |
| k3d ≥ 5 | k3s cluster in Docker (k3d only) | `winget install k3d` / [k3d.io](https://k3d.io) |
| kubectl | Cluster management (k3d only) | bundled with Docker Desktop |

---

## Running locally

There are two ways depending on what you need.

---

### Way 1 — Local dev (fast, recommended for development)

Runs only Postgres + Redis in Docker. API and web run with hot reload via `pnpm dev`. No Kubernetes, no blockchain nodes.

**1. Start the database**

```bash
pnpm db:up
```

**2. Install dependencies**

```bash
pnpm install
```

**3. Create the database schema** (first time only — migration files are not committed)

```bash
pnpm db:migrate --name init
```

**4. Start everything in watch mode**

```bash
pnpm dev
```

| Service | URL |
|---|---|
| Web | http://localhost:4321 |
| API | http://localhost:3000 |

The `apps/api/.env` file has working defaults for this setup. `BTC_XPUB`, `LTC_XPUB`, and `XMR_DAEMON_NODES` are intentionally left empty — deposit creation for those currencies will fail gracefully, which is fine for auth and UI development.

---

### Way 2 — Full k3d cluster (production simulation)

Runs the complete stack inside a local Kubernetes cluster, matching the production topology exactly.

**1. Create your secrets files** (first time only)

```bash
# Postgres / JWT
cp infra/postgres/secret.env.example infra/postgres/secret.env
# Edit secret.env — set POSTGRES_PASSWORD and JWT_SECRET to real values

# Wallet credentials (xpubs, RPC passwords, XMR daemon nodes)
cp infra/wallet/secret.yaml.example infra/wallet/secret.yaml
# Edit secret.yaml — fill in BTC_XPUB, LTC_XPUB, RPC passwords, XMR_DAEMON_NODES
```

**2. Create the database migration** (first time only)

```bash
pnpm install
pnpm db:migrate --name init
```

**3. Start the cluster**

```bash
pnpm cluster:up
```

The script will:
1. Create a 3-node k3d cluster named `crypto`
2. Label nodes with simulated VPS roles (`gateway` / `web` / `api`)
3. Build Docker images for the API and web app
4. Import them into the cluster (no registry needed)
5. Apply all Kubernetes manifests
6. Wait for core services to be ready

| Service | URL |
|---|---|
| Web | http://localhost:8080 |
| API | http://localhost:8080/api/health |

**4. Tear it down**

```bash
pnpm cluster:down   # deletes the cluster; all data is lost
```

**Note on BTC/LTC sync:** On first boot, `bitcoind` and `litecoind` begin syncing the mainnet chain from scratch. This takes **24–48 hours for BTC** and **4–8 hours for LTC**. During this time XMR deposits work immediately; BTC/LTC deposits will fail gracefully until NBXplorer reports `isFullySynched`. Monitor progress:

```bash
kubectl logs -n crypto-demo deploy/nbxplorer -f
```

---

### Dev cluster (regtest BTC/LTC + XMR stagenet)

Use this when you want to test the full deposit flow without real funds. BTC/LTC run in regtest mode (instant block mining on demand), XMR connects to a public stagenet node.

**1. Create dev wallet credentials**

```bash
cp infra/wallet/secret.dev.yaml.example infra/wallet/secret.dev.yaml
```

Edit `secret.dev.yaml` — fill in `BTC_XPUB` and `LTC_XPUB` with keys from an **Electrum testnet wallet** (native segwit, starts with `vpub`). Leave RPC passwords as-is for local testing.

**2. Start the dev cluster**

```bash
pnpm cluster:up-dev
# or: bash scripts/cluster-up.sh dev
```

The dev overlay patches: `regtest` network for BTC/LTC, matching port numbers (18443/18444 for BTC, 19443/19444 for LTC), and `--stagenet` for the XMR wallet with a public clearnet stagenet node.

**3. Mine blocks to trigger settlement**

```bash
# Port-forward bitcoind RPC
kubectl port-forward -n crypto-demo service/bitcoind 18443:18443 &

# Generate blocks to a deposit address (replace <address> with one from the UI)
bitcoin-cli -regtest -rpcport=18443 -rpcuser=bitcoin -rpcpassword=changeme \
  generatetoaddress 6 <deposit_address>
```

---

## After code changes (k3d only)

The cluster does not hot-reload. After editing source code, use the targeted redeploy scripts — they rebuild only the affected image and restart that deployment. Only re-run `cluster:up` / `cluster:up-dev` when secrets or infra manifests change.

```bash
pnpm cluster:redeploy-api   # after API (NestJS) changes
pnpm cluster:redeploy-web   # after web (Astro) changes
```

---

## Project structure

```
crypto-demo/
├── apps/
│   ├── api/                    # NestJS application
│   │   ├── prisma/             # schema.prisma
│   │   └── src/
│   │       ├── auth/           # signup, login, mnemonic recovery, JWT guard
│   │       ├── chain/          # NBXplorer poller, XMR wallet, address derivation
│   │       ├── deposits/       # invoice creation, settlement, balance
│   │       ├── prices/         # CoinGecko → Redis → Postgres rate pipeline
│   │       └── users/          # account deletion
│   └── web/                    # Astro SSR application
│       └── src/pages/          # index, login, signup, deposit, wallet
├── infra/
│   ├── k3d-config.yaml         # cluster definition (3 nodes, port :8080)
│   ├── namespace.yaml
│   ├── ingress.yaml
│   ├── postgres/               # deployment, service, PVC, secret template
│   ├── redis/
│   ├── tor/                    # SOCKS5 + Privoxy for outbound Tor traffic
│   ├── api/
│   ├── web/
│   ├── wallet/
│   │   ├── secret.yaml         # gitignored — your real values go here
│   │   └── secret.yaml.example # committed template
│   ├── bitcoind/               # Bitcoin Core (pruned mainnet)
│   ├── litecoind/              # Litecoin Core (pruned mainnet)
│   ├── nbxplorer/              # BTC + LTC chain indexer
│   └── xmr-wallet/             # monero-wallet-rpc
├── packages/
│   ├── eslint-config/
│   └── typescript-config/      # base, astro, nestjs tsconfig presets
├── scripts/
│   ├── cluster-up.sh           # one-command cluster bootstrap
│   └── cluster-down.sh
├── docker-compose.yml          # local Postgres + Redis for dev
└── package.json                # root scripts
```

---

## Useful commands

```bash
# Cluster lifecycle
pnpm cluster:up                  # mainnet cluster
pnpm cluster:up-dev              # dev cluster (regtest BTC/LTC + XMR stagenet)
pnpm cluster:down                # delete cluster (data is lost)

# Database / local dev
pnpm db:up                       # start local Postgres + Redis (docker compose)
pnpm db:down                     # stop local containers
pnpm db:migrate --name <name>    # create + apply a new Prisma migration

# Development
pnpm dev                         # run all apps in watch mode (requires db:up)
pnpm build                       # production build of all apps
pnpm lint                        # ESLint across all packages
pnpm check-types                 # tsc --noEmit across all packages

# Kubernetes (while cluster is running)
kubectl get pods -n crypto-demo -o wide
kubectl logs -n crypto-demo deploy/api -f
kubectl logs -n crypto-demo deploy/bitcoind -f
kubectl logs -n crypto-demo deploy/nbxplorer -f

# Re-apply secrets after editing secret.env
kubectl create secret generic postgres-credentials \
  --from-env-file=infra/postgres/secret.env \
  --namespace=crypto-demo \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/api -n crypto-demo

# Re-apply wallet secret after editing secret.yaml
kubectl apply -f infra/wallet/secret.yaml
kubectl rollout restart deployment/api -n crypto-demo
```
