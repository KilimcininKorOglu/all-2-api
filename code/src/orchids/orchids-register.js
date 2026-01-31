/**
 * Orchids Auto Registration Service
 * Execute Python registration script and upload results to system
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import { OrchidsAPI } from './orchids-service.js';

const log = logger.api;

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Registration task status
const registerTasks = new Map();

/**
 * Registration Task class
 */
class RegisterTask {
    constructor(id, count, store, serverUrl) {
        this.id = id;
        this.count = count;
        this.store = store;
        this.serverUrl = serverUrl;
        this.status = 'pending';
        this.logs = [];
        this.progress = 0;
        this.success = 0;
        this.failed = 0;
        this.process = null;
        this.startTime = null;
        this.endTime = null;
    }

    addLog(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        this.logs.push({ timestamp, level, message });
        log.info(`[Register ${this.id}] ${message}`);
    }

    toJSON() {
        return {
            id: this.id,
            status: this.status,
            count: this.count,
            progress: this.progress,
            success: this.success,
            failed: this.failed,
            logs: this.logs.slice(-50), // Only return last 50 logs
            startTime: this.startTime,
            endTime: this.endTime,
            duration: this.endTime ? (this.endTime - this.startTime) : (this.startTime ? (Date.now() - this.startTime) : 0)
        };
    }
}

/**
 * Start registration task
 */
export async function startRegisterTask(count, store, serverUrl) {
    const taskId = `reg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const task = new RegisterTask(taskId, count, store, serverUrl);
    registerTasks.set(taskId, task);

    task.addLog(`Creating registration task: ${count} accounts`);
    task.status = 'running';
    task.startTime = Date.now();

    // Async execute registration
    executeRegister(task).catch(err => {
        task.addLog(`Task exception: ${err.message}`, 'ERROR');
        task.status = 'error';
        task.endTime = Date.now();
    });

    return taskId;
}

/**
 * Execute registration process
 */
async function executeRegister(task) {
    const scriptPath = path.join(__dirname, '..', '..', 'register', 'orchids_register.py');

    task.addLog(`Script path: ${scriptPath}`);
    task.addLog(`Starting registration of ${task.count} accounts...`);

    // Check if Python is available
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    return new Promise((resolve, reject) => {
        const args = [scriptPath, '--count', task.count.toString(), '--server', task.serverUrl];

        task.addLog(`Executing command: ${pythonCmd} ${args.join(' ')}`);

        const proc = spawn(pythonCmd, args, {
            cwd: path.dirname(scriptPath),
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                PYTHONIOENCODING: 'utf-8',
                PYTHONUTF8: '1'
            },
            // Windows requires shell mode for correct path handling
            shell: process.platform === 'win32'
        });

        task.process = proc;

        proc.stdout.on('data', async (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                task.addLog(line);
                
                // Parse progress (format: "Registering 1/10" or "Progress: 1/10")
                const progressMatch = line.match(/(?:Registering|Progress[:\s]*)\s*(\d+)\s*\/\s*(\d+)/i);
                if (progressMatch) {
                    task.progress = parseInt(progressMatch[1]);
                }

                // Parse success
                if (line.includes('Successfully extracted') || line.includes('Server save successful') || line.includes('SUCCESS')) {
                    task.success++;
                }

                // Parse client_key and directly add to database
                const clientKeyMatch = line.match(/CLIENT_KEY:(.+)/);
                if (clientKeyMatch && task.store) {
                    const clientKey = clientKeyMatch[1].trim();
                    await addAccountToStore(task, clientKey);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                task.addLog(line, 'ERROR');
                if (line.includes('❌')) {
                    task.failed++;
                }
            }
        });

        proc.on('close', (code) => {
            task.endTime = Date.now();
            if (code === 0) {
                task.status = 'completed';
                task.addLog(`Task completed: ${task.success} succeeded, ${task.failed} failed`);
            } else {
                task.status = 'error';
                task.addLog(`Task exited abnormally, code: ${code}`, 'ERROR');
            }
            resolve();
        });

        proc.on('error', (err) => {
            task.status = 'error';
            task.addLog(`Process error: ${err.message}`, 'ERROR');
            task.endTime = Date.now();
            reject(err);
        });
    });
}

/**
 * Add account to database
 */
async function addAccountToStore(task, clientKey) {
    try {
        task.addLog(`Validating and adding account...`);

        // Get full account info
        const accountInfo = await OrchidsAPI.getFullAccountInfo(clientKey);
        if (!accountInfo.success) {
            task.addLog(`Token validation failed: ${accountInfo.error}`, 'ERROR');
            return;
        }

        const name = accountInfo.email || `orchids-${Date.now()}`;

        // Check if already exists
        const existing = await task.store.getByName(name);
        if (existing) {
            task.addLog(`Account already exists: ${name}`, 'WARN');
            return;
        }

        await task.store.add({
            name,
            email: accountInfo.email,
            clientJwt: clientKey,
            clerkSessionId: accountInfo.sessionId,
            userId: accountInfo.userId,
            expiresAt: accountInfo.expiresAt,
            weight: 1
        });

        task.addLog(`Account added successfully: ${name}`);
        task.success++;
    } catch (error) {
        task.addLog(`Failed to add account: ${error.message}`, 'ERROR');
    }
}

/**
 * Get task status
 */
export function getRegisterTask(taskId) {
    return registerTasks.get(taskId);
}

/**
 * Get all tasks
 */
export function getAllRegisterTasks() {
    return Array.from(registerTasks.values()).map(t => t.toJSON());
}

/**
 * Cancel task
 */
export function cancelRegisterTask(taskId) {
    const task = registerTasks.get(taskId);
    if (task && task.process) {
        task.process.kill('SIGTERM');
        task.status = 'cancelled';
        task.endTime = Date.now();
        task.addLog('Task cancelled');
        return true;
    }
    return false;
}

/**
 * Clean up old tasks
 */
export function cleanupTasks() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [id, task] of registerTasks) {
        if (task.endTime && (now - task.endTime) > maxAge) {
            registerTasks.delete(id);
        }
    }
}

// Periodic cleanup
setInterval(cleanupTasks, 60 * 60 * 1000); // Clean up every hour

export default {
    startRegisterTask,
    getRegisterTask,
    getAllRegisterTasks,
    cancelRegisterTask
};
