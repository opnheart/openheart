/**
 * OpenHeart Daemon Control
 *
 * Start, stop, and monitor the OpenHeart daemon.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import { spawn, execSync, ChildProcess } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENHEART_DIR = path.join(os.homedir(), ".openheart");
const PID_FILE = path.join(OPENHEART_DIR, "daemon.pid");
const LOG_FILE = path.join(OPENHEART_DIR, "openheart.log");
const STATE_SOCKET = path.join(OPENHEART_DIR, "state.sock");
const STATE_FILE = path.join(OPENHEART_DIR, "state.json");

interface DaemonOptions {
    dev?: boolean;
}

interface LogOptions {
    lines?: string;
}

/**
 * Start the OpenHeart daemon.
 */
export async function startDaemon(options: DaemonOptions): Promise<void> {
    // Check if already running
    if (isDaemonRunning()) {
        const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
        console.log(`  ⚠ Daemon already running (PID: ${pid})`);
        return;
    }

    // Find daemon script
    const daemonScript = findDaemonScript();
    if (!daemonScript) {
        console.error("  ✗ Daemon script not found");
        console.error("    Expected: daemon/main.py");
        process.exit(1);
    }

    // Ensure directory exists
    fs.mkdirSync(OPENHEART_DIR, { recursive: true });

    // Build command
    const args = [daemonScript];
    if (options.dev) {
        args.push("--dev");
    }

    // Start daemon as background process
    console.log("  Starting daemon...");

    const logStream = fs.openSync(LOG_FILE, "a");

    const daemon = spawn("python3", args, {
        detached: true,
        stdio: ["ignore", logStream, logStream],
    });

    daemon.unref();

    // Wait a moment for startup
    await sleep(1000);

    // Verify it started
    if (isDaemonRunning()) {
        const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
        console.log(`  ✓ Daemon started (PID: ${pid})`);

        // Run health check
        await sleep(500);
        const healthy = await healthCheck();
        if (healthy) {
            console.log("  ✓ Health check passed");
        } else {
            console.log("  ⚠ Health check failed (daemon may still be starting)");
        }
    } else {
        console.error("  ✗ Daemon failed to start");
        console.error("    Check logs: openheart logs");
        process.exit(1);
    }
}

/**
 * Stop the OpenHeart daemon.
 */
export async function stopDaemon(): Promise<void> {
    if (!fs.existsSync(PID_FILE)) {
        console.log("  Daemon not running (no PID file)");
        return;
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);

    try {
        // Send SIGTERM
        process.kill(pid, "SIGTERM");
        console.log(`  Stopping daemon (PID: ${pid})...`);

        // Wait for shutdown
        let attempts = 10;
        while (attempts > 0 && isProcessRunning(pid)) {
            await sleep(200);
            attempts--;
        }

        // Force kill if still running
        if (isProcessRunning(pid)) {
            process.kill(pid, "SIGKILL");
            console.log("  ⚠ Daemon force-killed");
        } else {
            console.log("  ✓ Daemon stopped");
        }
    } catch (e) {
        console.log("  Daemon process not found (already stopped)");
    }

    // Cleanup PID file
    if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
    }
}

/**
 * Show daemon status and current biometric state.
 */
export async function getDaemonStatus(): Promise<void> {
    console.log("\n🫀 OpenHeart Status\n");
    console.log("=".repeat(40));

    // Daemon status
    if (isDaemonRunning()) {
        const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
        console.log(`\nDaemon: ✓ Running (PID: ${pid})`);
    } else {
        console.log("\nDaemon: ✗ Not running");
        console.log("  Start with: openheart start\n");
        return;
    }

    // Socket status
    if (fs.existsSync(STATE_SOCKET)) {
        console.log(`Socket: ✓ ${STATE_SOCKET}`);
    } else {
        console.log("Socket: ✗ Not available");
    }

    // Current state
    console.log("\nCurrent Biometric State:");
    console.log("-".repeat(40));

    try {
        const state = await readState();
        const age = Date.now() - state.timestamp;

        console.log(`  Stress Index: ${formatStress(state.stress_index)}`);
        console.log(`  Flow State:   ${state.flow_state}`);
        console.log(`  Confidence:   ${(state.confidence * 100).toFixed(0)}%`);
        console.log(`  Source:       ${state.source}`);
        console.log(`  Age:          ${(age / 1000).toFixed(1)}s`);
        console.log(`  Daemon PID:   ${state.daemon_pid}`);
    } catch (e) {
        console.log("  ✗ Unable to read state");
        console.log(`    Error: ${(e as Error).message}`);
    }

    console.log("");
}

/**
 * Show daemon logs.
 */
export async function showLogs(options: LogOptions): Promise<void> {
    if (!fs.existsSync(LOG_FILE)) {
        console.log("No logs found.");
        console.log(`Expected: ${LOG_FILE}`);
        return;
    }

    const lines = parseInt(options.lines || "50", 10);

    // Use tail -f for live logs
    const tail = spawn("tail", ["-n", String(lines), "-f", LOG_FILE], {
        stdio: "inherit",
    });

    // Handle Ctrl+C
    process.on("SIGINT", () => {
        tail.kill();
        process.exit(0);
    });
}

// --- Helper functions ---

function isDaemonRunning(): boolean {
    if (!fs.existsSync(PID_FILE)) {
        return false;
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    return isProcessRunning(pid);
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function findDaemonScript(): string | null {
    // Look in common locations
    const locations = [
        path.join(__dirname, "..", "..", "daemon", "main.py"),
        path.join(process.cwd(), "daemon", "main.py"),
        path.join(os.homedir(), ".openheart", "daemon", "main.py"),
    ];

    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            return loc;
        }
    }

    return null;
}

async function healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
        if (!fs.existsSync(STATE_SOCKET)) {
            resolve(false);
            return;
        }

        const client = net.createConnection(STATE_SOCKET);
        client.setTimeout(1000);

        client.on("connect", () => {
            client.end();
            resolve(true);
        });

        client.on("error", () => {
            resolve(false);
        });

        client.on("timeout", () => {
            client.destroy();
            resolve(false);
        });
    });
}

async function readState(): Promise<any> {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(STATE_SOCKET)) {
            const client = net.createConnection(STATE_SOCKET);
            let data = "";

            client.setTimeout(1000);

            client.on("data", (chunk) => {
                data += chunk.toString();
            });

            client.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    reject(new Error("Invalid JSON"));
                }
            });

            client.on("error", (err) => {
                // Fall back to file
                if (fs.existsSync(STATE_FILE)) {
                    try {
                        resolve(JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")));
                    } catch {
                        reject(new Error("Invalid state file"));
                    }
                } else {
                    reject(err);
                }
            });

            client.on("timeout", () => {
                client.destroy();
                reject(new Error("Timeout"));
            });
        } else if (fs.existsSync(STATE_FILE)) {
            try {
                resolve(JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")));
            } catch {
                reject(new Error("Invalid state file"));
            }
        } else {
            reject(new Error("No state available"));
        }
    });
}

function formatStress(stress: number): string {
    const bar = "█".repeat(Math.round(stress * 10)) + "░".repeat(10 - Math.round(stress * 10));
    const label =
        stress < 0.3 ? "Low" : stress < 0.6 ? "Moderate" : stress < 0.8 ? "High" : "Critical";
    return `${bar} ${(stress * 100).toFixed(0)}% (${label})`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
