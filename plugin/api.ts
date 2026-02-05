/**
 * OpenHeart HTTP API
 *
 * Exposes endpoints for mobile devices to push biometric data
 * (Heart Rate, HRV) via the "Biological Bridge" architecture.
 *
 * Routes:
 *   POST /openheart/biometrics - Receive mobile health data
 *   GET  /openheart/status     - Health check endpoint
 */

import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

// Configuration
const OPENHEART_DIR = path.join(os.homedir(), ".openheart");
const STATE_SOCKET = path.join(OPENHEART_DIR, "state.sock");
const STATE_FILE = path.join(OPENHEART_DIR, "state.json");

/**
 * Biometric data received from mobile devices.
 */
interface MobileBiometricData {
    heart_rate?: number;   // BPM
    hrv?: number;          // Heart Rate Variability in ms
    source?: string;       // "ios_healthkit" | "android_fit" | "apple_watch"
    timestamp?: number;    // Unix epoch ms
}

/**
 * Register HTTP routes for mobile biometric sync.
 * 
 * This function should be called by the plugin to register routes
 * with OpenClaw's HTTP server.
 */
export function registerBiometricRoutes(pluginApi: any): void {
    const { registerHttpRoute } = pluginApi;

    // POST /openheart/biometrics - Receive mobile health data
    registerHttpRoute("POST", "/openheart/biometrics", handleBiometricsPost);

    // GET /openheart/status - Health check
    registerHttpRoute("GET", "/openheart/status", handleStatusGet);
}

/**
 * Handle POST /openheart/biometrics
 * 
 * Receives HRV/Heart Rate from mobile and converts to stress_index.
 */
async function handleBiometricsPost(req: any, res: any): Promise<void> {
    try {
        const data: MobileBiometricData = req.body;

        // Validate input
        if (!data.hrv && !data.heart_rate) {
            res.status(400).json({
                error: "Missing required field: hrv or heart_rate",
            });
            return;
        }

        // Convert HRV to stress index
        // Research shows: Low HRV = High Stress
        // Normal HRV: 50-100ms (RMSSD), Stressed: <30ms
        let stress_index = 0.5;

        if (data.hrv !== undefined) {
            // HRV-based calculation (primary)
            stress_index = hrvToStress(data.hrv);
        } else if (data.heart_rate !== undefined) {
            // Heart rate fallback (less accurate)
            stress_index = heartRateToStress(data.heart_rate);
        }

        // Determine flow state
        const flow_state = stressToFlowState(stress_index);

        // Build state object
        const state = {
            stress_index: Math.round(stress_index * 100) / 100,
            flow_state,
            timestamp: data.timestamp || Date.now(),
            ttl_seconds: 300, // 5 minutes (mobile data is less frequent)
            daemon_pid: -1,   // Not from daemon
            confidence: data.hrv ? 0.9 : 0.6, // HRV is more reliable
            source: data.source || "mobile_healthkit",
        };

        // Write to state file (daemon will pick it up)
        await writeStateFile(state);

        // Try to push to socket if daemon is running
        await pushToSocket(state);

        res.json({
            status: "updated",
            stress_index: state.stress_index,
            flow_state: state.flow_state,
            source: state.source,
        });
    } catch (error) {
        console.error("[openheart/api] Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

/**
 * Handle GET /openheart/status
 */
async function handleStatusGet(req: any, res: any): Promise<void> {
    try {
        const state = await readCurrentState();

        res.json({
            status: "ok",
            daemon_running: state.daemon_pid > 0,
            current_state: {
                stress_index: state.stress_index,
                flow_state: state.flow_state,
                source: state.source,
                age_ms: Date.now() - state.timestamp,
            },
        });
    } catch (error) {
        res.json({
            status: "degraded",
            daemon_running: false,
            error: "Unable to read state",
        });
    }
}

// --- Helper Functions ---

/**
 * Convert HRV (RMSSD in ms) to stress index.
 * 
 * Research basis:
 * - RMSSD > 80ms: Very relaxed (stress ~0.1)
 * - RMSSD 50-80ms: Normal (stress ~0.3-0.5)
 * - RMSSD 30-50ms: Elevated stress (stress ~0.6-0.7)
 * - RMSSD < 30ms: High stress (stress ~0.8-1.0)
 */
function hrvToStress(hrv: number): number {
    if (hrv >= 100) return 0.1;
    if (hrv >= 80) return 0.2;
    if (hrv >= 60) return 0.4;
    if (hrv >= 40) return 0.6;
    if (hrv >= 25) return 0.8;
    return 0.95;
}

/**
 * Convert heart rate (BPM) to stress index.
 * Less accurate than HRV - many factors affect HR.
 */
function heartRateToStress(hr: number): number {
    // Assuming resting context (not exercising)
    if (hr < 60) return 0.2;   // Very calm
    if (hr < 70) return 0.3;   // Calm
    if (hr < 80) return 0.5;   // Normal
    if (hr < 90) return 0.6;   // Slightly elevated
    if (hr < 100) return 0.75; // Elevated
    return 0.9;                // High (or exercising)
}

/**
 * Convert stress index to flow state label.
 */
function stressToFlowState(stress: number): string {
    if (stress < 0.25) return "DEEP_FLOW";
    if (stress < 0.4) return "CALM";
    if (stress < 0.65) return "NORMAL";
    return "STRESSED";
}

/**
 * Write state to JSON file.
 */
async function writeStateFile(state: any): Promise<void> {
    fs.mkdirSync(OPENHEART_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Push state to daemon via Unix socket.
 */
async function pushToSocket(state: any): Promise<void> {
    return new Promise((resolve) => {
        if (!fs.existsSync(STATE_SOCKET)) {
            resolve();
            return;
        }

        const client = net.createConnection(STATE_SOCKET);
        client.setTimeout(100);

        client.on("connect", () => {
            // Send update command
            client.write(JSON.stringify({ cmd: "update", state }));
            client.end();
            resolve();
        });

        client.on("error", () => resolve());
        client.on("timeout", () => {
            client.destroy();
            resolve();
        });
    });
}

/**
 * Read current state from file or socket.
 */
async function readCurrentState(): Promise<any> {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
    return {
        stress_index: 0,
        flow_state: "UNKNOWN",
        timestamp: 0,
        daemon_pid: -1,
        source: "none",
    };
}
