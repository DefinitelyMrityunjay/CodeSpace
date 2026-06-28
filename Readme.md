# codeSpace

> An AI-powered cloud sandbox IDE — spin up a React + Vite environment in one click, describe what you want to build, and watch the AI write and hot-reload the code live in your browser.

![Node.js](https://img.shields.io/badge/Node.js-20.x-green)
![React](https://img.shields.io/badge/React-19-blue)
![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-blue)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

---

## What is codeSpace?

codeSpace is a browser-based cloud IDE that provisions isolated, per-user React + Vite sandbox environments on demand inside a Kubernetes cluster. Each sandbox runs as a dedicated pod pre-loaded with a starter template. Users interact with a VS Code–style UI that includes:

- 🖥️ **Live preview pane** — instant HMR-powered preview
- 📁 **File explorer** — browse and view your project files
- 💻 **Integrated terminal** — full PTY-backed shell inside the pod
- 🤖 **AI chat panel** — powered by Mistral Large via LangChain/LangGraph

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
Browser (React + Vite frontend)
    ↓ HTTP / WebSocket / SSE
nginx Ingress Controller
    ↓
Core services:  auth · sandbox · ai · router · notification
    ↓ Kubernetes API
Per-sandbox pods:  template container + agent container (shared /workspace volume)
    ↓
External managed services:
    MongoDB Atlas · Redis · RabbitMQ · MistralAI · Gmail SMTP
```

### Ingress routing

| Host | Routes to |
|------|-----------|
| `*/api/auth` | auth-service |
| `*/api/sandbox` | sandbox-service |
| `*/api/ai` | ai-service |
| `*.preview.localhost` | router-service → Vite dev server |
| `*.agent.localhost` | router-service → agent sidecar |

---

## Services

### Auth Service (`auth/`)
Handles Google OAuth 2.0 login, JWT issuance, user persistence in MongoDB, and dispatches login events to RabbitMQ.

- **Port:** 3000 (ClusterIP :80)
- **Replicas:** 1
- **Key packages:** `passport`, `passport-google-oauth20`, `jsonwebtoken`, `mongoose`, `amqplib`

### AI Orchestration Service (`ai-orchestration/`)
Hosts the LangGraph ReAct agent. Streams AI responses to the frontend via SSE. Proxies file tool calls to the per-sandbox agent sidecar.

- **Port:** 3000 (ClusterIP :80)
- **Replicas:** 2
- **Model:** `mistral-large-latest`
- **Key packages:** `@langchain/mistralai`, `@langchain/langgraph`, `langchain`, `axios`, `zod`

### Sandbox Server (`sandbox/server/`)
Provisions new sandbox pods and per-sandbox K8s services. Registers sandbox TTL keys in Redis. Listens for Redis keyspace expiry events to clean up dead sandboxes.

- **Port:** 3000 (ClusterIP :80)
- **Service account:** `resource-manager` (RBAC: pods + services in default namespace)
- **Key packages:** `@kubernetes/client-node`, `ioredis`, `uuid`

### Sandbox Router (`sandbox/router/`)
Subdomain-based reverse proxy. Routes `{id}.preview.localhost` and `{id}.agent.localhost` to the correct per-sandbox ClusterIP service. Refreshes the sandbox Redis TTL on every request.

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
Browser-based IDE. React 19 + Vite 8 + Tailwind CSS v4.

| Component | Purpose |
|-----------|---------|
| `SplashScreen` | Landing page; calls `POST /api/sandbox/start` |
| `TopBar` | Tab switcher (Preview / Files), sandbox ID, status |
| `FileExplorer` | Tree-view sidebar; refreshes on AI edits |
| `FileViewer` | Read-only code viewer |
| `PreviewFrame` | `iframe` pointing to `{id}.preview.localhost` |
| `Terminal` | xterm.js terminal over Socket.IO |
| `AiChat` | Chat panel; consumes SSE; renders activity log |

---

## Sandbox Lifecycle

### Provisioning

1. User clicks **Create Sandbox** on the splash screen
2. Frontend posts to `POST /api/sandbox/start`
3. Sandbox server generates a UUIDv7 → `sandboxId`
4. Creates `sandbox-pod-{id}` and `sandbox-service-{id}` in Kubernetes
5. Stores `sandbox:{id}` in Redis with a 120-second TTL
6. Returns `{ sandboxId, previewUrl: "http://{id}.preview.localhost" }`

### Pod structure

Each sandbox pod contains:

- **Init container** — copies the React/Vite template from the image into a shared `emptyDir` volume
- **`sandbox-container`** — runs `npm run dev` (Vite on port 5173)
- **`agent-container`** — file API + PTY server (port 3000)

Both containers mount the same `emptyDir` volume at `/workspace`. Writes from the agent are immediately visible to Vite's file watcher, enabling instant HMR.

### TTL & cleanup

- Every request through the Router refreshes the TTL: `EXPIRE sandbox:{id} 120`
- When a key expires (120s of inactivity), the sandbox server deletes the pod and service with `gracePeriodSeconds: 0`
- All sandbox storage is ephemeral — no data persists after cleanup

---

## AI Code Editing Layer

The AI layer uses LangGraph to run a stateful ReAct agent:

```js
LangGraph.createAgent({
  model: ChatMistralAI("mistral-large-latest"),
  tools: [list_files, read_files, update_files],
  systemPrompt: "codeSpace — expert AI frontend engineer...",
  recursionLimit: 100
})
```

### Agent workflow

1. **Understand** — parse user intent and implicit requirements
2. **Plan** — outline component tree, styling, sections
3. **Explore** — `list_files` → `read_files` on relevant files
4. **Build** — `update_files` in batches (configs → shared components → pages)
5. **Polish** — verify responsiveness, imports, accessibility
6. **Report** — summarize changes via the SSE stream

### Streaming (SSE)

`POST /api/ai/invoke` returns `text/event-stream`. Each line is either a tool activity string (e.g. `"Reading files...src/App.jsx"`) or the final AI response. The frontend's `AiChat` component renders these as an expandable activity log.

### Hot reload

File writes land on the shared `emptyDir` volume. Vite's watcher (`usePolling: true`, `interval: 300ms`) detects changes and sends HMR updates to the preview iframe — no full reload needed.

---

## Prerequisites

| Tool | Minimum | Purpose |
|------|---------|---------|
| Node.js | 20.x | All backend services + frontend |
| npm | 10.x | Package management |
| Docker | 24.x | Image builds |
| kubectl | 1.28+ | Cluster management |
| minikube / kind | latest | Local Kubernetes cluster |
| skaffold | v2.x | Build + deploy orchestration |
| nginx ingress | latest | Wildcard subdomain routing |

---

## Local Setup

### 1. Clone and start the cluster

```bash
git clone <repo-url>
cd capstone

minikube start --driver=docker --cpus=4 --memory=8g
minikube addons enable ingress
```

### 2. Point Docker at minikube's daemon

```bash
eval $(minikube docker-env)
```

### 3. Configure secrets

```bash
cp k8s/secrets.yml k8s/secrets.local.yml
# Edit k8s/secrets.local.yml with your credentials
# (MongoDB URI, Redis, RabbitMQ, Google OAuth, MistralAI key)
kubectl apply -f k8s/secrets.local.yml
```

> ⚠️ **Never commit `k8s/secrets.local.yml`** — add it to `.gitignore`.

### 4. Deploy

```bash
kubectl apply -f k8s/rbac.yml
skaffold dev
# Builds all 7 images, applies all manifests, streams logs
```

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### 6. Configure wildcard DNS (macOS)

Sandbox previews require `*.localhost` to resolve to the minikube IP:

```bash
brew install dnsmasq
echo "address=/.localhost/$(minikube ip)" >> /opt/homebrew/etc/dnsmasq.conf
sudo brew services start dnsmasq

sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost

ping testid.preview.localhost  # should resolve to minikube IP
```

### Test a sandbox manually

```bash
# Create a sandbox
curl -X POST http://localhost:80/api/sandbox/start
# → { "sandboxId": "019e…", "previewUrl": "http://019e….preview.localhost" }

# List files
curl "http://019e….agent.localhost/list-files"

# Update a file
curl -X PATCH http://019e….agent.localhost/update-files \
  -H "Content-Type: application/json" \
  -d '{"updates":[{"file":"/src/App.jsx","content":"export default ()=><h1>Hello</h1>"}]}'
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

### AI Orchestration Service

| Variable | Description | Required |
|----------|-------------|----------|
| `MISTRALAI_API_KEY` | MistralAI API key | ✅ |

> ⚠️ Known issue: the K8s secret uses key `MISTRAL_API_KEY` but the code reads `MISTRALAI_API_KEY`. See [Known Issues](#known-issues).

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

### Sandbox Agent

| Variable | Description | Required |
|----------|-------------|----------|
| `SHELL` | Shell binary for the PTY (defaults to `bash`) | Optional |

---

## API Reference

### Auth Service

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/google` | Initiates Google OAuth redirect |
| `GET` | `/api/auth/google/callback` | OAuth callback; upserts user; sets JWT cookie |
| `GET` | `/_status/healthz` | Liveness probe |
| `GET` | `/_status/readyz` | Readiness probe |

### Sandbox Server

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sandbox/start` | Creates pod + service + Redis TTL; returns `{ sandboxId, previewUrl }` |
| `GET` | `/api/sandbox/health` | Health check |

### AI Orchestration Service

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/invoke` | Body: `{ message, projectId }`. Streams agent activity + final response via SSE |
| `GET` | `/api/status/healthz` | Liveness probe |

### Sandbox Agent (per-sandbox via `{id}.agent.localhost`)

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
- `emptyDir` volumes are ephemeral and kernel-managed — cannot escape the pod
- CPU and memory limits on all containers
- RBAC for the sandbox server — only `pods` and `services` access in `default` namespace

### What needs hardening before public deployment

| Concern | Current state | Recommendation |
|---------|--------------|----------------|
| Secrets in repo | Plaintext in `k8s/secrets.yml` | Use Sealed Secrets, External Secrets Operator, or SOPS+age |
| Sandbox `securityContext` | None — containers run as root | Add `runAsNonRoot`, `allowPrivilegeEscalation: false` |
| JWT enforcement | Not enforced on sandbox/AI endpoints | Require valid JWT on `/api/sandbox/start` and `/api/ai/invoke` |
| Service-to-service auth | Plain HTTP within cluster | Add mTLS via Istio or cert-manager |
| Rate limiting | None | Add rate limiting on `/api/ai/invoke` and `/api/sandbox/start` |

> ⚠️ **Critical:** `k8s/secrets.yml` contains live credentials committed to the repo. Rotate all credentials and remove this file from git history using `git filter-repo` or BFG Repo Cleaner before any public exposure.

---

## Known Issues

| # | Issue | Impact |
|---|-------|--------|
| 1 | `k8s/secrets.yml` contains plaintext credentials in the repo | **Critical** |
| 2 | `MISTRAL_API_KEY` (K8s secret) vs `MISTRALAI_API_KEY` (env var in code) mismatch | AI service won't get the key in cluster |
| 3 | No JWT enforcement on `/api/sandbox/start` or `/api/ai/invoke` | Unauthenticated access |
| 4 | No `securityContext` on sandbox pods | Containers run as root |
| 5 | No rate limiting on AI or sandbox endpoints | Potential resource exhaustion |
| 6 | All services use `nodemon` in production images | Not appropriate for prod |
| 7 | Frontend labels AI as "Powered by Gemini" | Incorrect — model is `mistral-large-latest` |

---

## Roadmap

| Feature | Priority |
|---------|----------|
| Sandbox persistence (PVC / object storage) | High |
| JWT auth enforcement on all endpoints | High |
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

### Pull request process

1. Branch from `main`. Rebase before opening a PR.
2. Title format: `<type>(<scope>): <subject>` — e.g. `fix(ai): correct MISTRAL_API_KEY env var name`
3. PR description must include: what changed and why, related issue, how to test locally.
4. All CI checks must pass and at least one reviewer must approve.

### PR checklist

- [ ] No secrets or credentials in code or manifests
- [ ] No `console.log` left in production paths
- [ ] New endpoints have at least a basic integration test
- [ ] K8s manifests include resource requests/limits
- [ ] Health probes updated if new service or port added
- [ ] README updated if architecture changes

### Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`

---

## License

ISC License — Copyright (c) 2025 codeSpace contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.