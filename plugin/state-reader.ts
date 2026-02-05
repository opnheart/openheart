/**
 * OpenHeart State Reader
 *
 * Reads biometric state from the OpenHeart daemon via:
 * 1. Unix socket (primary, <1ms latency)
 * 2. JSON file (fallback)
 * 3. Default values (graceful degradation)
 */

import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

// Configuration
const OPENHEART_DIR = path.join(os.homedir(), ".openheart");
const STATE_SOCKET = path.join(OPENHEART_DIR, "state.sock");
const STATE_FILE = path.join(OPENHEART_DIR, "state.json");
const MAX_STALENESS_MS = 60_000; // 60 seconds
const SOCKET_TIMEOUT_MS = 100; // 100ms timeout for socket reads

/**
 * Biometric state from the daemon.
 */
export interface BiometricState {
    stress_index: number; // 0.0 to 1.0
    flow_state: "CALM" | "NORMAL" | "STRESSED" | "DEEP_FLOW" | "UNKNOWN";
    timestamp: number; // Unix epoch milliseconds
    ttl_seconds: number;
    daemon_pid: number;
    confidence: number; // 0.0 to 1.0
    source: string; // "keystroke", "mouse", "calendar", "default"
}

/**
 * Read biometric state from daemon.
 * Tries socket first, falls back to file, then defaults.
 */
export async function readBiometricState(): Promise<BiometricState> {
    try {
        // Primary: Unix socket (real-time)
        const state = await readFromSocket();
        return validateState(state);
    } catch (socketError) {
        // Log socket failure (only in dev mode)
        if (process.env.OPENHEART_DEBUG) {
            console.warn(
                `[openheart] Socket read failed: ${(socketError as Error).message}`
            );
        }

        try {
            // Fallback: JSON file
            const state = readFromFile();
            return validateState(state);
        } catch (fileError) {
            // Log file failure
            if (process.env.OPENHEART_DEBUG) {
                console.warn(
                    `[openheart] File read failed: ${(fileError as Error).message}`
                );
            }

            // Graceful degradation: return defaults
            return getDefaultState();
        }
    }
}

/**
 * Read state from Unix socket.
 * Returns within SOCKET_TIMEOUT_MS or throws.
 */
async function readFromSocket(): Promise<BiometricState> {
    return new Promise((resolve, reject) => {
        // Check if socket exists
        if (!fs.existsSync(STATE_SOCKET)) {
            reject(new Error("Socket file does not exist"));
            return;
        }

        const client = net.createConnection(STATE_SOCKET);
        let data = "";

        client.setTimeout(SOCKET_TIMEOUT_MS);

        client.on("connect", () => {
            // Connection established, wait for data
        });

        client.on("data", (chunk) => {
            data += chunk.toString();
        });

        client.on("end", () => {
            try {
                const state = JSON.parse(data) as BiometricState;
                resolve(state);
            } catch (e) {
                reject(new Error("Invalid JSON from daemon"));
            }
        });

        client.on("error", (err) => {
            reject(err);
        });

        client.on("timeout", () => {
            client.destroy();
            reject(new Error("Socket read timeout"));
        });
    });
}

/**
 * Read state from JSON file.
 */
function readFromFile(): BiometricState {
    if (!fs.existsSync(STATE_FILE)) {
        throw new Error("State file does not exist");
    }

    const content = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(content) as BiometricState;
}

/**
 * Validate state freshness and daemon health.
 * Returns defaults if state is stale or daemon is dead.
 */
function validateState(state: BiometricState): BiometricState {
    const now = Date.now();
    const age = now - state.timestamp;

    // Check staleness
    if (age > MAX_STALENESS_MS) {
        if (process.env.OPENHEART_DEBUG) {
            console.warn(`[openheart] State is stale (${age}ms old), using defaults`);
        }
        return getDefaultState();
    }

    // Check if daemon is still alive
    if (!isDaemonAlive(state.daemon_pid)) {
        if (process.env.OPENHEART_DEBUG) {
            console.warn("[openheart] Daemon appears dead, using defaults");
        }
        return getDefaultState();
    }

    return state;
}

/**
 * Check if the daemon process is still running.
 */
function isDaemonAlive(pid: number): boolean {
    if (pid <= 0) return false;

    try {
        // Signal 0 checks if process exists without killing it
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get default state for graceful degradation.
 */
function getDefaultState(): BiometricState {
    return {
        stress_index: 0.0,
        flow_state: "UNKNOWN",
        timestamp: Date.now(),
        ttl_seconds: 0,
        daemon_pid: -1,
        confidence: 0.0,
        source: "default",
    };
}
