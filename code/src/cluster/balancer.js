#!/usr/bin/env node
/**
 * Load Balancer Service - IP-based consistent hashing round-robin
 * Port: 13003
 *
 * Environment Variables:
 *   BALANCER_PORT - Load balancer port (default 13003)
 *   BACKEND_HOSTS - Docker mode: comma-separated backend addresses
 *   BACKEND_DNS - DNS discovery mode: service name
 *   BACKEND_PORT - DNS discovery mode: backend port (default 13004)
 *   BACKEND_START_PORT - Local mode: starting port (default 13004)
 *   BACKEND_COUNT - Local mode: instance count (default 5)
 */

import http from 'http';
import { createHash } from 'crypto';
import dns from 'dns';
import { promisify } from 'util';

const dnsResolve = promisify(dns.resolve4);
const BALANCER_PORT = parseInt(process.env.BALANCER_PORT || '13003');

let backends = [];

function getTimestamp() {
    return new Date().toLocaleString('en-US', { hour12: false });
}

async function initBackends() {
    backends = [];
    if (process.env.BACKEND_DNS) {
        const serviceName = process.env.BACKEND_DNS;
        const port = parseInt(process.env.BACKEND_PORT || '13004');
        try {
            const ips = await dnsResolve(serviceName);
            for (const ip of ips) {
                backends.push({ host: ip, port, healthy: true, lastCheck: Date.now() });
            }
            console.log(`[${getTimestamp()}] DNS discovery: ${serviceName} -> ${ips.length} instances`);
        } catch (err) {
            console.error(`[${getTimestamp()}] DNS discovery failed: ${err.message}`);
            backends.push({ host: serviceName, port, healthy: true, lastCheck: Date.now() });
        }
    } else if (process.env.BACKEND_HOSTS) {
        for (const hostPort of process.env.BACKEND_HOSTS.split(',')) {
            const [host, port] = hostPort.trim().split(':');
            backends.push({ host, port: parseInt(port), healthy: true, lastCheck: Date.now() });
        }
    } else {
        const startPort = parseInt(process.env.BACKEND_START_PORT || '13004');
        const count = parseInt(process.env.BACKEND_COUNT || '5');
        for (let i = 0; i < count; i++) {
            backends.push({ host: '127.0.0.1', port: startPort + i, healthy: true, lastCheck: Date.now() });
        }
    }
    return backends;
}

await initBackends();

const ipMapping = new Map();

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.socket.remoteAddress || '127.0.0.1';
}

function selectBackend(clientIP) {
    if (ipMapping.has(clientIP)) {
        const cached = ipMapping.get(clientIP);
        const backend = backends[cached.index];
        if (backend && backend.healthy) return backend;
    }
    const healthyBackends = backends.filter(b => b.healthy);
    if (healthyBackends.length === 0) return backends[0];

    const hash = createHash('md5').update(clientIP).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % healthyBackends.length;
    const backend = healthyBackends[index];
    ipMapping.set(clientIP, { index: backends.indexOf(backend), timestamp: Date.now() });
    return backend;
}

function proxyRequest(req, res, backend) {
    const clientIP = getClientIP(req);
    const startTime = Date.now();
    const options = {
        hostname: backend.host,
        port: backend.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, 'x-forwarded-for': clientIP, 'x-real-ip': clientIP }
    };
    delete options.headers.host;

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on('end', () => {
            console.log(`[${getTimestamp()}] ${clientIP} -> ${backend.host}:${backend.port} | ${req.method} ${req.url} | ${proxyRes.statusCode} | ${Date.now() - startTime}ms`);
        });
    });

    proxyReq.on('error', (err) => {
        console.error(`[${getTimestamp()}] Backend error: ${err.message}`);
        backend.healthy = false;
        const other = backends.find(b => b.healthy && b !== backend);
        if (other) proxyRequest(req, res, other);
        else {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bad Gateway' }));
        }
    });
    req.pipe(proxyReq);
}

async function healthCheck() {
    for (const b of backends) {
        try {
            const res = await fetch(`http://${b.host}:${b.port}/health`, { signal: AbortSignal.timeout(3000) });
            b.healthy = res.ok;
        } catch { b.healthy = false; }
        b.lastCheck = Date.now();
    }
    console.log(`[${getTimestamp()}] Health check: ${backends.filter(b => b.healthy).length}/${backends.length} available`);
}

function getStatusPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Load Balancer Status</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f0f1a,#1a1a2e,#16213e);min-height:100vh;color:#fff;padding:20px}
.container{max-width:1400px;margin:0 auto}
.header{text-align:center;padding:40px 0 30px}
.header h1{font-size:36px;background:linear-gradient(90deg,#00d9ff,#00ff88);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header p{color:#888;font-size:16px}
.your-route{background:linear-gradient(135deg,rgba(0,217,255,0.1),rgba(0,255,136,0.1));border:2px solid rgba(0,217,255,0.3);border-radius:20px;padding:30px;margin-bottom:30px;position:relative;overflow:hidden}
.your-route-content{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;position:relative;z-index:1}
.route-box{background:rgba(0,0,0,0.3);border-radius:12px;padding:20px 30px;text-align:center;min-width:150px}
.route-box .label{color:#888;font-size:12px;margin-bottom:8px}
.route-box .value{font-size:24px;font-weight:bold;color:#00d9ff}
.route-box.target .value{color:#00ff88}
.route-arrow{font-size:40px;color:#00d9ff;animation:arrow-flow 1.5s ease-in-out infinite}
@keyframes arrow-flow{0%,100%{transform:translateX(0);opacity:1}50%{transform:translateX(10px);opacity:0.5}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px}
.stat-card{background:rgba(255,255,255,0.05);border-radius:12px;padding:25px;text-align:center}
.stat-card .number{font-size:42px;font-weight:bold;margin-bottom:5px}
.stat-card .label{color:#888;font-size:14px}
.stat-card.total .number{color:#00d9ff}
.stat-card.healthy .number{color:#00ff88}
.stat-card.unhealthy .number{color:#ff4757}
.nodes-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.node-card{background:rgba(255,255,255,0.05);border-radius:12px;padding:20px;border:2px solid transparent;transition:all 0.3s}
.node-card.online{border-color:rgba(0,255,136,0.3)}
.node-card.offline{border-color:rgba(255,71,87,0.3)}
.node-card.current{border-color:#00ff88;box-shadow:0 0 30px rgba(0,255,136,0.2);background:rgba(0,255,136,0.05)}
.node-card .node-header{display:flex;align-items:center;margin-bottom:15px}
.node-card .status-indicator{width:12px;height:12px;border-radius:50%;margin-right:10px;animation:blink 2s infinite}
.node-card.online .status-indicator{background:#00ff88}
.node-card.offline .status-indicator{background:#ff4757}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}
.node-card .node-name{font-size:16px;font-weight:bold;flex:1}
.node-card .current-badge{background:#00ff88;color:#000;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:bold}
.node-card .node-info{display:flex;justify-content:space-between;margin:8px 0;font-size:14px}
.node-card .node-info .label{color:#888}
.node-card .latency.good{color:#00ff88}
.node-card .latency.medium{color:#ffa502}
.node-card .latency.slow{color:#ff4757}
.node-card .error-msg{color:#ff4757;font-size:12px;margin-top:10px;padding:8px;background:rgba(255,71,87,0.1);border-radius:6px}
.footer{text-align:center;padding:30px;color:#666;font-size:14px}
.footer a{color:#00d9ff;text-decoration:none}
</style>
</head>
<body>
<div class="container">
<div class="header"><h1>Kiro API Gateway</h1><p>Load Balancer Status Monitor</p></div>
<div class="your-route"><div class="your-route-content">
<div class="route-box"><div class="label">Your IP</div><div class="value" id="clientIP">Detecting...</div></div>
<div class="route-arrow">→</div>
<div class="route-box"><div class="label">Load Balancer</div><div class="value">:13003</div></div>
<div class="route-arrow">→</div>
<div class="route-box target"><div class="label">Routed to Node</div><div class="value" id="targetNode">Calculating...</div></div>
</div></div>
<div class="stats">
<div class="stat-card total"><div class="number" id="totalNodes">-</div><div class="label">Total Nodes</div></div>
<div class="stat-card healthy"><div class="number" id="healthyNodes">-</div><div class="label">Healthy Nodes</div></div>
<div class="stat-card unhealthy"><div class="number" id="unhealthyNodes">-</div><div class="label">Unhealthy Nodes</div></div>
</div>
<div class="nodes-grid" id="nodesGrid"><div style="text-align:center;padding:50px;color:#666">Loading...</div></div>
<div class="footer">Auto-refresh every 5 seconds | Last update: <span id="lastUpdate">-</span><br><br><a href="/login.html">Admin Console</a></div>
</div>
<script>
let clientIP = null;
function hashIP(ip, n) { let h = 0; for (let i = 0; i < ip.length; i++) { h = ((h << 5) - h) + ip.charCodeAt(i); h = h & h; } return Math.abs(h) % n; }
async function fetchStatus() {
    try {
        if (!clientIP) { const r = await fetch('/api/client-ip'); clientIP = (await r.json()).ip || 'Unknown'; document.getElementById('clientIP').textContent = clientIP; }
        const res = await fetch('/lb/status'); const data = await res.json();
        const backends = data.backends, healthy = backends.filter(b => b.reachable);
        let targetIdx = 0;
        if (healthy.length > 0 && clientIP !== 'Unknown') { const hi = hashIP(clientIP, healthy.length); const tb = healthy[hi]; targetIdx = backends.findIndex(b => b.host === tb.host && b.port === tb.port); }
        document.getElementById('targetNode').textContent = backends[targetIdx] ? ':' + backends[targetIdx].port : '-';
        document.getElementById('totalNodes').textContent = data.summary.total;
        document.getElementById('healthyNodes').textContent = data.summary.healthy;
        document.getElementById('unhealthyNodes').textContent = data.summary.unhealthy;
        document.getElementById('nodesGrid').innerHTML = backends.map((b, i) => {
            const online = b.reachable, current = i === targetIdx;
            const lat = b.latency ? parseInt(b.latency) : null;
            const lc = lat !== null ? (lat < 50 ? 'good' : lat < 200 ? 'medium' : 'slow') : '';
            return '<div class="node-card ' + (online ? 'online' : 'offline') + (current ? ' current' : '') + '">' +
                '<div class="node-header"><div class="status-indicator"></div><div class="node-name">' + b.host + ':' + b.port + '</div>' +
                (current ? '<span class="current-badge">Current Node</span>' : '') + '</div>' +
                '<div class="node-info"><span class="label">Status</span><span>' + (online ? '✅ Online' : '❌ Offline') + '</span></div>' +
                '<div class="node-info"><span class="label">Latency</span><span class="latency ' + lc + '">' + (b.latency || '-') + '</span></div>' +
                '<div class="node-info"><span class="label">Health Check</span><span>' + (b.healthy ? 'Passed' : 'Failed') + '</span></div>' +
                (b.error ? '<div class="error-msg">Error: ' + b.error + '</div>' : '') + '</div>';
        }).join('');
        document.getElementById('lastUpdate').textContent = new Date().toLocaleString('en-US', { hour12: false });
    } catch (e) { console.error('Failed to fetch status:', e); }
}
fetchStatus(); setInterval(fetchStatus, 5000);
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
    if ((req.url === '/lb' || req.url === '/lb/') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getStatusPage());
        return;
    }
    if (req.url === '/lb/status' && req.method === 'GET') {
        const status = await Promise.all(backends.map(async (b) => {
            const start = Date.now();
            let reachable = false, latency = null, error = null;
            try {
                const r = await fetch(`http://${b.host}:${b.port}/health`, { signal: AbortSignal.timeout(3000) });
                reachable = r.ok; latency = Date.now() - start;
            } catch (e) { error = e.message; }
         return { host: b.host, port: b.port, healthy: b.healthy, reachable, latency: latency ? latency + 'ms' : null, error, lastCheck: new Date(b.lastCheck).toISOString() };
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            balancer: { port: BALANCER_PORT, mode: process.env.BACKEND_DNS ? 'dns' : process.env.BACKEND_HOSTS ? 'hosts' : 'local' },
            summary: { total: backends.length, healthy: status.filter(b => b.reachable).length, unhealthy: status.filter(b => !b.reachable).length },
            backends: status, cache: { size: ipMapping.size }, timestamp: new Date().toISOString()
        }, null, 2));
        return;
    }
    if (req.url === '/health' && req.method === 'GET') {
        const h = backends.filter(b => b.healthy).length;
        res.writeHead(h > 0 ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: h > 0 ? 'ok' : 'error', healthy_backends: h }));
        return;
    }
    const backend = selectBackend(getClientIP(req));
    proxyRequest(req, res, backend);
});

server.listen(BALANCER_PORT, () => {
    console.log(`[${getTimestamp()}] Load balancer started | http://localhost:${BALANCER_PORT}`);
    console.log(`[${getTimestamp()}] Backend instances: ${backends.map(b => b.host + ':' + b.port).join(', ')}`);
    console.log(`[${getTimestamp()}] Status page: http://localhost:${BALANCER_PORT}/lb`);
});

setInterval(healthCheck, 30000);
setInterval(() => { const exp = Date.now() - 3600000; for (const [k, v] of ipMapping) if (v.timestamp < exp) ipMapping.delete(k); }, 600000);
if (process.env.BACKEND_DNS) setInterval(async () => { const old = backends.length; await initBackends(); if (backends.length !== old) { console.log(`[${getTimestamp()}] Backend count changed: ${old} -> ${backends.length}`); ipMapping.clear(); } }, 60000);
setTimeout(healthCheck, 5000);
process.on('SIGINT', () => { console.log(`\n[${getTimestamp()}] Load balancer shutting down`); server.close(); process.exit(0); });
