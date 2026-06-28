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
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Known Issues](#known-issues)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture Overview

```
Browser (React + Vite frontend @ localhost:5174)
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
- **Replicas:** 2
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
| skaffold | v2+ | Build images + apply manifests in one command |

Install skaffold:
```bash
brew install skaffold          # macOS
# or
curl -Lo skaffold https://storage.googleapis.com/skaffold/releases/latest/skaffold-darwin-arm64 && chmod +x skaffold && sudo mv skaffold /usr/local/bin
```

---

## Local Setup

### 1. Start Docker Desktop

Make sure Docker Desktop is running before anything else — minikube uses it as its driver.

### 2. Start minikube

```bash
minikube start --driver=docker --memory=8192 --cpus=4
minikube addons enable ingress
```

Wait for the ingress controller to be ready:

```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

> **Memory:** 8 GB is recommended. Each sandbox pod requests ~400 MB (2 containers × 200 MB). The system services (auth, ai ×2, router, sandbox, notification, ingress-nginx) consume another ~1–1.5 GB. With 4 GB you can run at most 2 sandboxes at a time before the cluster runs out of memory.

### 3. Configure secrets

```bash
# Copy the example file and fill in your credentials
cp k8s/secrets.yml.example k8s/secrets.local.yml
```

Edit `k8s/secrets.local.yml` and set:

| Secret key | Where to get it |
|------------|----------------|
| `AUTH` / `SANDBOX` / `AI` | MongoDB Atlas connection strings |
| `REDIS_URL` | Upstash / Redis Cloud / self-hosted |
| `RABBITMQ_URL` | CloudAMQP or self-hosted |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials |
| `JWT_SECRET` | Any random string ≥ 32 characters |
| `MISTRAL_API_KEY` | console.mistral.ai |
| `EMAIL_USER` / `GOOGLE_REFRESH_TOKEN` | Gmail OAuth2 setup (for notification emails) |

> **Never commit `k8s/secrets.local.yml`** — it is gitignored.

Update `skaffold.yml` to point to your local secrets file:
```yaml
manifests:
  rawYaml:
    - k8s/secrets.local.yml   # ← change from secrets.yml
    ...
```

### 4. Configure Google OAuth callback URL

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), open your OAuth 2.0 client and add this to **Authorized redirect URIs**:

```
http://localhost:18080/api/auth/google/callback
```

### 5. Configure the frontend environment

```bash
echo "VITE_SUBDOMAIN_PORT=18080" > frontend/.env.local
```

### 6. Build all images and deploy with skaffold

Point your shell at minikube's Docker daemon, then run skaffold:

```bash
eval $(minikube docker-env)
skaffold run
```

`skaffold run` builds every Docker image directly into minikube (no registry needed), applies all Kubernetes manifests, and waits for deployments to stabilise. This takes ~2–5 minutes on first run, much faster on subsequent runs thanks to Docker layer caching.

Verify all pods are running:

```bash
kubectl get pods
# Expected output:
# ai-deployment-xxx          1/1     Running
# ai-deployment-xxx          1/1     Running
# auth-deployment-xxx        1/1     Running
# notification-deployment-xxx 1/1    Running
# router-deployment-xxx      1/1     Running
# sandbox-deployment-xxx     1/1     Running
```

### 7. Start the port-forward

Docker Desktop owns port 80 on macOS. This port-forward routes all traffic through port 18080 directly to the nginx ingress pod:

```bash
./start-local.sh
```

Keep this running in a **dedicated terminal** for the duration of your session. It auto-restarts if the ingress pod is replaced.

To run it manually (without auto-restart):

```bash
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 18080:80
```

### 8. Start the frontend

In a separate terminal:

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open **http://localhost:5174** in your browser.

### 9. Sign in and create a sandbox

1. Click **Continue with Google** on the splash screen
2. Complete the Google OAuth flow — you'll be redirected back to `localhost:5174`
3. Enter a project name and click **Create New Project**
4. The sandbox pod spins up in ~10–30 seconds

---

## Restarting after a reboot

Minikube state persists across reboots but the port-forward does not. Each new session:

```bash
# Terminal 1 — ensure cluster is up, then redeploy (fast: images are cached)
minikube status || minikube start --driver=docker --memory=8192 --cpus=4
eval $(minikube docker-env)
skaffold run

# Terminal 2 — port-forward (keep open)
./start-local.sh

# Terminal 3 — frontend dev server
cd frontend && npm run dev
```

---

## Environment Variables

### Auth Service

| Variable | Description |
|----------|-------------|
| `AUTH_MONGO_URI` | MongoDB Atlas connection string for the auth DB |
| `RABBITMQ_URL` | CloudAMQP / RabbitMQ AMQPS URL |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `JWT_SECRET` | HMAC secret for JWT signing (min 32 chars) |
| `GOOGLE_CALLBACK_URL` | Set to `http://localhost:18080/api/auth/google/callback` for local dev |

### AI Orchestration Service

| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | MistralAI API key |
| `AI` | MongoDB connection string for the AI DB |

### Notification Service

| Variable | Description |
|----------|-------------|
| `RABBITMQ_URL` | RabbitMQ connection URL |
| `EMAIL_USER` | Gmail address for sending notifications |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for Gmail OAuth2 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Gmail OAuth2 refresh token |

### Sandbox Server & Router

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection URL (`redis://` or `rediss://`) |
| `SANDBOX` | MongoDB connection string for sandbox DB |
| `JWT_SECRET` | Same secret as auth service — used to verify tokens |

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
| `GET` | `/api/auth/me` | Returns authenticated user object — used by frontend to check login state |
| `GET` | `/_status/healthz` | Liveness probe |

### Sandbox Server

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sandbox/project` | ✅ | Creates a new project record; body: `{ title }` |
| `GET` | `/api/sandbox/project` | ✅ | Lists all projects for the authenticated user |
| `POST` | `/api/sandbox/start` | ✅ | Tears down previous sandbox, creates new pod + service + Redis TTL; body: `{ projectId }` |
| `POST` | `/api/sandbox/stop` | ✅ | Immediately deletes pod + service; body: `{ sandboxId }` |

### AI Orchestration Service

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/invoke` | Body: `{ message, projectId }`. Streams agent activity + final response via SSE (`text/event-stream`) |

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

## Troubleshooting

### Sandbox pods stuck in `Pending` — "Insufficient memory"

Stale sandbox pods from a previous session are consuming all cluster memory. Delete them:

```bash
# Delete all sandbox pods and their services
kubectl delete pods -l sandboxId --ignore-not-found
kubectl delete svc -l sandboxId --ignore-not-found
```

If that doesn't fully free space, delete by name:

```bash
kubectl get pods | grep sandbox-pod
kubectl delete pod <pod-name> ...

kubectl get svc | grep sandbox-service
kubectl delete svc <svc-name> ...
```

Then refresh the browser and create a new sandbox.

To avoid this in future sessions, give minikube more memory:
```bash
minikube stop
minikube config set memory 8192
minikube start
```

### Ingress 404 — "failed calling webhook validate.nginx.ingress.kubernetes.io"

The nginx admission webhook has a stale TLS certificate (happens after cluster recreation). Fix:

```bash
kubectl delete ValidatingWebhookConfiguration ingress-nginx-admission
```

Then re-run `skaffold run` — the ingress will apply cleanly.

### Port 18080 not listening / API calls failing

The port-forward isn't running. Start it:

```bash
./start-local.sh
```

Verify with:
```bash
curl http://localhost:18080/api/auth/me
# Expected: {"error":"Not authenticated"}
```

### Google OAuth redirect fails

1. Confirm `http://localhost:18080/api/auth/google/callback` is listed in **Authorized redirect URIs** in Google Cloud Console
2. Confirm the auth pod is running: `kubectl get pods | grep auth`
3. Check auth pod logs: `kubectl logs deployment/auth-deployment`

### Preview / terminal / files unreachable after creating a sandbox

The sandbox pod might not have started yet. Check:

```bash
kubectl get pods | grep sandbox-pod
```

If status is `Pending`, see the memory fix above. If `CrashLoopBackOff`, check logs:

```bash
kubectl logs <sandbox-pod-name> -c sandbox-container
kubectl logs <sandbox-pod-name> -c agent-container
```

### Frontend shows wrong port (5173 vs 5174)

If another Vite project is running on 5173, this project auto-increments to 5174. The vite config is set to 5174 explicitly. If you see 5173 somewhere, it's a different project.

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
