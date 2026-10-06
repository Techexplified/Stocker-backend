import { ProviderStatusInfo } from "../types.js";

export class ProviderHealthTracker {
  private failures = 0;
  private lastError?: string;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly cooldownMs: number;

  constructor(name: string, cooldownMs = 60000) {
    this.name = name;
    this.cooldownMs = cooldownMs;
  }

  get isCircuitOpen(): boolean {
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

  get consecutiveFailures(): number {
    return this.failures;
  }

  get currentError(): string | undefined {
    return this.lastError;
  }

  recordSuccess(): void {
    if (this.failures > 0) {
      console.log(`[${this.name}] Provider recovered successfully.`);
    }
    this.failures = 0;
    this.lastError = undefined;
  }

  recordFailure(errorMsg: string): void {
    this.failures++;
    this.lastError = errorMsg;
    this.lastFailureTime = Date.now();
    console.warn(
      `[${this.name}] Request failure (${this.failures}): ${errorMsg}${
        this.failures >= 3 ? " (circuit breaker activated for 60s)" : ""
      }`
    );
  }

  getStatus(isConfigured: boolean, isKeyless = false): ProviderStatusInfo {
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
