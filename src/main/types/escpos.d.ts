declare module "escpos" {
  import { EventEmitter } from "events";

  interface Adapter {
    open(callback: (err?: Error) => void): void;
    write(data: Buffer, callback: (err?: Error) => void): void;
    close(callback?: (err?: Error) => void): void;
    read?(callback: (data: Buffer) => void): void;
  }

  interface PrinterOptions {
    encoding?: string;
    width?: number;
  }

  class Printer extends EventEmitter {
    constructor(adapter: Adapter, options?: PrinterOptions);

    font(type: "a" | "b"): this;
    align(align: "lt" | "ct" | "rt"): this;
    style(style: string): this;
    size(width: number, height: number): this;
    text(content: string, encoding?: string): this;
    println(content: string): this;
    newLine(): this;
    drawLine(): this;
    table(data: string[], encoding?: string): this;
    tableCustom(
      data: Array<{
        text: string;
        align?: "LEFT" | "CENTER" | "RIGHT";
        width?: number;
        style?: string;
        cols?: number;
      }>,
      options?: { size?: number[]; encoding?: string }
    ): this;
    qrimage(
      content: string,
      options?: { type?: string; mode?: string } | null,
      callback?: (err: Error | null) => void
    ): this;
    cut(part?: boolean, feed?: number): this;
    close(callback?: (err?: Error) => void): this;
    flush(callback?: (err?: Error) => void): this;
    encode(encoding: string): this;
  }

  namespace Printer {
    function create(device: Adapter): Promise<Printer>;
    const Printer: typeof Printer;
    const Image: any;
    const command: any;
  }

  export = Printer;
}

declare module "escpos-usb" {
  import { EventEmitter } from "events";

  class USB extends EventEmitter {
    constructor(vid?: number, pid?: number);
    open(callback: (err?: Error) => void): void;
    write(data: Buffer, callback: (err?: Error) => void): void;
    close(callback?: (err?: Error) => void): void;
    static findPrinter(): Array<{ deviceDescriptor: { idVendor: number; idProduct: number } }>;
  }

  export = USB;
}

declare module "escpos-network" {
  import { EventEmitter } from "events";

  class Network extends EventEmitter {
    constructor(address: string, port?: number);
    open(callback: (err?: Error) => void): void;
    write(data: Buffer, callback: (err?: Error) => void): void;
    close(callback?: (err?: Error) => void): void;
  }

  export = Network;
}
