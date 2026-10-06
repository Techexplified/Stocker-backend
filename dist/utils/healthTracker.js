"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderHealthTracker = void 0;
class ProviderHealthTracker {
    failures = 0;
    lastError;
    lastFailureTime = 0;
    name;
    cooldownMs;
    constructor(name, cooldownMs = 60000) {
        this.name = name;
        this.cooldownMs = cooldownMs;
    }
    get isCircuitOpen() {
        if (this.failures >= 3) {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed < this.cooldownMs) {
                return true;
            }
            // Half-open: allow one probe request
            this.failures = 2;
        }
        return false;
    }
    get consecutiveFailures() {
        return this.failures;
    }
    get currentError() {
        return this.lastError;
    }
    recordSuccess() {
        if (this.failures > 0) {
            console.log(`[${this.name}] Provider recovered successfully.`);
        }
        this.failures = 0;
        this.lastError = undefined;
    }
    recordFailure(errorMsg) {
        this.failures++;
        this.lastError = errorMsg;
        this.lastFailureTime = Date.now();
        console.warn(`[${this.name}] Request failure (${this.failures}): ${errorMsg}${this.failures >= 3 ? " (circuit breaker activated for 60s)" : ""}`);
    }
    getStatus(isConfigured, isKeyless = false) {
        if (isKeyless) {
            return {
                configured: true,
                available: !this.isCircuitOpen,
                name: this.name,
                isKeyless: true,
                lastError: this.lastError,
                message: this.isCircuitOpen
                    ? `Temporarily unresponsive: ${this.lastError}`
                    : "Online (Keyless Public API)",
            };
        }
        if (!isConfigured) {
            return {
                configured: false,
                available: false,
                name: this.name,
                isKeyless: false,
                message: "API key not configured in .env (curated catalog fallback active)",
            };
        }
        if (this.isCircuitOpen) {
            return {
                configured: true,
                available: false,
                name: this.name,
                isKeyless: false,
                lastError: this.lastError,
                message: `Temporarily unavailable (${this.lastError}). Circuit breaker active.`,
            };
        }
        return {
            configured: true,
            available: true,
            name: this.name,
            isKeyless: false,
            lastError: this.lastError,
            message: "Ready & Connected",
        };
    }
}
exports.ProviderHealthTracker = ProviderHealthTracker;
