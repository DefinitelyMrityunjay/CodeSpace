import express from 'express';
import morgan from 'morgan';
import { createProxyMiddleware } from "http-proxy-middleware";
import http from 'http';
import { createProxyServer } from 'httpxy';
import { refreshTTL } from './config/redis.js';

const app = express();
app.use(morgan('combined'));

app.get('/api/status/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
})

app.get('/api/status/readyz', (req, res) => {
    res.status(200).json({ status: 'ready' });
})

const proxies = {}
const agentProxies = {}

function getProxy(sandboxId) {
    if (!proxies[ sandboxId ]) {
        proxies[ sandboxId ] = createProxyMiddleware({
            target: `http://sandbox-service-${sandboxId}`,
            changeOrigin: true,
            on: {
                error: (err, req, res) => {
                    console.error(`[preview-proxy][${sandboxId}] ${err.message}`);
                    if (!res.headersSent) {
                        res.status(502).json({ error: 'Preview sandbox unreachable', sandboxId });
                    }
                }
            }
        });
    }
    return proxies[ sandboxId ];
}

function getAgentProxy(sandboxId) {
    if (!agentProxies[ sandboxId ]) {
        agentProxies[ sandboxId ] = createProxyMiddleware({
            target: `http://sandbox-service-${sandboxId}:3000`,
            changeOrigin: true,
            on: {
                error: (err, req, res) => {
                    console.error(`[agent-proxy][${sandboxId}] ${err.message}`);
                    if (!res.headersSent) {
                        res.status(502).json({ error: 'Sandbox agent unreachable', sandboxId });
                    }
                }
            }
        });
    }
    return agentProxies[ sandboxId ];
}

// Single httpxy proxy server handles all WebSocket upgrades
const wsProxy = createProxyServer({ changeOrigin: true });
wsProxy.on('error', (err, req, socket) => {
    console.error(`[ws-proxy] ${err.message}`);
    socket?.destroy();
});

app.use(async (req, res, next) => {
    const host = req.headers.host;
    if (!host) return next();

    const parts = host.split('.');
    const sandboxId = parts[0];
    const type = parts[1];

    // Refresh TTL in Redis; don't let a Redis hiccup take down the proxy
    try {
        await refreshTTL(sandboxId);
    } catch (err) {
        console.error(`[router] refreshTTL failed for ${sandboxId}: ${err.message}`);
    }

    if (type === 'agent') {
        return getAgentProxy(sandboxId)(req, res, next);
    }
    if (type === 'preview') {
        return getProxy(sandboxId)(req, res, next);
    }

    next();
});

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host;
    if (!host) { socket.destroy(); return; }

    socket.on('error', () => socket.destroy());

    const parts = host.split('.');
    const sandboxId = parts[0];
    const type = parts[1];

    console.log(`[ws-upgrade] host=${host} sandboxId=${sandboxId} type=${type}`);

    if (type === 'agent') {
        wsProxy.ws(req, socket, { target: `http://sandbox-service-${sandboxId}:3000` }, head)
            .catch((err) => {
                console.error(`[ws-upgrade][agent][${sandboxId}] ${err.message}`);
                socket.destroy();
            });
    } else if (type === 'preview') {
        wsProxy.ws(req, socket, { target: `http://sandbox-service-${sandboxId}` }, head)
            .catch((err) => {
                console.error(`[ws-upgrade][preview][${sandboxId}] ${err.message}`);
                socket.destroy();
            });
    } else {
        socket.destroy();
    }
});

export default server;
