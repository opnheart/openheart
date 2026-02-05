/**
 * OpenHeart Install Command
 *
 * 1. Check prerequisites (Node.js, Python, OpenClaw)
 * 2. Display privacy consent
 * 3. Install Python dependencies
 * 4. Install OpenClaw plugin
 * 5. Start daemon
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import * as readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENHEART_DIR = path.join(os.homedir(), ".openheart");
const OPENCLAW_PLUGINS_DIR = path.join(os.homedir(), ".openclaw", "plugins");
const CONFIG_FILE = path.join(OPENHEART_DIR, "config.json");

interface InstallOptions {
    skipConsent?: boolean;
    skipOpenclaw?: boolean;
}

export async function install(options: InstallOptions): Promise<void> {
    console.log("\nOpenHeart Installer\n");
    console.log("=".repeat(50));

    // Step 1: Check prerequisites
    console.log("\n[1/5] Checking prerequisites...\n");

    // Check Node.js
    const nodeVersion = process.version;
    console.log(`  ✓ Node.js ${nodeVersion} detected`);

    // Check Python
    try {
        const pythonVersion = execSync("python3 --version", { encoding: "utf-8" }).trim();
        console.log(`  ✓ ${pythonVersion} detected`);
    } catch {
        console.error("  ✗ Python 3 not found. Please install Python 3.8+");
        process.exit(1);
    }

    // Check OpenClaw
    if (!options.skipOpenclaw) {
        try {
            execSync("which openclaw", { encoding: "utf-8" });
            console.log("  ✓ OpenClaw installed");
        } catch {
            console.log("  ⚠ OpenClaw not found");

            const installOc = await askQuestion("  Would you like to install OpenClaw now? (Y/n): ");
            if (installOc.toLowerCase() !== "n") {
                console.log("\n  [Installing OpenClaw via install script...]");
                try {
                    // Install via official script (faster than npm)
                    execSync("curl -fsSL https://openclaw.ai/install.sh | bash", { stdio: "inherit" });
                    console.log("  ✓ OpenClaw installed successfully");

                    // Run initial setup visibly (correct command is 'onboard')
                    console.log("\n  [Running OpenClaw Setup...]");
                    const { spawnSync } = await import("child_process");
                    const result = spawnSync("openclaw", ["onboard"], { stdio: "inherit" });

                    if (result.status !== 0) {
                        console.log("  ⚠ OpenClaw onboarding had issues, you may need to run 'openclaw onboard' manually");
                    } else {
                        console.log("\n  ✓ OpenClaw setup complete");
                    }
                } catch (e) {
                    console.error("  ✗ Failed to install OpenClaw automatically.");
                    console.error("    Please try: curl -fsSL https://openclaw.ai/install.sh | bash");
                    process.exit(1);
                }
            } else {
                console.log("  ⚠ Continuing without OpenClaw. Plugin installation may fail.");
                const proceed = await askQuestion("  Continue? (y/N): ");
                if (proceed.toLowerCase() !== "y") {
                    process.exit(1);
                }
            }
        }
    }

    // Step 2: Privacy consent
    if (!options.skipConsent) {
        console.log("\n[2/5] Privacy consent...\n");

        console.log("  OpenHeart monitors keystroke timing patterns.\n");
        console.log("  What is collected:");
        console.log("    ✓ Keystroke timing intervals");
        console.log("    ✓ Backspace frequency");
        console.log("    ✓ Typing rhythm patterns\n");
        console.log("  What is NOT collected:");
        console.log("    ✗ Actual key contents");
        console.log("    ✗ Passwords or sensitive text");
        console.log("    ✗ Screen contents\n");
        console.log("  Data storage:");
        console.log("    • Local only (never sent to cloud)");
        console.log("    • Max retention: 60 seconds");
        console.log("    • Deleted on daemon stop\n");

        const consent = await askQuestion("  Do you consent to keystroke timing monitoring? (y/N): ");

        if (consent.toLowerCase() !== "y") {
            console.log("\n  Consent declined. Installation cancelled.");
            process.exit(0);
        }

        // Save consent
        fs.mkdirSync(OPENHEART_DIR, { recursive: true });
        const config = {
            consent_given: true,
            consent_timestamp: new Date().toISOString(),
            privacy_mode: "strict",
            data_retention_seconds: 60,
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("  ✓ Consent recorded\n");
    }

    // Step 3: Install Python dependencies
    console.log("[3/5] Installing Python dependencies...\n");

    try {
        const requirementsPath = path.join(__dirname, "..", "..", "requirements.txt");
        if (fs.existsSync(requirementsPath)) {
            execSync(`pip3 install -r ${requirementsPath}`, { stdio: "inherit" });
        } else {
            execSync("pip3 install pynput", { stdio: "inherit" });
        }
        console.log("  ✓ Python dependencies installed\n");
    } catch (e) {
        console.error("  ✗ Failed to install Python dependencies");
        console.error("    Try manually: pip3 install pynput");
    }

    // Step 4: Install OpenClaw plugin
    console.log("[4/5] Installing OpenClaw plugin...\n");

    const pluginDir = path.join(OPENCLAW_PLUGINS_DIR, "openheart");
    fs.mkdirSync(pluginDir, { recursive: true });

    // Copy plugin files
    const sourcePluginDir = path.join(__dirname, "..", "plugin");
    if (fs.existsSync(sourcePluginDir)) {
        copyDir(sourcePluginDir, pluginDir);
        console.log(`  ✓ Plugin installed to ${pluginDir}\n`);
    } else {
        console.log("  ⚠ Plugin source not found (dev mode)\n");
    }

    // Step 5: Start daemon
    console.log("[5/5] Starting daemon...\n");

    // Import and run start
    const { startDaemon } = await import("./daemon.js");
    await startDaemon({ dev: false });

    // Done
    console.log("\n" + "=".repeat(50));
    console.log("✓ Installation complete!\n");
    console.log("Next steps:");
    console.log("  • Verify: openheart status");
    console.log("  • Configure: vim ~/.openheart/config.json");
    console.log("  • Test: openclaw gateway");
    console.log("  • Logs: openheart logs\n");
    console.log("On macOS, you may need to grant Accessibility permissions:");
    console.log("  System Preferences → Security & Privacy → Privacy → Accessibility\n");
}

/**
 * Ask a question and wait for user input.
 */
function askQuestion(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Recursively copy a directory.
 */
function copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
