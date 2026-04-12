import { SerialPort } from "serialport";
import type { ScaleStatus } from "../../shared/types";

interface ScaleServiceOptions {
  portPath?: string;
  baudRate?: number;
  timeoutMs?: number;
  stableFramesRequired?: number;
  reconnectDelayMs?: number;
  usbPollIntervalMs?: number;
}

interface PendingRead {
  resolve: (weightKg: number) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  minStableSequence: number;
}

const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;
const LF = 0x0a;

export class ScaleService {
  private readonly portPath: string;
  private readonly baudRate: number;
  private readonly timeoutMs: number;
  private readonly stableFramesRequired: number;
  private readonly reconnectDelayMs: number;
  private readonly usbPollIntervalMs: number;

  private port: SerialPort | null = null;
  private connecting = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private usbPollTimer: NodeJS.Timeout | null = null;

  private connected = false;
  private devicePresent = false;
  private buffer = Buffer.alloc(0);
  private lastPayload: string | null = null;
  private stableCount = 0;
  private stableSequence = 0;
  private lastWeightKg: number | null = null;
  private lastUpdateAt: Date | null = null;
  private pendingReads: PendingRead[] = [];

  constructor(options: ScaleServiceOptions = {}) {
    this.portPath = options.portPath ?? process.env.SCALE_PORT ?? "/dev/ttyUSB0";
    this.baudRate = options.baudRate ?? 9600;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.stableFramesRequired = options.stableFramesRequired ?? 2;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1500;
    this.usbPollIntervalMs = options.usbPollIntervalMs ?? 1000;
  }

  start(): void {
    this.stopped = false;
    void this.refreshUsbStatus();
    this.usbPollTimer = setInterval(() => {
      void this.refreshUsbStatus();
    }, this.usbPollIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.usbPollTimer) {
      clearInterval(this.usbPollTimer);
      this.usbPollTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.rejectAllPending(new Error("Scale service stopped."));
    await this.closePort();
  }

  getStatus(): ScaleStatus {
    return {
      connected: this.connected,
      portPath: this.portPath,
      lastWeightKg: this.lastWeightKg,
      lastUpdateAt: this.lastUpdateAt ? this.lastUpdateAt.toISOString() : null
    };
  }

  async readStableWeightKg(): Promise<number> {
    if (!this.connected) {
      await this.ensureConnected();
    }

    if (!this.connected) {
      throw new Error("Balança desconectada.");
    }

    const startSequence = this.stableSequence;
    const hasRecentStableSample =
      this.stableCount >= this.stableFramesRequired &&
      this.lastWeightKg !== null &&
      this.lastUpdateAt !== null &&
      Date.now() - this.lastUpdateAt.getTime() <= 1500;

    if (hasRecentStableSample) {
      const cachedWeight = this.lastWeightKg;
      if (cachedWeight !== null) {
        return cachedWeight;
      }
    }

    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingReads = this.pendingReads.filter((entry) => entry !== pendingRead);
        reject(new Error("Balança sem resposta ou peso instável."));
      }, this.timeoutMs);

      const pendingRead: PendingRead = {
        resolve,
        reject,
        timeout,
        minStableSequence: startSequence + 1
      };

      this.pendingReads.push(pendingRead);
    });
  }

  private async refreshUsbStatus(): Promise<void> {
    if (this.stopped) {
      return;
    }

    let presentNow = false;
    try {
      const ports = await SerialPort.list();
      presentNow = ports.some((entry) => entry.path === this.portPath);
    } catch {
      presentNow = false;
    }

    if (presentNow !== this.devicePresent) {
      this.devicePresent = presentNow;

      if (!presentNow) {
        await this.closePort();
        this.rejectAllPending(new Error("Balança desconectada."));
        return;
      }
    }

    if (presentNow && !this.connected && !this.connecting) {
      this.openPort();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.refreshUsbStatus();

    if (!this.connected && !this.connecting) {
      this.openPort();
    }

    const deadline = Date.now() + Math.min(this.timeoutMs, 2000);
    while (Date.now() < deadline) {
      if (this.connected) {
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }

    if (!this.connected) {
      throw new Error("Balança desconectada.");
    }
  }

  private openPort(): void {
    if (this.stopped || this.connecting || this.connected || this.port?.isOpen) {
      return;
    }

    this.connecting = true;
    const serialPort = new SerialPort({
      path: this.portPath,
      baudRate: this.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false
    });

    serialPort.on("open", () => {
      this.port = serialPort;
      this.connecting = false;
      this.connected = true;
      this.buffer = Buffer.alloc(0);
      this.lastPayload = null;
      this.stableCount = 0;
    });

    serialPort.on("data", (chunk: Buffer) => {
      this.onData(chunk);
    });

    serialPort.on("error", () => {
      this.handlePortLost();
    });

    serialPort.on("close", () => {
      this.handlePortLost();
    });

    serialPort.open((error) => {
      if (error) {
        this.connecting = false;
        this.connected = false;
        this.scheduleReconnect();
      }
    });
  }

  private handlePortLost(): void {
    this.connected = false;
    this.connecting = false;
    this.buffer = Buffer.alloc(0);
    this.lastPayload = null;
    this.stableCount = 0;
    this.rejectAllPending(new Error("Balança desconectada."));
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        void this.refreshUsbStatus();
      }
    }, this.reconnectDelayMs);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      const stxIndex = this.buffer.indexOf(STX);
      if (stxIndex < 0) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      if (stxIndex > 0) {
        this.buffer = this.buffer.subarray(stxIndex);
      }

      const endIndex = this.findFrameEnd(this.buffer);
      if (endIndex < 0) {
        return;
      }

      const payload = this.buffer.subarray(1, endIndex).toString("ascii").trim();
      this.buffer = this.buffer.subarray(endIndex + 1);

      const weightKg = this.parseWeightPayload(payload);
      if (weightKg === null) {
        continue;
      }

      if (payload === this.lastPayload) {
        this.stableCount += 1;
      } else {
        this.lastPayload = payload;
        this.stableCount = 1;
      }

      this.lastWeightKg = weightKg;
      this.lastUpdateAt = new Date();

      if (this.stableCount >= this.stableFramesRequired && this.lastWeightKg !== null) {
        this.stableSequence += 1;
        this.resolvePendingReads(this.lastWeightKg);
      }
    }
  }

  private findFrameEnd(buffer: Buffer): number {
    const etxIndex = buffer.indexOf(ETX, 1);
    const crIndex = buffer.indexOf(CR, 1);
    const lfIndex = buffer.indexOf(LF, 1);
    const nextStxIndex = buffer.indexOf(STX, 1);

    const candidates = [etxIndex, crIndex, lfIndex, nextStxIndex].filter((value) => value >= 0);
    if (candidates.length === 0) {
      return -1;
    }

    return Math.min(...candidates);
  }

  private parseWeightPayload(payload: string): number | null {
    if (/^\d{5}$/.test(payload)) {
      return Number.parseInt(payload, 10) / 1000;
    }

    if (/^\d{2}\.\d{3}$/.test(payload) || /^\d+\.\d{3}$/.test(payload)) {
      return Number.parseFloat(payload);
    }

    if (/^\d{2},\d{3}$/.test(payload) || /^\d+,\d{3}$/.test(payload)) {
      return Number.parseFloat(payload.replace(",", "."));
    }

    return null;
  }

  private resolvePendingReads(weightKg: number): void {
    const pending = this.pendingReads;
    this.pendingReads = [];

    for (const entry of pending) {
      if (this.stableSequence >= entry.minStableSequence) {
        clearTimeout(entry.timeout);
        entry.resolve(weightKg);
      } else {
        this.pendingReads.push(entry);
      }
    }
  }

  private rejectAllPending(error: Error): void {
    const pending = this.pendingReads;
    this.pendingReads = [];

    for (const entry of pending) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
  }

  private async closePort(): Promise<void> {
    const current = this.port;
    this.port = null;
    this.connected = false;
    this.connecting = false;
    this.buffer = Buffer.alloc(0);
    this.lastPayload = null;
    this.stableCount = 0;

    if (!current) {
      return;
    }

    current.removeAllListeners();
    if (!current.isOpen) {
      return;
    }

    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });
  }
}
