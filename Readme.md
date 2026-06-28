# codeSpace

> An AI-powered cloud sandbox IDE — spin up a React + Vite environment in one click, describe what you want to build, and watch the AI write and hot-reload the code live in your browser.

![Node.js](https://img.shields.io/badge/Node.js-20.x-green)
![React](https://img.shields.io/badge/React-19-blue)
![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-blue)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

---

## What is codeSpace?

codeSpace is a browser-based cloud IDE that provisions isolated, per-user React + Vite sandbox environments on demand inside a Kubernetes cluster. Each sandbox runs as a dedicated pod pre-loaded with a starter template. Users interact with a VS Code–style UI that includes:

- **Live preview pane** — instant HMR-powered preview
- **File explorer** — browse and view your project files
- **Integrated terminal** — full PTY-backed shell inside the pod
- **AI chat panel** — powered by Mistral Large via LangChain/LangGraph

The AI agent reads, creates, and updates files directly inside the running pod in real time, triggering Vite's HMR so changes appear instantly — no full reload required.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Services](#services)
- [Sandbox Lifecycle](#sandbox-lifecycle)
- [AI Code Editing Layer](#ai-code-editing-layer)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Security Considerations](#security-considerations)
- [Known Issues](#known-issues)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture Overview

```
Browser (React + Vite frontend @ localhost:5173)
    ↓ HTTP / WebSocket / SSE
Vite dev server proxy → localhost:18080
    ↓
kubectl port-forward → nginx Ingress Controller (pod port 80)
    ↓
Core services:  auth · sandbox · ai · router · notification
    ↓ Kubernetes API
Per-sandbox pods:  template container + agent container (shared /workspace volume)
    ↓
External managed services:
    MongoDB Atlas · Redis · RabbitMQ · MistralAI
```

### Ingress routing

| Host / Path | Routes to |
|-------------|-----------|
| `*/api/auth` | auth-service |
| `*/api/sandbox` | sandbox-service |
| `*/api/ai` | ai-service |
| `*.preview.lvh.me` | router-service → Vite dev server (port 5173) |
| `*.agent.lvh.me` | router-service → agent sidecar (port 3000) |

> **Why `lvh.me`?** `lvh.me` is a public wildcard DNS that resolves all subdomains to `127.0.0.1`. No local DNS configuration needed.

> **Why port 18080?** On macOS with the Docker driver, Docker Desktop binds port 80. A `kubectl port-forward` on 18080 bypasses this.

---

## Services

### Auth Service (`auth/`)
Handles Google OAuth 2.0 login, JWT issuance, user persistence in MongoDB, and dispatches login events to RabbitMQ.

- **Port:** 3000 (ClusterIP :80)
- **Key packages:** `passport`, `passport-google-oauth20`, `jsonwebtoken`, `mongoose`, `amqplib`

### AI Orchestration Service (`ai-orchestration/`)
Hosts the LangGraph ReAct agent. Streams AI responses to the frontend via SSE. Proxies file tool calls to the per-sandbox agent sidecar.

- **Port:** 3000 (ClusterIP :80)
- **Replicas:** 1 (local) / 2 (prod)
- **Model:** `mistral-large-latest`
- **Key packages:** `@langchain/mistralai`, `@langchain/langgraph`, `langchain`, `axios`, `zod`

### Sandbox Server (`sandbox/server/`)
Provisions new sandbox pods and per-sandbox K8s services. Registers sandbox TTL keys in Redis. Listens for Redis keyspace expiry events to clean up dead sandboxes. Cleans up the previous sandbox for a project when a new one is started.

- **Port:** 3000 (ClusterIP :80)
- **Service account:** `resource-manager` (RBAC: pods + services in default namespace)
- **Key packages:** `@kubernetes/client-node`, `ioredis`, `uuid`

### Sandbox Router (`sandbox/router/`)
Subdomain-based reverse proxy. Routes `{id}.preview.lvh.me` and `{id}.agent.lvh.me` to the correct per-sandbox ClusterIP service. Refreshes the sandbox Redis TTL on every request.

- **Port:** 3000 (ClusterIP :80)
- **Key packages:** `http-proxy-middleware`, `httpxy`, `ioredis`

### Notification Service (`notification/`)
Consumes `auth_notification_queue` from RabbitMQ and sends login-alert emails via Gmail OAuth2.

- **Port:** 4000 (ClusterIP :80)
- **Key packages:** `amqplib`, `nodemailer`

### Sandbox Agent — Sidecar (`sandbox/agent/`)
Runs inside every sandbox pod. Exposes a REST API for file operations on `/workspace` and a PTY-backed terminal over Socket.IO.

- **Port:** 3000
- **Base image:** `node:20-bullseye` (Debian — required for `node-pty` native compilation)

### Sandbox Template (`sandbox/template/`)
Pre-built React + Vite project. Used as both the init container (seeds the shared volume) and the main runtime container (runs `npm run dev`).

### Frontend (`frontend/`)
Browser-based IDE. React 19 + Vite + Tailwind CSS v4.

| Component | Purpose |
|-----------|---------|
| `SplashScreen` | Landing page; Google login + project list + create form |
| `TopBar` | Tab switcher (Preview / Files), sandbox ID, status |
| `FileExplorer` | Tree-view sidebar; refreshes on AI edits |
| `FileViewer` | Read-only code viewer |
| `PreviewFrame` | `iframe` pointing to `{id}.preview.lvh.me:18080` |
| `Terminal` | xterm.js terminal over Socket.IO |
| `AiChat` | Chat panel; consumes SSE; renders activity log |

---

## Sandbox Lifecycle

### Provisioning

1. User signs in via Google OAuth and clicks **Create New Project**
2. Frontend posts to `POST /api/sandbox/project` → creates a project record in MongoDB
3. Frontend posts to `POST /api/sandbox/start` → sandbox server:
   - Tears down the previous sandbox for this project (if any)
   - Generates a UUIDv7 → `sandboxId`
   - Creates `sandbox-pod-{id}` and `sandbox-service-{id}` in Kubernetes
   - Stores `sandbox:{id}` in Redis with a 20-minute TTL
   - Saves `currentSandboxId` on the project record
4. Returns `{ sandboxId, previewUrl }`
5. On page reload, the frontend probes the agent via `sessionStorage` — if alive it reconnects without creating a new sandbox

### Pod structure

Each sandbox pod contains:

- **Init container** — copies the React/Vite template from the image into a shared `emptyDir` volume
- **`sandbox-container`** — runs `npm run dev` (Vite on port 5173)
- **`agent-container`** — file API + PTY server (port 3000)

Both containers mount the same `emptyDir` volume at `/workspace`. Writes from the agent are immediately visible to Vite's file watcher, enabling instant HMR.

### TTL & cleanup

- Every request through the Router refreshes the TTL: `EXPIRE sandbox:{id} 1200`
- When a key expires (20 min of inactivity), the sandbox server deletes the pod and service
- `POST /api/sandbox/stop` provides explicit immediate teardown (called on page unload)
- `POST /api/sandbox/start` always tears down the project's previous sandbox first
- All sandbox storage is ephemeral — no data persists after cleanup

---

## AI Code Editing Layer

The AI layer uses LangGraph to run a stateful ReAct agent:

```js
createAgent({
  model: ChatMistralAI("mistral-large-latest"),
  tools: [list_files, read_files, update_files],
  systemPrompt: "FrontendForge — expert AI frontend engineer...",
  recursionLimit: 100
})
```

### Streaming (SSE)

`POST /api/ai/invoke` returns `text/event-stream`. Each line is either a tool activity string or the final AI response. The frontend renders these as an expandable activity log.

### Hot reload

File writes land on the shared `emptyDir` volume. Vite's watcher detects changes and sends HMR updates to the preview iframe — no full reload needed.

---

## Prerequisites

| Tool | Minimum | Purpose |
|------|---------|---------|
| Node.js | 20.x | All backend services + frontend |
| Docker Desktop | 4.x | Container runtime + minikube driver |
| kubectl | 1.28+ | Cluster management |
| minikube | latest | Local Kubernetes cluster |

> Skaffold is **not** required for local development. Images are built directly into minikube's Docker daemon.

---

## Local Setup

### 1. Start minikube

```bash
minikube start --driver=docker --memory=4096 --cpus=4
minikube addons enable ingress
```

Wait for the ingress controller to be ready:

```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

### 2. Apply secrets

```bash
# Copy the example and fill in your credentials
cp k8s/secrets.yml k8s/secrets.local.yml
# Edit k8s/secrets.local.yml with real values (MongoDB, Redis, RabbitMQ, Google OAuth, Mistral)

kubectl apply -f k8s/secrets.local.yml
```

> **Never commit `k8s/secrets.local.yml`** — it is gitignored.

### 3. Build all images into minikube

Point your shell at minikube's Docker daemon, then build each image:

```bash
eval $(minikube docker-env)

docker build -t sandbox    sandbox/server/
docker build -t router     sandbox/router/
docker build -t agent      sandbox/agent/
docker build -t template   sandbox/template/
docker build -t auth       auth/
docker build -t ai-orchestration  ai-orchestration/
```

### 4. Apply Kubernetes manifests

```bash
kubectl apply -f k8s/rbac.yml
kubectl apply -f k8s/sandbox-service.yml
kubectl apply -f k8s/sandbox-deployment.yml
kubectl apply -f k8s/auth-service.yml
kubectl apply -f k8s/auth-deployment.yml
kubectl apply -f k8s/router-service.yml
kubectl apply -f k8s/router-deployment.yml
kubectl apply -f k8s/ai-service.yml
kubectl apply -f k8s/ai-deployment.yml
kubectl apply -f k8s/ingress.yml
```

Verify everything is running:

```bash
kubectl get pods
# Expected: sandbox-deployment, auth-deployment, router-deployment, ai-deployment all 1/1 Running
```

### 5. Start the port-forward (keep this terminal open)

Docker Desktop owns port 80 on macOS. This port-forward routes all traffic through port 18080 directly to the nginx ingress pod, bypassing Docker Desktop:

```bash
./start-local.sh
```

This script runs in a loop and automatically restarts if the ingress pod is replaced. Keep it running in a dedicated terminal for the duration of your session.

To start it manually (without auto-restart):

```bash
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 18080:80
```

### 6. Configure Google OAuth callback URL

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), open your OAuth 2.0 client and add this to **Authorized redirect URIs**:

```
http://localhost:18080/api/auth/google/callback
```

### 7. Start the frontend

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open **http://localhost:5173** in your browser.

### 8. Sign in and create a sandbox

1. Click **Continue with Google** on the splash screen
2. Complete the Google OAuth flow — you'll be redirected back to `localhost:5173`
3. Enter a project name and click **Create New Project**
4. The sandbox pod will spin up (~30 seconds for the first run while images are pulled)

---

## Restarting after a reboot

Minikube state persists across reboots but the port-forward does not. Each new session:

```bash
# 1. Make sure minikube is running
minikube status || minikube start --driver=docker --memory=4096 --cpus=4

# 2. Start the port-forward
./start-local.sh   # keep this terminal open

# 3. Start the frontend (separate terminal)
cd frontend && npm run dev
```

If you see pods in `Pending` state (usually means the cluster is out of memory from a previous session):

```bash
# List stuck sandbox pods
kubectl get pods | grep sandbox-pod

# Delete them all at once
kubectl delete pods -l sandboxId --ignore-not-found
kubectl delete svc -l sandboxId --ignore-not-found
```

---

## Environment Variables

### Auth Service

| Variable | Description | Required |
|----------|-------------|----------|
| `AUTH_MONGO_URI` | MongoDB Atlas connection string for the auth DB | ✅ |
| `RABBITMQ_URL` | CloudAMQP / RabbitMQ AMQPS URL | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | ✅ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret | ✅ |
| `JWT_SECRET` | HMAC secret for JWT signing (min 32 chars) | ✅ |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL — set to `http://localhost:18080/api/auth/google/callback` for local dev | ✅ |

### AI Orchestration Service

| Variable | Description | Required |
|----------|-------------|----------|
| `MISTRAL_API_KEY` | MistralAI API key | ✅ |

### Notification Service

| Variable | Description | Required |
|----------|-------------|----------|
| `RABBITMQ_URL` | RabbitMQ connection URL | ✅ |
| `EMAIL_USER` | Gmail address for sending notifications | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for Gmail OAuth2 | ✅ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | ✅ |
| `GOOGLE_REFRESH_TOKEN` | Gmail OAuth2 refresh token | ✅ |

### Sandbox Server & Router

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_URL` | Redis connection URL (`redis://` or `rediss://`) | ✅ |
| `MONGO_URI` / `SANDBOX` | MongoDB connection string for sandbox DB | ✅ |
| `JWT_SECRET` | Same secret as auth service — used to verify tokens | ✅ |

### Frontend

| Variable | File | Description |
|----------|------|-------------|
| `VITE_SUBDOMAIN_PORT` | `frontend/.env.local` | Port appended to agent/preview subdomain URLs. Set to `18080` for local dev. Omit for production. |

---

## API Reference

### Auth Service

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/google` | Initiates Google OAuth redirect |
| `GET` | `/api/auth/google/callback` | OAuth callback; upserts user; sets JWT cookie; redirects to frontend |
| `GET` | `/api/auth/me` | Returns `{ authenticated, userId }` — used by frontend to check login state |
| `GET` | `/_status/healthz` | Liveness probe |

### Sandbox Server

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sandbox/project` | ✅ | Creates a new project record; body: `{ title }` |
| `GET` | `/api/sandbox/project` | ✅ | Lists all projects for the authenticated user |
| `POST` | `/api/sandbox/start` | ✅ | Tears down previous sandbox, creates new pod + service + Redis TTL; body: `{ projectId }` |
| `POST` | `/api/sandbox/stop` | ✅ | Immediately deletes pod + service; body: `{ sandboxId }` |
| `GET` | `/api/sandbox/health` | — | Health check |

### AI Orchestration Service

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/invoke` | Body: `{ message, projectId }`. Streams agent activity + final response via SSE (`text/event-stream`) |
| `GET` | `/api/status/healthz` | Liveness probe |

### Sandbox Agent (per-sandbox via `{id}.agent.lvh.me:18080`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/list-files` | Lists all files in `/workspace` (excludes `node_modules`, `.git`, `dist`) |
| `GET` | `/read-files?files=a,b` | Returns contents of requested files |
| `PATCH` | `/update-files` | Writes file contents; creates parent directories as needed |
| `POST` | `/create-files` | Creates new files |

**Socket.IO events (same port):**

| Event | Direction | Payload |
|-------|-----------|---------|
| `terminal-output` | Server → Client | Raw PTY data |
| `terminal-input` | Client → Server | Keystrokes |

---

## Security Considerations

### What's in place
- Pod-level sandbox isolation — each sandbox is its own Kubernetes pod
- Unique `sandboxId` service selectors prevent cross-sandbox routing
- `emptyDir` volumes are ephemeral and kernel-managed
- CPU and memory limits on all containers
- RBAC for the sandbox server — only `pods` and `services` in `default` namespace
- JWT cookie auth on all sandbox and project endpoints

### What needs hardening before public deployment

| Concern | Current state | Recommendation |
|---------|--------------|----------------|
| Secrets in repo | Plaintext in `k8s/secrets.yml` | Use Sealed Secrets, External Secrets Operator, or SOPS+age |
| Sandbox `securityContext` | None — containers run as root | Add `runAsNonRoot`, `allowPrivilegeEscalation: false` |
| Service-to-service auth | Plain HTTP within cluster | Add mTLS via Istio or cert-manager |
| Rate limiting | None | Add rate limiting on `/api/ai/invoke` and `/api/sandbox/start` |

---

## Known Issues

| # | Issue | Status |
|---|-------|--------|
| 1 | `k8s/secrets.yml` contains plaintext credentials in the repo | **Open — rotate and purge from git history before any public exposure** |
| 2 | All services use `nodemon` in production images | Open — switch to `node` for prod images |
| 3 | No `securityContext` on sandbox pods | Open |
| 4 | No rate limiting on AI or sandbox endpoints | Open |

---

## Roadmap

| Feature | Priority |
|---------|----------|
| Sandbox persistence (PVC / object storage) | High |
| Multi-language sandboxes (Python, Node, Go) | High |
| Multi-turn AI conversation context | Medium |
| Collaborative editing (Yjs CRDT) | Medium |
| AI edit history & undo | Medium |
| Package install UI (`npm install <pkg>`) | Medium |
| Template library (Next.js, TypeScript, etc.) | Low |
| Team / org workspaces | Low |

---

## Contributing

### Branch naming

| Pattern | Use |
|---------|-----|
| `feat/<desc>` | New features |
| `fix/<desc>` | Bug fixes |
| `chore/<desc>` | Tooling, deps, config |
| `docs/<desc>` | Documentation only |
| `refactor/<desc>` | Code restructuring |

### Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`

---

## License

ISC License — Copyright (c) 2025 codeSpace contributors
