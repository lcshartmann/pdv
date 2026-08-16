import { useCallback, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import {
  Scale,
  Printer,
  ReceiptText,
  Database,
  RefreshCw,
  Save,
  Wifi,
  Printer as PrinterIcon,
  Download,
  Upload,
  Trash2,
  ChevronRight
} from "lucide-react";
import NavBar from "../components/NavBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { cn } from "../lib/utils";
import type {
  AppSettings,
  ScaleStatus,
  SerialPortInfo
} from "../../shared/types";

type SectionId = "scale" | "printer" | "receipt" | "data";

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  desc: string;
}> = [
  {
    id: "scale",
    label: "Balança",
    icon: Scale,
    desc: "Porta serial, velocidade e leitura de peso ao vivo."
  },
  {
    id: "printer",
    label: "Impressora",
    icon: Printer,
    desc: "Conexão da impressora térmica e teste de impressão."
  },
  {
    id: "receipt",
    label: "Recibo",
    icon: ReceiptText,
    desc: "Identidade da loja e layout do cupom."
  },
  {
    id: "data",
    label: "Dados",
    icon: Database,
    desc: "Backup, restauração e manutenção do banco."
  }
];

const SECTION_KEYS: Record<Exclude<SectionId, "data">, Array<keyof AppSettings>> =
  {
    scale: [
      "scalePort",
      "scaleBaudRate",
      "scaleTimeoutMs",
      "scaleStableFramesRequired",
      "scaleReconnectDelayMs",
      "scaleUsbPollIntervalMs"
    ],
    printer: ["printerType", "printerAddress"],
    receipt: [
      "storeName",
      "receiptFooter",
      "receiptShowQr",
      "storeCnpj",
      "storeAddress",
      "storePhone"
    ]
  };

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

const inputClass =
  "h-10 w-full rounded-lg border border-[#343945] bg-[#0f131f] px-3 py-2 text-sm text-[#e8e6df] outline-none transition-colors placeholder:text-[#6b6a65] hover:border-[#3f4552] focus:border-[#2ad6a2] focus:ring-2 focus:ring-[#2ad6a2]/25";
const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-medium text-[#08130f] transition-colors hover:bg-[#23b487] disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center gap-2 rounded-lg border border-[#343945] bg-[#22262f] px-3.5 py-2 text-sm text-[#c2c0b6] transition-colors hover:border-[#3f4552] hover:text-[#e8e6df] disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-lg border border-[#5a2222] bg-[#1f1215] px-3.5 py-2 text-sm font-medium text-[#ff8d8d] transition-colors hover:bg-[#2a181c] disabled:cursor-not-allowed disabled:opacity-50";
const cardClass = "rounded-xl border border-[#2a2d35] bg-[#181b22] p-5";

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[#c2c0b6]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#6b6a65]">{hint}</span> : null}
    </label>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  desc
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#1D9E75]/30 bg-[#123028] text-[#7fd1b6]">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h1 className="font-serif text-[26px] leading-tight text-[#f3f1eb]">
          {title}
        </h1>
        <p className="text-sm text-[#8d8c89]">{desc}</p>
      </div>
    </div>
  );
}

export default function SettingsPage(): JSX.Element {
  const [form, setForm] = useState<AppSettings | null>(null);
  const [section, setSection] = useState<SectionId>("scale");
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [scaleStatus, setScaleStatus] = useState<ScaleStatus | null>(null);
  const [savingSection, setSavingSection] = useState<SectionId | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPorts = useCallback(async () => {
    try {
      setPorts(await window.api.listSerialPorts());
    } catch {
      // lista de portas é best-effort; ignora falha.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setForm(await window.api.settingsGetAll());
    })();
    void loadPorts();
  }, [loadPorts]);

  // Leitura de peso ao vivo — só enquanto a seção da balança está aberta.
  useEffect(() => {
    if (section !== "scale") {
      return;
    }
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const status = await window.api.scaleGetStatus();
        if (active) {
          setScaleStatus(status);
        }
      } catch {
        // ignora
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [section]);

  const setField = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const saveSection = useCallback(
    async (id: Exclude<SectionId, "data">) => {
      if (!form) {
        return;
      }
      const partial: Partial<AppSettings> = {};
      for (const key of SECTION_KEYS[id]) {
        (partial as Record<string, unknown>)[key] = form[key];
      }
      setSavingSection(id);
      try {
        const next = await window.api.settingsUpdate(partial);
        setForm(next);
        toast.success("Configurações salvas.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha ao salvar."
        );
      } finally {
        setSavingSection(null);
      }
    },
    [form]
  );

  const testPrint = useCallback(async () => {
    setBusy(true);
    try {
      const result = await window.api.printerTest();
      if (result.ok) {
        toast.success("Cupom de teste enviado.");
      } else {
        toast.error(result.error ?? "Falha ao imprimir teste.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const checkNetwork = useCallback(async () => {
    if (!form) {
      return;
    }
    setBusy(true);
    try {
      const { reachable } = await window.api.printerCheckNetwork({
        address: form.printerAddress
      });
      if (reachable) {
        toast.success("Impressora de rede acessível.");
      } else {
        toast.error("Impressora de rede não respondeu.");
      }
    } finally {
      setBusy(false);
    }
  }, [form]);

  const backup = useCallback(async () => {
    setBusy(true);
    try {
      const result = await window.api.dataBackup();
      if (!result.canceled && result.path) {
        toast.success(`Backup salvo em ${result.path}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no backup.");
    } finally {
      setBusy(false);
    }
  }, []);

  const restore = useCallback(async () => {
    const confirmed = window.confirm(
      "Restaurar um backup substitui todos os dados atuais e reinicia o aplicativo. O banco atual será salvo como .pre-restore. Continuar?"
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.api.dataRestore();
      if (result.invalid) {
        toast.error("Arquivo inválido: não é um banco do PDV.");
      }
      // Em caso de sucesso o app reinicia, então não há o que fazer aqui.
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao restaurar."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const clearStock = useCallback(async () => {
    const confirmed = window.confirm(
      "Zerar o estoque de TODOS os produtos? Esta ação não pode ser desfeita."
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await window.api.dataClearStock();
      toast.success("Estoque zerado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao zerar.");
    } finally {
      setBusy(false);
    }
  }, []);

  const saveButton = (id: Exclude<SectionId, "data">, label: string) => (
    <div className="flex justify-end border-t border-[#23262e] pt-4">
      <button
        type="button"
        className={primaryBtn}
        disabled={savingSection === id}
        onClick={() => void saveSection(id)}
      >
        <Save className="h-4 w-4" />
        {savingSection === id ? "Salvando…" : label}
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111318] text-[#e8e6df]">
      <NavBar />
      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-1 border-r border-[#2a2d35] bg-[#0f131f] p-3">
          <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#565a62]">
            Configurações
          </p>
          {SECTIONS.map((item) => {
            const active = section === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  active
                    ? "border-[#1D9E75]/25 bg-[#132a23] text-[#e8e6df]"
                    : "border-transparent text-[#9d9c99] hover:bg-[#181b22] hover:text-[#e8e6df]"
                )}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#1D9E75]" />
                ) : null}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active
                      ? "text-[#7fd1b6]"
                      : "text-[#6b6a65] group-hover:text-[#c2c0b6]"
                  )}
                />
                {item.label}
                <ChevronRight
                  className={cn(
                    "ml-auto h-4 w-4 transition-all",
                    active
                      ? "text-[#7fd1b6] opacity-100"
                      : "text-[#3f4552] opacity-0 group-hover:opacity-100"
                  )}
                />
              </button>
            );
          })}
        </aside>

        <main className="custom-scrollbar min-h-0 overflow-y-auto bg-[radial-gradient(120%_100%_at_50%_0%,#171b23_0%,#111318_55%)]">
          {!form ? (
            <p className="p-8 text-sm text-[#8d8c89]">Carregando…</p>
          ) : (
            <div
              key={section}
              className="mx-auto flex max-w-[620px] animate-in flex-col gap-6 p-8 fade-in slide-in-from-bottom-2 duration-300"
            >
              {section === "scale" ? (
                <>
                  <SectionHeader
                    icon={Scale}
                    title="Balança"
                    desc="Configure a leitura de peso da balança serial."
                  />

                  <div
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-5 py-4",
                      scaleStatus?.connected
                        ? "border-[#1D9E75]/30 bg-[#102821]"
                        : "border-[#3c1e24] bg-[#1c1216]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-2.5 w-2.5">
                        {scaleStatus?.connected ? (
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00b386] opacity-60" />
                        ) : null}
                        <span
                          className={cn(
                            "relative inline-flex h-2.5 w-2.5 rounded-full",
                            scaleStatus?.connected
                              ? "bg-[#00b386]"
                              : "bg-[#ff6f99]"
                          )}
                        />
                      </span>
                      <span className="text-sm text-[#c2c0b6]">
                        {scaleStatus?.connected ? "Conectada" : "Desconectada"}
                      </span>
                    </div>
                    <span className="font-serif text-2xl tabular-nums text-[#f3f1eb]">
                      {scaleStatus?.connected &&
                      scaleStatus.lastWeightKg !== null
                        ? `${scaleStatus.lastWeightKg
                            .toFixed(3)
                            .replace(".", ",")} kg`
                        : "—"}
                    </span>
                  </div>

                  <div className={cn(cardClass, "flex flex-col gap-5")}>
                    <Field
                      label="Porta serial"
                      hint="Selecione uma porta detectada ou digite manualmente."
                    >
                      <input
                        className={inputClass}
                        value={form.scalePort}
                        onChange={(e) => setField("scalePort", e.target.value)}
                        placeholder="/dev/ttyUSB0"
                      />
                    </Field>

                    <div className="flex flex-wrap items-center gap-2">
                      {ports.length > 0 ? (
                        <>
                          <span className="text-xs text-[#6b6a65]">
                            Detectadas:
                          </span>
                          {ports.map((p) => (
                            <button
                              key={p.path}
                              type="button"
                              onClick={() => setField("scalePort", p.path)}
                              title={p.manufacturer ?? undefined}
                              className={cn(
                                "rounded-md border px-2 py-1 text-xs transition-colors",
                                form.scalePort === p.path
                                  ? "border-[#1D9E75]/40 bg-[#132a23] text-[#7fd1b6]"
                                  : "border-[#343945] bg-[#0f131f] text-[#c2c0b6] hover:border-[#3f4552]"
                              )}
                            >
                              {p.path}
                            </button>
                          ))}
                        </>
                      ) : (
                        <span className="text-xs text-[#6b6a65]">
                          Nenhuma porta detectada.
                        </span>
                      )}
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#8d8c89] transition-colors hover:text-[#c2c0b6]"
                        onClick={() => void loadPorts()}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Atualizar
                      </button>
                    </div>

                    <Field label="Baud rate">
                      <Select
                        value={String(form.scaleBaudRate)}
                        onValueChange={(v) =>
                          setField("scaleBaudRate", Number(v))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BAUD_RATES.map((rate) => (
                            <SelectItem key={rate} value={String(rate)}>
                              {rate} baud
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <details className="group rounded-lg border border-[#23262e] bg-[#0f131f] p-3">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-[#c2c0b6]">
                        <ChevronRight className="h-4 w-4 text-[#6b6a65] transition-transform group-open:rotate-90" />
                        Avançado
                      </summary>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <Field label="Timeout de leitura (ms)">
                          <input
                            type="number"
                            className={inputClass}
                            value={form.scaleTimeoutMs}
                            onChange={(e) =>
                              setField("scaleTimeoutMs", Number(e.target.value))
                            }
                          />
                        </Field>
                        <Field label="Frames estáveis">
                          <input
                            type="number"
                            className={inputClass}
                            value={form.scaleStableFramesRequired}
                            onChange={(e) =>
                              setField(
                                "scaleStableFramesRequired",
                                Number(e.target.value)
                              )
                            }
                          />
                        </Field>
                        <Field label="Reconexão (ms)">
                          <input
                            type="number"
                            className={inputClass}
                            value={form.scaleReconnectDelayMs}
                            onChange={(e) =>
                              setField(
                                "scaleReconnectDelayMs",
                                Number(e.target.value)
                              )
                            }
                          />
                        </Field>
                        <Field label="Polling USB (ms)">
                          <input
                            type="number"
                            className={inputClass}
                            value={form.scaleUsbPollIntervalMs}
                            onChange={(e) =>
                              setField(
                                "scaleUsbPollIntervalMs",
                                Number(e.target.value)
                              )
                            }
                          />
                        </Field>
                      </div>
                    </details>

                    {saveButton("scale", "Salvar balança")}
                  </div>
                </>
              ) : null}

              {section === "printer" ? (
                <>
                  <SectionHeader
                    icon={Printer}
                    title="Impressora"
                    desc="Configure a impressora térmica de cupons."
                  />

                  <div className={cn(cardClass, "flex flex-col gap-5")}>
                    <Field label="Tipo de conexão">
                      <Select
                        value={form.printerType}
                        onValueChange={(v) =>
                          setField(
                            "printerType",
                            v as AppSettings["printerType"]
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="file">
                            Arquivo / dispositivo
                          </SelectItem>
                          <SelectItem value="usb">USB</SelectItem>
                          <SelectItem value="network">Rede</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field
                      label="Endereço"
                      hint={
                        form.printerType === "network"
                          ? "host:porta (ex.: 192.168.0.50:9100)"
                          : form.printerType === "usb"
                            ? "vid:pid (opcional; vazio = detecção automática)"
                            : "caminho do dispositivo (ex.: /dev/usb/lp0)"
                      }
                    >
                      <input
                        className={inputClass}
                        value={form.printerAddress}
                        onChange={(e) =>
                          setField("printerAddress", e.target.value)
                        }
                      />
                    </Field>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={busy}
                        onClick={() => void testPrint()}
                      >
                        <PrinterIcon className="h-4 w-4" />
                        Testar impressão
                      </button>
                      {form.printerType === "network" ? (
                        <button
                          type="button"
                          className={ghostBtn}
                          disabled={busy}
                          onClick={() => void checkNetwork()}
                        >
                          <Wifi className="h-4 w-4" />
                          Checar rede
                        </button>
                      ) : null}
                    </div>

                    {saveButton("printer", "Salvar impressora")}
                  </div>
                </>
              ) : null}

              {section === "receipt" ? (
                <>
                  <SectionHeader
                    icon={ReceiptText}
                    title="Recibo"
                    desc="Identidade da loja impressa no cupom."
                  />

                  <div className={cn(cardClass, "flex flex-col gap-5")}>
                    <Field label="Nome da loja">
                      <input
                        className={inputClass}
                        value={form.storeName}
                        onChange={(e) => setField("storeName", e.target.value)}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="CNPJ">
                        <input
                          className={inputClass}
                          value={form.storeCnpj}
                          onChange={(e) =>
                            setField("storeCnpj", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Telefone">
                        <input
                          className={inputClass}
                          value={form.storePhone}
                          onChange={(e) =>
                            setField("storePhone", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Endereço">
                      <input
                        className={inputClass}
                        value={form.storeAddress}
                        onChange={(e) =>
                          setField("storeAddress", e.target.value)
                        }
                      />
                    </Field>
                    <Field
                      label="Rodapé do cupom"
                      hint="Uma linha por quebra de texto."
                    >
                      <textarea
                        className={cn(inputClass, "h-24 resize-none py-2")}
                        value={form.receiptFooter}
                        onChange={(e) =>
                          setField("receiptFooter", e.target.value)
                        }
                      />
                    </Field>

                    <button
                      type="button"
                      onClick={() =>
                        setField("receiptShowQr", !form.receiptShowQr)
                      }
                      className="flex items-center justify-between rounded-lg border border-[#23262e] bg-[#0f131f] px-4 py-3 text-left transition-colors hover:border-[#3f4552]"
                    >
                      <span>
                        <span className="block text-sm text-[#e8e6df]">
                          Imprimir QR Code
                        </span>
                        <span className="block text-xs text-[#6b6a65]">
                          Link para consulta da venda no fim do cupom.
                        </span>
                      </span>
                      <span
                        className={cn(
                          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                          form.receiptShowQr ? "bg-[#1D9E75]" : "bg-[#343945]"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                            form.receiptShowQr
                              ? "translate-x-[22px]"
                              : "translate-x-0.5"
                          )}
                        />
                      </span>
                    </button>

                    {saveButton("receipt", "Salvar recibo")}
                  </div>
                </>
              ) : null}

              {section === "data" ? (
                <>
                  <SectionHeader
                    icon={Database}
                    title="Dados"
                    desc="Backup, restauração e manutenção do banco."
                  />

                  <div className="flex flex-col gap-3">
                    <div className={cn(cardClass, "flex items-center gap-4")}>
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#2a2d35] bg-[#0f131f] text-[#7fd1b6]">
                        <Download className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#e8e6df]">Backup do banco</p>
                        <p className="text-xs text-[#6b6a65]">
                          Salva uma cópia do banco de dados em disco.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={busy}
                        onClick={() => void backup()}
                      >
                        Fazer backup
                      </button>
                    </div>

                    <div className="rounded-xl border border-[#3c1e24] bg-[#1a1216] p-5">
                      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[#a15656]">
                        Zona de risco
                      </p>
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#5a2222] bg-[#1f1215] text-[#ff8d8d]">
                            <Upload className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-[#e8e6df]">
                              Restaurar backup
                            </p>
                            <p className="text-xs text-[#6b6a65]">
                              Substitui os dados atuais e reinicia o app.
                            </p>
                          </div>
                          <button
                            type="button"
                            className={dangerBtn}
                            disabled={busy}
                            onClick={() => void restore()}
                          >
                            Restaurar…
                          </button>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#5a2222] bg-[#1f1215] text-[#ff8d8d]">
                            <Trash2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-[#e8e6df]">
                              Zerar estoque
                            </p>
                            <p className="text-xs text-[#6b6a65]">
                              Define o estoque de todos os produtos como 0.
                            </p>
                          </div>
                          <button
                            type="button"
                            className={dangerBtn}
                            disabled={busy}
                            onClick={() => void clearStock()}
                          >
                            Zerar estoque
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
