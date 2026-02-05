#!/usr/bin/env node
/**
 * OpenHeart CLI
 *
 * Commands:
 *   install   - Install OpenHeart (plugin + daemon)
 *   start     - Start the daemon
 *   stop      - Stop the daemon
 *   status    - Show daemon status
 *   logs      - Show daemon logs
 *   simulate  - Simulate stress state for testing
 */

import { Command } from "commander";
import { install } from "./install.js";
import { startDaemon, stopDaemon, getDaemonStatus, showLogs } from "./daemon.js";
import { simulate } from "./simulate.js";

const program = new Command();

program
    .name("openheart")
    .description("Biophysical awareness layer for AI agents")
    .version("0.1.0");

// Install command
program
    .command("install")
    .description("Install OpenHeart (downloads OpenClaw if needed, installs plugin)")
    .option("--skip-consent", "Skip privacy consent prompt (for CI)")
    .option("--skip-openclaw", "Skip OpenClaw installation check")
    .action(async (options) => {
        await install(options);
    });

// Daemon control commands
program
    .command("start")
    .description("Start the OpenHeart daemon")
    .option("--dev", "Run in development mode (verbose logging)")
    .action(async (options) => {
        await startDaemon(options);
    });

program
    .command("stop")
    .description("Stop the OpenHeart daemon")
    .action(async () => {
        await stopDaemon();
    });

program
    .command("status")
    .description("Show daemon status and current biometric state")
    .action(async () => {
        await getDaemonStatus();
    });

program
    .command("logs")
    .description("Show daemon logs (tail -f)")
    .option("-n, --lines <number>", "Number of lines to show", "50")
    .action(async (options) => {
        await showLogs(options);
    });

// Simulation for testing
program
    .command("simulate")
    .description("Simulate a biometric state for testing")
    .option("--preset <name>", "Use preset: high-stress, calm, deep-flow")
    .option("--stress <number>", "Set stress_index (0.0-1.0)")
    .option("--flow <state>", "Set flow_state (CALM, NORMAL, STRESSED, DEEP_FLOW)")
    .action(async (options) => {
        await simulate(options);
    });

program.parse();
