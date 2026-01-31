#!/usr/bin/env node
/**
 * Cluster Startup Script - Start multiple service instances
 * Usage: node src/cluster.js [instance count] [start port]
 * Default: 5 instances, starting from 13004
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INSTANCE_COUNT = parseInt(process.env.INSTANCE_COUNT || process.argv[2] || '5');
const START_PORT = parseInt(process.env.START_PORT || process.argv[3] || '13004');

const instances = [];

function getTimestamp() {
    return new Date().toLocaleString('en-US', { hour12: false });
}

function startInstance(port) {
    const env = { ...process.env, PORT: port.toString() };
    const child = spawn('node', [join(__dirname, '..', 'server.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
        process.stdout.write(`[${port}] ${data}`);
    });

    child.stderr.on('data', (data) => {
        process.stderr.write(`[${port}] ${data}`);
    });

    child.on('exit', (code) => {
        console.log(`[${getTimestamp()}] Instance ${port} exited, code: ${code}`);
        setTimeout(() => {
            console.log(`[${getTimestamp()}] Restarting instance ${port}...`);
            const index = instances.findIndex(i => i.port === port);
            if (index !== -1) {
                instances[index] = { port, process: startInstance(port) };
            }
        }, 1000);
    });

    return child;
}

console.log(`[${getTimestamp()}] Starting ${INSTANCE_COUNT} service instances...`);
console.log(`[${getTimestamp()}] Port range: ${START_PORT} - ${START_PORT + INSTANCE_COUNT - 1}`);

for (let i = 0; i < INSTANCE_COUNT; i++) {
    const port = START_PORT + i;
    instances.push({
        port,
        process: startInstance(port)
    });
    console.log(`[${getTimestamp()}] Starting instance ${i + 1}/${INSTANCE_COUNT} port: ${port}`);
}

process.on('SIGINT', () => {
    console.log(`\n[${getTimestamp()}] Shutting down all instances...`);
    instances.forEach(({ port, process }) => {
        console.log(`[${getTimestamp()}] Stopping instance ${port}`);
        process.kill('SIGTERM');
    });
    setTimeout(() => process.exit(0), 2000);
});

process.on('SIGTERM', () => {
    instances.forEach(({ process }) => process.kill('SIGTERM'));
    setTimeout(() => process.exit(0), 2000);
});

console.log(`[${getTimestamp()}] Cluster started, press Ctrl+C to stop all instances`);
