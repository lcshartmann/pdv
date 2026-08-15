#!/usr/bin/env node
/**
 * ESC/POS Receipt Binary Parser
 *
 * Reads receipt binary files (written by FileAdapter in printer.ts)
 * and outputs a human-readable text version by stripping control codes.
 *
 * Usage:
 *   node scripts/parse-receipt.js ~/Documents/pdv/receipts/receipt-2024-06-08T20-30-15-123Z.txt
 */

const fs = require("node:fs");
const path = require("node:path");

function parseEscPos(buffer) {
  const lines = [];
  let currentLine = "";
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i];

    // ESC (0x1B) - command prefix
    if (byte === 0x1b) {
      const cmd = buffer[i + 1];

      if (cmd === 0x40) {
        // ESC @ — Initialize printer
        i += 2;
        continue;
      }
      if (cmd === 0x61) {
        // ESC a — Alignment
        i += 3;
        continue;
      }
      if (cmd === 0x21) {
        // ESC ! — Print mode
        i += 3;
        continue;
      }
      if (cmd === 0x2d) {
        // ESC - — Underline
        i += 3;
        continue;
      }
      if (cmd === 0x45) {
        // ESC E — Bold
        i += 3;
        continue;
      }
      if (cmd === 0x47) {
        // ESC G — Double-strike
        i += 3;
        continue;
      }
      if (cmd === 0x33) {
        // ESC 3 — Set line spacing
        i += 3;
        continue;
      }
      if (cmd === 0x30) {
        // ESC 0 — Reset line spacing
        i += 2;
        continue;
      }
      if (cmd === 0x74) {
        // ESC t — Select code page
        i += 3;
        continue;
      }
      if (cmd === 0x52) {
        // ESC R — Select international character set
        i += 3;
        continue;
      }
      if (cmd === 0x64) {
        // ESC d — Print and feed n lines
        i += 3;
        continue;
      }
      if (cmd === 0x4a) {
        // ESC J — Print and feed paper
        i += 3;
        continue;
      }

      // Unknown ESC command, skip 2 bytes
      i += 2;
      continue;
    }

    // GS (0x1D) — Graphic commands
    if (byte === 0x1d) {
      const cmd = buffer[i + 1];

      if (cmd === 0x56) {
        // GS V — Cut paper
        i += 3;
        continue;
      }
      if (cmd === 0x28) {
        // GS ( — 2D barcode / QR code
        // Skip the entire command block
        const fn = buffer[i + 2];
        const pL = buffer[i + 3];
        const pH = buffer[i + 4];
        const len = (pH << 8) + pL + 3;
        i += len;
        continue;
      }
      if (cmd === 0x21) {
        // GS ! — Character size
        i += 3;
        continue;
      }
      if (cmd === 0x42) {
        // GS B — White-on-black
        i += 3;
        continue;
      }
      if (cmd === 0x6b) {
        // GS k — Print barcode
        const barcodeType = buffer[i + 2];
        let barcodeLen = 0;
        if (barcodeType <= 6) {
          // Variable length
          barcodeLen = buffer[i + 3];
          i += 4 + barcodeLen;
          continue;
        } else {
          // Fixed length
          barcodeLen = buffer[i + 3];
          i += 4 + barcodeLen;
          continue;
        }
      }
      if (cmd === 0x68) {
        // GS h — Barcode height
        i += 3;
        continue;
      }
      if (cmd === 0x77) {
        // GS w — Barcode width
        i += 3;
        continue;
      }
      if (cmd === 0x48) {
        // GS H — Barcode HRI
        i += 3;
        continue;
      }
      if (cmd === 0x66) {
        // GS f — Barcode font
        i += 3;
        continue;
      }
      if (cmd === 0x4c) {
        // GS L — Page mode
        i += 3;
        continue;
      }
      if (cmd === 0x57) {
        // GS W — Page mode area
        i += 5;
        continue;
      }
      if (cmd === 0x54) {
        // GS T — Page mode position
        i += 4;
        continue;
      }
      if (cmd === 0x2a) {
        // GS * — Download bit image
        const x = buffer[i + 2];
        const y = buffer[i + 3];
        const imgLen = x * y * 8;
        i += 4 + imgLen;
        continue;
      }
      if (cmd === 0x2f) {
        // GS / — Print downloaded bit image
        i += 3;
        continue;
      }

      // Unknown GS command, skip 2 bytes
      i += 2;
      continue;
    }

    // FS (0x1C) — Kanji commands
    if (byte === 0x1c) {
      i += 2;
      continue;
    }

    // DLE (0x10) — Real-time commands
    if (byte === 0x10) {
      i += 2;
      continue;
    }

    // HT (0x09) — Horizontal tab
    if (byte === 0x09) {
      currentLine += "\t";
      i++;
      continue;
    }

    // LF (0x0A) — Line feed
    if (byte === 0x0a) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = "";
      i++;
      continue;
    }

    // CR (0x0D) — Carriage return (ignore)
    if (byte === 0x0d) {
      i++;
      continue;
    }

    // FF (0x0C) — Form feed
    if (byte === 0x0c) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = "";
      i++;
      continue;
    }

    // NUL (0x00) — Null
    if (byte === 0x00) {
      i++;
      continue;
    }

    // Printable ASCII
    if (byte >= 0x20 && byte <= 0x7e) {
      currentLine += String.fromCharCode(byte);
      i++;
      continue;
    }

    // Extended ASCII / UTF-8 continuation
    if (byte >= 0x80) {
      // Try to read as UTF-8
      const start = i;
      let charLen = 1;

      if (byte >= 0xc2 && byte <= 0xdf) {
        charLen = 2;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        charLen = 3;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        charLen = 4;
      }

      if (i + charLen <= buffer.length) {
        const utf8Bytes = buffer.slice(i, i + charLen);
        try {
          const char = utf8Bytes.toString("utf-8");
          if (char.length === 1 && char.charCodeAt(0) >= 0x80) {
            currentLine += char;
            i += charLen;
            continue;
          }
        } catch {
          // Fall through to skip
        }
      }

      // Skip unknown byte
      i++;
      continue;
    }

    // Skip any other control bytes
    i++;
  }

  // Add final line if any
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines;
}

function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error("Usage: node scripts/parse-receipt.js <receipt-file>");
    console.error("\nExample:");
    console.error("  node scripts/parse-receipt.js ~/Documents/pdv/receipts/receipt-2024-06-08T20-30-15-123Z.txt");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputFile);
  const lines = parseEscPos(buffer);

  // Output as plain text
  console.log("=".repeat(48));
  console.log("  RECEIPT PARSE OUTPUT");
  console.log("=".repeat(48));
  console.log("");
  lines.forEach((line) => {
    console.log(line);
  });
  console.log("");
  console.log("=".repeat(48));
  console.log(`  Parsed ${lines.length} lines from ${buffer.length} bytes`);
  console.log("=".repeat(48));

  // Also write a .readable.txt file
  const outputFile = inputFile.replace(/\.txt$/, ".readable.txt");
  fs.writeFileSync(outputFile, lines.join("\n"), "utf-8");
  console.log("");
  console.log(`Readable version saved to: ${outputFile}`);
}

main();
