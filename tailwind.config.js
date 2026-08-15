/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#111318",
        surface: "#22262f",
        panel: "#1a1d24",
        titlebar: "#0d0f14",
        border: "#2a2d35",
        primary: "#1D9E75",
        "primary-hover": "#1a8f69",
        "primary-dark": "#085041",
        danger: "#E24B4A",
        "danger-dark": "#791F1F",
        warning: "#EF9F27",
        "warning-dark": "#854F0B",
        info: "#378ADD",
        "text-primary": "#e8e6df",
        "text-secondary": "#c2c0b6",
        "text-muted": "#6b6a65",
        "text-dark": "#444441",
        "error-text": "#ff8d8d",
        "error-bg": "#2b1519",
        "error-border": "#3c1e24",
        "success-text": "#7fd1b6",
        "completed-text": "#7dc8ff",
        "cancelled-text": "#ff6f99",
        "scale-connected": "#00b386",
        "scale-disconnected": "#ff6f99",
        "scrollbar-track": "#171a20",
        "scrollbar-thumb-start": "#4a5160",
        "scrollbar-thumb-end": "#313744",
        "kbd-bg": "#111318",
        "kbd-border": "#2a2d35",
        "kbd-text": "#444441",
        "chart-revenue": "#1D9E75",
        "chart-sales": "#EF9F27",
        "chart-product": "#378ADD",
        "badge-open": "#22262f",
        "badge-open-text": "#6b6a65",
        "badge-completed": "#0a1f14",
        "badge-completed-text": "#1D9E75",
        "badge-cancelled": "#1f1215",
        "badge-cancelled-text": "#E24B4A",
        "status-low": "#2a2410",
        "status-low-text": "#EF9F27",
        "status-out": "#1f1215",
        "status-out-text": "#E24B4A"
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif"
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace"
        ],
        serif: [
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Georgia",
          "Cambria",
          "ui-serif",
          "serif"
        ]
      },
      borderRadius: {
        tag: "4px",
        input: "8px",
        card: "12px"
      },
      fontSize: {
        display: ["32px", { lineHeight: "1", fontWeight: "500" }],
        heading: ["16px", { lineHeight: "1.25", fontWeight: "500" }],
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        label: ["12px", { lineHeight: "1.5", fontWeight: "400" }],
        kbd: ["10px", { lineHeight: "1.2", fontWeight: "400" }]
      }
    }
  },
  plugins: []
};
