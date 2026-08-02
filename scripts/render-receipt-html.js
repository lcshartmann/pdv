#!/usr/bin/env node
/**
 * ESC/POS Receipt HTML Renderer
 *
 * Reads receipt binary files and generates a styled HTML preview
 * that looks like a real thermal receipt.
 *
 * Usage:
 *   node scripts/render-receipt-html.js ~/Documents/pdv/receipts/receipt-2024-06-08T20-30-15-123Z.txt
 */

const fs = require("node:fs");
const path = require("node:path");

function parseEscPos(buffer) {
  const lines = [];
  let currentLine = "";
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i];

    // ESC (0x1B) — command prefix
    if (byte === 0x1b) {
      const cmd = buffer[i + 1];
      if (cmd === 0x40) {
        i += 2;
        continue;
      }
      if (cmd === 0x61) {
        i += 3;
        continue;
      }
      if (cmd === 0x21) {
        i += 3;
        continue;
      }
      if (cmd === 0x2d || cmd === 0x45 || cmd === 0x47 || cmd === 0x33 || cmd === 0x30 || cmd === 0x74 || cmd === 0x52 || cmd === 0x64 || cmd === 0x4a) {
        i += 3;
        continue;
      }
      i += 2;
      continue;
    }

    // GS (0x1D) — Graphic commands
    if (byte === 0x1d) {
      const cmd = buffer[i + 1];
      if (cmd === 0x56) {
        i += 3;
        continue;
      }
      if (cmd === 0x28) {
        const pL = buffer[i + 3];
        const pH = buffer[i + 4];
        const len = (pH << 8) + pL + 3;
        i += len;
        continue;
      }
      if (cmd === 0x21 || cmd === 0x42 || cmd === 0x68 || cmd === 0x77 || cmd === 0x48 || cmd === 0x66 || cmd === 0x4c || cmd === 0x54) {
        i += 3;
        continue;
      }
      if (cmd === 0x57) {
        i += 5;
        continue;
      }
      if (cmd === 0x6b) {
        const barcodeLen = buffer[i + 3];
        i += 4 + barcodeLen;
        continue;
      }
      if (cmd === 0x2a) {
        const x = buffer[i + 2];
        const y = buffer[i + 3];
        const imgLen = x * y * 8;
        i += 4 + imgLen;
        continue;
      }
      if (cmd === 0x2f) {
        i += 3;
        continue;
      }
      i += 2;
      continue;
    }

    // FS (0x1C) — Kanji
    if (byte === 0x1c) {
      i += 2;
      continue;
    }

    // DLE (0x10) — Real-time
    if (byte === 0x10) {
      i += 2;
      continue;
    }

    // HT (0x09)
    if (byte === 0x09) {
      currentLine += "    ";
      i++;
      continue;
    }

    // LF (0x0A)
    if (byte === 0x0a) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = "";
      i++;
      continue;
    }

    // CR (0x0D)
    if (byte === 0x0d) {
      i++;
      continue;
    }

    // FF (0x0C)
    if (byte === 0x0c) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = "";
      i++;
      continue;
    }

    // NUL (0x00)
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

    // Extended ASCII / UTF-8
    if (byte >= 0x80) {
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
          // fall through
        }
      }
      i++;
      continue;
    }

    i++;
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines;
}

function generateHtml(lines, filename) {
  const escapeHtml = (text) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const bodyContent = lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.includes("—".repeat(5)) || trimmed.includes("---") || trimmed.includes("=".repeat(5))) {
        return `<div class="line">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.toUpperCase().includes("TOTAL") || trimmed.includes("Venda #") || trimmed.includes("TOTAL:")) {
        return `<div class="line bold large">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.toUpperCase().includes("OBRIGADO") || trimmed.toUpperCase().includes("VOLTE")) {
        return `<div class="line center small">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.toUpperCase().includes("QR CODE") || trimmed.toUpperCase().includes("CONSULTE")) {
        return `<div class="line center">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.includes("R$") || trimmed.includes("Dinheiro") || trimmed.includes("PIX") || trimmed.includes("Cartão") || trimmed.includes("Recebido") || trimmed.includes("Troco")) {
        return `<div class="line">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.includes("Subtotal") || trimmed.includes("Desconto")) {
        return `<div class="line">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.includes("Pagamento")) {
        return `<div class="line">${escapeHtml(trimmed)}</div>`;
      }
      if (trimmed.includes("kg") || trimmed.includes("un")) {
        return `<div class="line">${escapeHtml(trimmed)}</div>`;
      }
      return `<div class="line">${escapeHtml(trimmed)}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt Preview — ${escapeHtml(path.basename(filename))}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #f5f5f5;
      font-family: "Courier New", "Courier", monospace;
      font-size: 14px;
      line-height: 1.6;
      display: flex;
      justify-content: center;
      padding: 40px 20px;
      min-height: 100vh;
    }
    .receipt {
      background: #fff;
      width: 80mm;
      max-width: 400px;
      padding: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      border: 1px solid #ddd;
    }
    .receipt .line {
      white-space: pre-wrap;
      word-break: break-word;
      color: #333;
      margin-bottom: 2px;
    }
    .receipt .line.center {
      text-align: center;
    }
    .receipt .line.bold {
      font-weight: bold;
    }
    .receipt .line.large {
      font-size: 16px;
    }
    .receipt .line.small {
      font-size: 12px;
      color: #666;
    }
    .header {
      text-align: center;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 2px dashed #ccc;
    }
    .footer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 2px dashed #ccc;
      text-align: center;
    }
    .info {
      font-size: 12px;
      color: #999;
      margin-top: 20px;
      text-align: center;
      font-family: system-ui, sans-serif;
    }
    .cut-line {
      border-bottom: 2px dashed #ccc;
      margin: 8px 0;
      height: 0;
    }
    @media print {
      body {
        background: #fff;
        padding: 0;
      }
      .receipt {
        box-shadow: none;
        border: none;
        width: 80mm;
      }
      .info {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="line bold large">Mercado Familiar</div>
      <div class="line small">Comprovante de Venda</div>
    </div>
    ${bodyContent}
    <div class="cut-line"></div>
    <div class="footer">
      <div class="line small">Mercado POS</div>
    </div>
  </div>
  <div class="info">
    <p>Generated from ${escapeHtml(path.basename(filename))}</p>
    <p>80mm thermal receipt format</p>
  </div>
</body>
</html>`;
}

function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error("Usage: node scripts/render-receipt-html.js <receipt-file>");
    console.error("\nExample:");
    console.error("  node scripts/render-receipt-html.js ~/Documents/pdv/receipts/receipt-2024-06-08T20-30-15-123Z.txt");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputFile);
  const lines = parseEscPos(buffer);
  const html = generateHtml(lines, inputFile);

  const outputFile = inputFile.replace(/\.txt$/, ".html");
  fs.writeFileSync(outputFile, html, "utf-8");

  console.log("Receipt rendered successfully!");
  console.log("");
  console.log(`HTML file: ${outputFile}`);
  console.log(`Lines parsed: ${lines.length}`);
  console.log(`Bytes read: ${buffer.length}`);
  console.log("");
  console.log("Open the HTML file in your browser to see the receipt preview.");
}

main();
