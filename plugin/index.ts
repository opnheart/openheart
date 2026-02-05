/**
 * OpenHeart Plugin for OpenClaw
 *
 * Reads biometric state from the OpenHeart daemon and injects
 * stress/focus context into every message before LLM processing.
 * Also exposes HTTP endpoints for mobile biometric sync.
 */

import { readBiometricState, type BiometricState } from "./state-reader.js";
import { registerBiometricRoutes } from "./api.js";

/**
 * Plugin handler for OpenClaw.
 * Hooks into message:pre_process to inject biometric context.
 */
export const openheartPlugin = {
    name: "openheart",
    version: "0.1.0",

    /**
     * Called when plugin is loaded. Registers HTTP routes for mobile sync.
     */
    onLoad(pluginApi: any) {
        registerBiometricRoutes(pluginApi);
        console.log("[openheart] Plugin loaded, HTTP routes registered");
    },


    hooks: {
        /**
         * Fires before every message is processed by the LLM.
         * Injects current biometric state into the message context.
         */
        "message:pre_process": async (event: MessageEvent) => {
            const state = await readBiometricState();

            // Inject biometric data into context
            event.context.biometrics = state;

            // Initialize precepts array if not present
            if (!Array.isArray(event.context.systemPrecepts)) {
                event.context.systemPrecepts = [];
            }

            // Add precepts based on biometric state
            if (state.stress_index > 0.7 && state.confidence > 0.5) {
                event.context.systemPrecepts.push("CONCISE_MODE");

                // Inject context note for the LLM
                event.context.biometricNote =
                    `[SYSTEM: User Biophysical Context]\n` +
                    `Stress Level: HIGH (${state.stress_index})\n` +
                    `Recommendation: Keep responses concise and direct. ` +
                    `Avoid follow-up questions unless essential.`;
            }

            if (state.flow_state === "DEEP_FLOW" && state.confidence > 0.5) {
                event.context.systemPrecepts.push("NO_INTERRUPT");

                event.context.biometricNote =
                    (event.context.biometricNote || "") +
                    `\n[SYSTEM: User is in DEEP FLOW state]\n` +
                    `Recommendation: Avoid interrupting with clarifying questions. ` +
                    `Provide complete answers without requiring user input.`;
            }

            // Log for debugging (only in dev mode)
            if (process.env.OPENHEART_DEBUG) {
                console.log(
                    `[openheart] State: stress=${state.stress_index}, ` +
                    `flow=${state.flow_state}, confidence=${state.confidence}`
                );
            }
        },
    },
};

/**
 * Message event type (subset of OpenClaw's full type).
 */
interface MessageEvent {
    id: string;
    timestamp: number;
    context: {
        biometrics?: BiometricState;
        biometricNote?: string;
        systemPrecepts?: string[];
        [key: string]: unknown;
    };
}

export default openheartPlugin;
