/**
 * OpenHeart Simulate Command
 *
 * Simulate biometric states for testing without the real daemon.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const OPENHEART_DIR = path.join(os.homedir(), ".openheart");
const STATE_FILE = path.join(OPENHEART_DIR, "state.json");

interface SimulateOptions {
    preset?: string;
    stress?: string;
    flow?: string;
}

const PRESETS: Record<string, { stress_index: number; flow_state: string }> = {
    "high-stress": { stress_index: 0.9, flow_state: "STRESSED" },
    calm: { stress_index: 0.2, flow_state: "CALM" },
    "deep-flow": { stress_index: 0.15, flow_state: "DEEP_FLOW" },
    normal: { stress_index: 0.5, flow_state: "NORMAL" },
};

export async function simulate(options: SimulateOptions): Promise<void> {
    console.log("\n🫀 OpenHeart State Simulator\n");

    let stress_index = 0.5;
    let flow_state = "NORMAL";

    // Apply preset
    if (options.preset) {
        const preset = PRESETS[options.preset];
        if (!preset) {
            console.error(`Unknown preset: ${options.preset}`);
            console.error(`Available: ${Object.keys(PRESETS).join(", ")}`);
            process.exit(1);
        }
        stress_index = preset.stress_index;
        flow_state = preset.flow_state;
        console.log(`Using preset: ${options.preset}`);
    }

    // Override with explicit values
    if (options.stress) {
        stress_index = parseFloat(options.stress);
        if (isNaN(stress_index) || stress_index < 0 || stress_index > 1) {
            console.error("Stress must be a number between 0.0 and 1.0");
            process.exit(1);
        }
    }

    if (options.flow) {
        flow_state = options.flow.toUpperCase();
        const validStates = ["CALM", "NORMAL", "STRESSED", "DEEP_FLOW", "UNKNOWN"];
        if (!validStates.includes(flow_state)) {
            console.error(`Invalid flow state: ${options.flow}`);
            console.error(`Available: ${validStates.join(", ")}`);
            process.exit(1);
        }
    }

    // Create simulated state
    const state = {
        stress_index,
        flow_state,
        timestamp: Date.now(),
        ttl_seconds: 300, // 5 minutes for simulation
        daemon_pid: process.pid,
        confidence: 1.0,
        source: "simulation",
    };

    // Write to state file
    fs.mkdirSync(OPENHEART_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    console.log("\nSimulated state written:");
    console.log(`  Stress Index: ${stress_index}`);
    console.log(`  Flow State:   ${flow_state}`);
    console.log(`  File:         ${STATE_FILE}`);
    console.log("\nThis state will be read by the OpenClaw plugin.");
    console.log("Note: Real-time socket updates require the actual daemon.\n");
}
