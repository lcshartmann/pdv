import { useEffect, useMemo, useState } from "react";
import NavBar from "../components/NavBar";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import ScrollArea from "../components/ScrollArea";
import type {
  PaymentMethod,
  ReportsDashboardResponse,
  ReportsSaleDetailResponse
} from "../../shared/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type Preset = "today" | "7d" | "15d" | "30d" | "custom";
type TopMode = "revenue" | "quantity";
type PaymentFilter = "all" | PaymentMethod;

const paymentLabel: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão"
};

const paymentColor: Record<PaymentMethod, string> = {
  cash: "#1D9E75",
  pix: "#EF9F27",
  card: "#378ADD"
};

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function listIsoDates(fromIso: string, toIso: string): string[] {
  const start = new Date(`${fromIso}T00:00:00`);
  const end = new Date(`${toIso}T00:00:00`);
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  if (preset === "7d") {
    from.setDate(to.getDate() - 6);
  } else if (preset === "15d") {
    from.setDate(to.getDate() - 14);
  } else if (preset === "30d") {
    from.setDate(to.getDate() - 29);
  }
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function formatDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  })
    .format(new Date(`${isoDate}T00:00:00`))
    .replace(".", "");
}

function formatHourLabel(periodIndex: number): string {
  const startHour = periodIndex * 2;
  const endHour = startHour + 2;
  return `${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:00`;
}

function formatDateTimeLabel(dateTime: string): string {
  const normalized = dateTime.includes("T")
    ? dateTime
    : dateTime.replace(" ", "T");
  const asUtc = /(Z|[+-]\d{2}:\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(asUtc));
}

function formatQuantity(value: number, unitType: "unit" | "kg"): string {
  if (unitType === "kg") {
    return `${value.toFixed(3).replace(".", ",")} kg`;
  }
  return `${Math.round(value).toLocaleString("pt-BR")} un`;
}

function getStatusBadge(status: "open" | "completed" | "cancelled"): {
  label: string;
  className: string;
} {
  if (status === "completed") {
    return { label: "Concluída", className: "bg-[#0a1f14] text-[#1D9E75]" };
  }
  if (status === "cancelled") {
    return { label: "Cancelada", className: "bg-[#1f1215] text-[#E24B4A]" };
  }
  return { label: "Aberta", className: "bg-[#22262f] text-[#6b6a65]" };
}

export default function ReportsPage(): JSX.Element {
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [preset, setPreset] = useState<Preset>("today");
  const [dateFrom, setDateFrom] = useState(getRange("today").from);
  const [dateTo, setDateTo] = useState(getRange("today").to);
  const [topMode, setTopMode] = useState<TopMode>("revenue");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(
    null
  );
  const [report, setReport] = useState<ReportsDashboardResponse | null>(null);
  const [historyPaymentFilter, setHistoryPaymentFilter] =
    useState<PaymentFilter>("all");
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [saleDetail, setSaleDetail] =
    useState<ReportsSaleDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset === "custom") {
      return;
    }
    const range = getRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, [preset]);

  useEffect(() => {
    let cancelled = false;
    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const response = await window.api.reportsDashboard({
          fromDate: from,
          toDate: to,
          productId: selectedProductId ?? undefined
        });
        if (cancelled) {
          return;
        }
        setReport(response);
        if (!selectedProductId && response.product_options[0]) {
          setSelectedProductId(response.product_options[0].id);
        }
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Falha ao carregar relatórios."
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, selectedProductId]);

  const topProducts = useMemo(() => {
    if (!report) {
      return [];
    }
    return topMode === "revenue"
      ? report.top_products_by_revenue
      : report.top_products_by_quantity;
  }, [report, topMode]);

  const maxTopValue = useMemo(() => {
    if (topProducts.length === 0) {
      return 1;
    }
    return Math.max(
      ...topProducts.map((entry) =>
        topMode === "revenue" ? entry.revenue : entry.quantity
      ),
      1
    );
  }, [topMode, topProducts]);

  const normalizedDateRange = useMemo(() => {
    if (dateFrom <= dateTo) {
      return { from: dateFrom, to: dateTo };
    }
    return { from: dateTo, to: dateFrom };
  }, [dateFrom, dateTo]);

  const dailyRevenueData = useMemo((): Array<{
    date: string;
    hour?: number;
    revenue: number;
    sales_count: number;
  }> => {
    if (!report?.daily) {
      return [];
    }

    // Check if we have hourly data
    const hasHourly = report.daily.some((p) => p.hour !== undefined);

    if (hasHourly) {
      // Return hourly data directly with all 12 periods (2-hour) filled in
      const pointByHour = new Map(
        report.daily.map((point) => [`${point.date}-${point.hour}`, point])
      );

      const results: Array<{
        date: string;
        hour?: number;
        revenue: number;
        sales_count: number;
      }> = [];
      const days = listIsoDates(
        normalizedDateRange.from,
        normalizedDateRange.to
      );

      for (const day of days) {
        for (let hour = 0; hour < 12; hour++) {
          const key = `${day}-${hour}`;
          const point = pointByHour.get(key);
          results.push({
            date: day,
            hour,
            revenue: Number(point?.revenue ?? 0),
            sales_count: Number(point?.sales_count ?? 0)
          });
        }
      }

      return results;
    } else {
      // Daily data - fill in missing days
      const pointByDate = new Map(
        report.daily.map((point) => [point.date, point])
      );
      const days = listIsoDates(
        normalizedDateRange.from,
        normalizedDateRange.to
      );
      return days.map((date) => ({
        date,
        revenue: Number(pointByDate.get(date)?.revenue ?? 0),
        sales_count: Number(pointByDate.get(date)?.sales_count ?? 0)
      }));
    }
  }, [normalizedDateRange.from, normalizedDateRange.to, report?.daily]);

  const productSeriesDaily = useMemo((): Array<{
    date: string;
    hour?: number;
    quantity: number;
    revenue: number;
  }> => {
    if (!report?.product_series) {
      return [];
    }

    // Check if we have hourly data
    const hasHourly = report.product_series.points.some(
      (p) => p.hour !== undefined
    );

    if (hasHourly) {
      // Return hourly data directly with all 12 periods (2-hour) filled in
      const pointByHour = new Map(
        report.product_series.points.map((point) => [
          `${point.date}-${point.hour}`,
          point
        ])
      );

      const results: Array<{
        date: string;
        hour?: number;
        quantity: number;
        revenue: number;
      }> = [];
      const days = listIsoDates(
        normalizedDateRange.from,
        normalizedDateRange.to
      );

      for (const day of days) {
        for (let hour = 0; hour < 12; hour++) {
          const key = `${day}-${hour}`;
          const point = pointByHour.get(key);
          results.push({
            date: day,
            hour,
            quantity: Number(point?.quantity ?? 0),
            revenue: Number(point?.revenue ?? 0)
          });
        }
      }

      return results;
    } else {
      // Daily data - fill in missing days
      const pointByDate = new Map(
        report.product_series.points.map((point) => [point.date, point])
      );
      const days = listIsoDates(
        normalizedDateRange.from,
        normalizedDateRange.to
      );
      return days.map((date) => ({
        date,
        quantity: Number(pointByDate.get(date)?.quantity ?? 0),
        revenue: Number(pointByDate.get(date)?.revenue ?? 0)
      }));
    }
  }, [
    normalizedDateRange.from,
    normalizedDateRange.to,
    report?.product_series
  ]);

  const productSeriesUnitType = report?.product_series?.unit_type;

  const filteredHistory = useMemo(() => {
    if (!report) {
      return [];
    }
    if (historyPaymentFilter === "all") {
      return report.history;
    }
    return report.history.filter(
      (row) => row.payment_method === historyPaymentFilter
    );
  }, [historyPaymentFilter, report]);

  const openSaleDetail = async (saleId: number): Promise<void> => {
    setSelectedSaleId(saleId);
    setDetailLoading(true);
    setDetailError(null);
    setSaleDetail(null);
    try {
      const detail = await window.api.reportsSaleDetail({ saleId });
      setSaleDetail(detail);
    } catch (errorLoad) {
      setDetailError(
        errorLoad instanceof Error
          ? errorLoad.message
          : "Falha ao carregar detalhes da venda."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const closeSaleDetail = (): void => {
    setSelectedSaleId(null);
    setSaleDetail(null);
    setDetailError(null);
    setReprinting(false);
  };

  const handleReprintReceipt = async (): Promise<void> => {
    if (!saleDetail) {
      return;
    }
    setReprinting(true);
    setDetailError(null);
    try {
      await window.api.reportsReprintReceipt({ saleId: saleDetail.sale_id });
    } catch (errorReprint) {
      setDetailError(
        errorReprint instanceof Error
          ? errorReprint.message
          : "Falha ao reimprimir comprovante."
      );
    } finally {
      setReprinting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111318] text-[#e8e6df]">
      <NavBar />

      <div className="flex flex-wrap items-center gap-3 border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-2.5">
        <span className="text-[12px] text-[#6b6a65]">Período:</span>
        <div className="flex gap-1">
          {(
            [
              ["today", "Hoje"],
              ["7d", "7 dias"],
              ["15d", "15 dias"],
              ["30d", "30 dias"],
              ["custom", "Personalizado"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setPreset(value)}
              className={[
                "rounded-md border px-3 py-1 text-[12px] transition-colors",
                preset === value
                  ? "border-[#1D9E75] bg-[#0a1f14] text-[#1D9E75]"
                  : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65] hover:text-[#c2c0b6]"
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#6b6a65]">De</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPreset("custom");
              setDateFrom(event.target.value);
            }}
            max={todayIso}
            className="rounded-md border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-[12px] text-[#e8e6df] outline-none focus:border-[#1D9E75]"
          />
          <span className="text-[12px] text-[#6b6a65]">Até</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPreset("custom");
              setDateTo(event.target.value);
            }}
            max={todayIso}
            className="rounded-md border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-[12px] text-[#e8e6df] outline-none focus:border-[#1D9E75]"
          />
        </div>
      </div>

      {error ? (
        <div className="border-b border-[#3c1e24] bg-[#2b1519] px-4 py-2 text-sm text-[#ff8d8d]">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="grid min-h-0 gap-3 md:grid-cols-[3fr_1fr]">
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#2a2d35] bg-[#1a1d24]">
                <div className="flex items-center justify-between border-b border-[#2a2d35] px-4 py-3">
                  <h2 className="text-[13px] font-medium">Receita diária</h2>
                  <span className="text-[11px] text-[#6b6a65]">
                    {normalizedDateRange.from === normalizedDateRange.to
                      ? normalizedDateRange.from
                      : `${normalizedDateRange.from} → ${normalizedDateRange.to}`}
                  </span>
                </div>
                {report?.daily.length ? (
                  <ScrollArea className="min-h-0 flex-1 overflow-x-auto p-4">
                    <div
                      style={{
                        position: "relative",
                        width: "max(100%, 800px)",
                        height: "100%"
                      }}
                    >
                      <Bar
                        data={{
                          labels: dailyRevenueData.map((entry) =>
                            entry.hour !== undefined
                              ? formatHourLabel(entry.hour)
                              : formatDateLabel(entry.date)
                          ),
                          datasets: [
                            {
                              label: "Receita (R$)",
                              data: dailyRevenueData.map(
                                (entry) => entry.revenue
                              ),
                              backgroundColor: "#1D9E75",
                              borderColor: "#1D9E75",
                              borderWidth: 0,
                              borderRadius: 4
                            },
                            {
                              label: "Vendas (qtd)",
                              data: dailyRevenueData.map(
                                (entry) => entry.sales_count
                              ),
                              backgroundColor: "#EF9F27",
                              borderColor: "#EF9F27",
                              borderWidth: 0,
                              borderRadius: 4,
                              yAxisID: "y1"
                            }
                          ]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          interaction: {
                            mode: "index",
                            intersect: false
                          },
                          plugins: {
                            legend: {
                              display: true,
                              position: "bottom",
                              labels: {
                                color: "#6b6a65",
                                font: { size: 11 },
                                padding: 12,
                                usePointStyle: true,
                                boxWidth: 8
                              }
                            },
                            tooltip: {
                              backgroundColor: "rgba(20, 21, 27, 0.95)",
                              titleColor: "#e8e6df",
                              bodyColor: "#e8e6df",
                              borderColor: "#2a2d35",
                              borderWidth: 1,
                              padding: 8,
                              callbacks: {
                                label: (context) => {
                                  if (context.datasetIndex === 0) {
                                    return `${context.dataset.label}: ${formatCurrency(context.parsed.y as number)}`;
                                  }
                                  return `${context.dataset.label}: ${Math.round(context.parsed.y as number)}`;
                                }
                              }
                            }
                          },
                          scales: {
                            x: {
                              display: true,
                              grid: {
                                display: false
                              },
                              ticks: {
                                color: "#6b6a65",
                                font: { size: 10 }
                              }
                            },
                            y: {
                              display: true,
                              position: "left",
                              grid: {
                                color: "#22262f",
                                display: true
                              },
                              ticks: {
                                color: "#6b6a65",
                                font: { size: 10 },
                                callback: (value) =>
                                  formatCurrency(Number(value))
                              }
                            },
                            y1: {
                              display: true,
                              position: "right",
                              grid: {
                                display: false
                              },
                              ticks: {
                                color: "#6b6a65",
                                font: { size: 10 }
                              }
                            }
                          }
                        }}
                      />
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="p-4">
                    <p className="text-sm text-[#6b6a65]">
                      {loading ? "Carregando…" : "Sem vendas no período."}
                    </p>
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-xl border border-[#2a2d35] bg-[#1a1d24]">
                <div className="flex items-center justify-between border-b border-[#2a2d35] px-4 py-3">
                  <h2 className="text-[13px] font-medium">
                    Produtos mais vendidos
                  </h2>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTopMode("revenue")}
                      className={[
                        "rounded-md border px-2.5 py-1 text-[11px]",
                        topMode === "revenue"
                          ? "border-[#1D9E75] bg-[#0a1f14] text-[#1D9E75]"
                          : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65]"
                      ].join(" ")}
                    >
                      Receita
                    </button>
                    <button
                      onClick={() => setTopMode("quantity")}
                      className={[
                        "rounded-md border px-2.5 py-1 text-[11px]",
                        topMode === "quantity"
                          ? "border-[#1D9E75] bg-[#0a1f14] text-[#1D9E75]"
                          : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65]"
                      ].join(" ")}
                    >
                      Quantidade
                    </button>
                  </div>
                </div>
                <ScrollArea className="min-h-44 overflow-y-auto p-4">
                  {topProducts.length ? (
                    <div className="flex flex-col gap-2">
                      {topProducts.map((entry, index) => {
                        const value =
                          topMode === "revenue"
                            ? entry.revenue
                            : entry.quantity;
                        const ratio =
                          value > 0
                            ? Math.max((value / maxTopValue) * 100, 4)
                            : 0;
                        return (
                          <div
                            key={`${topMode}-${entry.product_id}`}
                            className="grid grid-cols-[26px_140px_1fr_auto] items-center gap-2"
                          >
                            <span className="text-[11px] font-mono text-[#6b6a65]">
                              {index + 1}
                            </span>
                            <span className="truncate text-[12px] text-[#c2c0b6]">
                              {entry.product_name}
                            </span>
                            <div className="h-2 overflow-hidden rounded bg-[#22262f]">
                              <div
                                className={`h-2 rounded ${topMode === "revenue" ? "bg-[#378ADD]" : "bg-[#EF9F27]"}`}
                                style={{ width: `${ratio}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-[#c2c0b6]">
                              {topMode === "revenue"
                                ? formatCurrency(entry.revenue)
                                : formatQuantity(
                                    entry.quantity,
                                    entry.unit_type
                                  )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-[#6b6a65]">
                      {loading ? "Carregando…" : "Sem itens no período."}
                    </p>
                  )}
                </ScrollArea>
              </section>
            </div>

            <section className="overflow-hidden rounded-xl border border-[#2a2d35] bg-[#1a1d24]">
              <div className="flex items-center justify-between border-b border-[#2a2d35] px-4 py-3">
                <h2 className="text-[13px] font-medium">
                  Quantidade vendida por produto
                </h2>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-[240px_1fr]">
                <div className="space-y-2">
                  <select
                    value={selectedProductId ?? ""}
                    onChange={(event) =>
                      setSelectedProductId(Number(event.target.value))
                    }
                    className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                  >
                    {report?.product_options.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} (
                        {product.unit_type === "kg" ? "kg" : "un"})
                      </option>
                    ))}
                  </select>
                  <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                    <p className="text-[11px] text-[#6b6a65]">
                      Total no período
                    </p>
                    <p className="text-lg font-medium text-[#1D9E75]">
                      {report?.product_series
                        ? formatQuantity(
                            report.product_series.total_quantity,
                            report.product_series.unit_type
                          )
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                    <p className="text-[11px] text-[#6b6a65]">Receita gerada</p>
                    <p className="text-lg font-medium">
                      {report?.product_series
                        ? formatCurrency(report.product_series.total_revenue)
                        : "—"}
                    </p>
                  </div>
                </div>
                {report?.product_series && productSeriesDaily.length ? (
                  <div className="px-4">
                    <div className="rounded-md border border-[#2a2d35] bg-[#111318] p-3">
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "160px"
                        }}
                      >
                        <Line
                          data={{
                            labels: productSeriesDaily.map((entry) =>
                              entry.hour !== undefined
                                ? formatHourLabel(entry.hour)
                                : formatDateLabel(entry.date)
                            ),
                            datasets: [
                              {
                                label:
                                  productSeriesDaily[0]?.hour !== undefined
                                    ? "Qtd/hora"
                                    : "Qtd/dia",
                                data: productSeriesDaily.map(
                                  (entry) => entry.quantity
                                ),
                                borderColor: "#1D9E75",
                                backgroundColor: "rgba(29, 158, 117, 0.1)",
                                borderWidth: 2,
                                fill: true,
                                tension: 0.4,
                                pointRadius: 3,
                                pointBackgroundColor: "#1D9E75",
                                pointBorderColor: "#1D9E75",
                                pointHoverRadius: 5
                              }
                            ]
                          }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                display: false
                              },
                              tooltip: {
                                backgroundColor: "rgba(20, 21, 27, 0.95)",
                                titleColor: "#e8e6df",
                                bodyColor: "#e8e6df",
                                borderColor: "#2a2d35",
                                borderWidth: 1,
                                padding: 8,
                                displayColors: false,
                                callbacks: {
                                  label: (context) =>
                                    formatQuantity(
                                      context.parsed.y as number,
                                      productSeriesUnitType ?? "unit"
                                    )
                                }
                              }
                            },
                            scales: {
                              x: {
                                display: true,
                                grid: {
                                  display: false
                                },
                                ticks: {
                                  color: "#6b6a65",
                                  font: { size: 10 }
                                }
                              },
                              y: {
                                display: true,
                                grid: {
                                  color: "#22262f",
                                  display: true
                                },
                                ticks: {
                                  color: "#6b6a65",
                                  font: { size: 10 },
                                  callback: (value) =>
                                    formatQuantity(
                                      Number(value),
                                      productSeriesUnitType ?? "unit"
                                    )
                                }
                              }
                            }
                          }}
                        />
                      </div>
                      <div className="mt-2 flex gap-2 text-[11px]">
                        <div className="flex items-center gap-1">
                          <div className="h-3 w-3 rounded-full bg-[#1D9E75]" />
                          <span className="text-[#6b6a65]">
                            {productSeriesDaily[0]?.hour !== undefined
                              ? "Qtd/hora"
                              : "Qtd/dia"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1"></div>
                  </div>
                ) : (
                  <div className="p-4">
                    <p className="text-sm text-[#6b6a65]">
                      {loading
                        ? "Carregando…"
                        : "Sem vendas desse produto no período."}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="min-h-0 overflow-hidden rounded-xl border border-[#2a2d35] bg-[#1a1d24]">
              <div className="flex items-center justify-between border-b border-[#2a2d35] px-4 py-3">
                <h2 className="text-[13px] font-medium">Histórico de vendas</h2>
                <select
                  value={historyPaymentFilter}
                  onChange={(event) =>
                    setHistoryPaymentFilter(event.target.value as PaymentFilter)
                  }
                  className="rounded-md border border-[#2a2d35] bg-[#22262f] px-2.5 py-1 text-[11px] text-[#c2c0b6] outline-none focus:border-[#1D9E75]"
                >
                  <option value="all">Todos pagamentos</option>
                  <option value="cash">Dinheiro</option>
                  <option value="pix">PIX</option>
                  <option value="card">Cartão</option>
                </select>
              </div>
              <div className="grid grid-cols-[64px_1fr_110px_96px_96px] gap-2 border-b border-[#2a2d35] px-4 py-2 text-[11px] uppercase tracking-wide text-[#6b6a65]">
                <span>#</span>
                <span>Horário</span>
                <span>Total</span>
                <span>Pagamento</span>
                <span>Status</span>
              </div>
              <ScrollArea className="max-h-56 overflow-y-auto">
                {filteredHistory.length ? (
                  filteredHistory.map((row) => {
                    const badge = getStatusBadge(row.status);
                    return (
                      <button
                        type="button"
                        key={row.sale_id}
                        onClick={() => void openSaleDetail(row.sale_id)}
                        className="grid w-full grid-cols-[64px_1fr_110px_96px_96px] items-center gap-2 border-b border-[#1e2128] px-4 py-2 text-left text-[12px] text-[#c2c0b6] hover:bg-[#22262f]"
                      >
                        <span className="font-mono text-[#444441]">
                          #{String(row.sale_id).padStart(4, "0")}
                        </span>
                        <span>{formatDateTimeLabel(row.event_at)}</span>
                        <span className="font-medium text-[#e8e6df]">
                          {formatCurrency(row.total)}
                        </span>
                        <span
                          style={{
                            color: row.payment_method
                              ? paymentColor[row.payment_method]
                              : "#6b6a65"
                          }}
                        >
                          {row.payment_method
                            ? paymentLabel[row.payment_method]
                            : "—"}
                        </span>
                        <span
                          className={`inline-flex w-fit rounded px-2 py-0.5 text-[11px] ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 text-sm text-[#6b6a65]">
                    {loading ? "Carregando…" : "Sem vendas no período."}
                  </div>
                )}
              </ScrollArea>
            </section>
          </div>
        </ScrollArea>

        <aside className="w-[220px] border-l border-[#2a2d35] bg-[#1a1d24] p-3.5">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-[#6b6a65]">
            Resumo do período
          </p>
          <div className="space-y-2">
            <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
              <p className="text-[11px] text-[#6b6a65]">Receita total</p>
              <p className="text-xl font-medium text-[#1D9E75]">
                {formatCurrency(report?.total_revenue ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
              <p className="text-[11px] text-[#6b6a65]">Vendas realizadas</p>
              <p className="text-xl font-medium">
                {(report?.total_sales ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
              <p className="text-[11px] text-[#6b6a65]">Ticket médio</p>
              <p className="text-xl font-medium">
                {formatCurrency(report?.average_ticket ?? 0)}
              </p>
            </div>
          </div>

          <div className="mt-3 border-t border-[#2a2d35] pt-3">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-[#6b6a65]">
              Por forma de pagamento
            </p>
            <div className="space-y-2">
              {report?.payment_breakdown.length ? (
                report.payment_breakdown.map((row) => (
                  <div
                    key={row.method}
                    className="grid grid-cols-[60px_1fr_42px] items-center gap-2"
                  >
                    <span className="text-[12px] text-[#c2c0b6]">
                      {paymentLabel[row.method]}
                    </span>
                    <div className="h-1.5 overflow-hidden rounded bg-[#22262f]">
                      <div
                        className="h-1.5 rounded"
                        style={{
                          width: `${Math.min(row.percent, 100)}%`,
                          background: paymentColor[row.method]
                        }}
                      />
                    </div>
                    <span
                      className="text-right text-[12px]"
                      style={{ color: paymentColor[row.method] }}
                    >
                      {Math.round(row.percent)}%
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#6b6a65]">
                  Sem pagamentos no período.
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 border-t border-[#2a2d35] pt-3">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-[#6b6a65]">
              Alertas de estoque
            </p>
            <ScrollArea className="max-h-56 overflow-y-auto pr-1">
              <div className="space-y-2">
                {report?.stock_alerts.length ? (
                  report.stock_alerts.map((item) => (
                    <div
                      key={item.product_id}
                      className={[
                        "rounded-md border px-2.5 py-2",
                        item.status === "out"
                          ? "border-[#E24B4A] bg-[#1f1215]"
                          : "border-[#EF9F27] bg-[#2a2410]"
                      ].join(" ")}
                    >
                      <p
                        className={`text-[12px] font-medium ${item.status === "out" ? "text-[#E24B4A]" : "text-[#EF9F27]"}`}
                      >
                        {item.product_name}
                      </p>
                      <p
                        className={`mt-0.5 text-[11px] ${item.status === "out" ? "text-[#b15d5d]" : "text-[#b08336]"}`}
                      >
                        {item.status === "out"
                          ? "Sem estoque"
                          : `${formatQuantity(item.stock_qty, item.unit_type)} · mín ${formatQuantity(item.stock_alert_qty, item.unit_type)}`}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#6b6a65]">
                    Nenhum alerta no momento.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>

      <div className="border-t border-[#2a2d35] bg-[#0d0f14] px-4 py-1.5">
        <div className="flex flex-wrap gap-4 text-[11px] text-[#444441]">
          <span>F1 Ir para venda</span>
          <span>F6 Produtos</span>
          <span>F7 Relatórios</span>
        </div>
      </div>

      {selectedSaleId !== null ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#2a2d35] bg-[#1a1d24]">
            <div className="flex items-center justify-between border-b border-[#2a2d35] px-4 py-3">
              <h2 className="text-sm font-medium">
                Detalhe da venda #{String(selectedSaleId).padStart(4, "0")}
              </h2>
              <button
                type="button"
                onClick={closeSaleDetail}
                className="rounded border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-xs text-[#c2c0b6]"
              >
                Fechar
              </button>
            </div>

            <ScrollArea className="max-h-[72vh] overflow-y-auto p-4">
              {detailLoading ? (
                <p className="text-sm text-[#6b6a65]">Carregando detalhes…</p>
              ) : null}
              {saleDetail ? (
                <div className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                      <p className="text-[11px] text-[#6b6a65]">Status</p>
                      <p className="text-sm font-medium">
                        {getStatusBadge(saleDetail.status).label}
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                      <p className="text-[11px] text-[#6b6a65]">Início</p>
                      <p className="text-sm">
                        {formatDateTimeLabel(saleDetail.started_at)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                      <p className="text-[11px] text-[#6b6a65]">Conclusão</p>
                      <p className="text-sm">
                        {saleDetail.completed_at
                          ? formatDateTimeLabel(saleDetail.completed_at)
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#2a2d35]">
                    <div className="grid grid-cols-[1fr_90px_120px_120px] gap-2 border-b border-[#2a2d35] px-3 py-2 text-[11px] uppercase tracking-wide text-[#6b6a65]">
                      <span>Item</span>
                      <span className="text-right">Qtd</span>
                      <span className="text-right">Preço un.</span>
                      <span className="text-right">Total</span>
                    </div>
                    {saleDetail.items.map((item) => (
                      <div
                        key={item.sale_item_id}
                        className="grid grid-cols-[1fr_90px_120px_120px] gap-2 border-b border-[#1e2128] px-3 py-2 text-[12px] last:border-b-0"
                      >
                        <span className="text-[#c2c0b6]">
                          {item.product_name}
                        </span>
                        <span className="text-right text-[#c2c0b6]">
                          {formatQuantity(item.quantity, item.unit_type)}
                        </span>
                        <span className="text-right text-[#c2c0b6]">
                          {formatCurrency(item.unit_price)}
                        </span>
                        <span className="text-right text-[#e8e6df]">
                          {formatCurrency(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                      <p className="text-[11px] text-[#6b6a65]">Pagamento</p>
                      <p
                        className="text-sm"
                        style={{
                          color: saleDetail.payment_method
                            ? paymentColor[saleDetail.payment_method]
                            : "#6b6a65"
                        }}
                      >
                        {saleDetail.payment_method
                          ? paymentLabel[saleDetail.payment_method]
                          : "—"}
                      </p>
                      <p className="mt-1 text-xs text-[#6b6a65]">
                        Pago em:{" "}
                        {saleDetail.paid_at
                          ? formatDateTimeLabel(saleDetail.paid_at)
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#22262f] px-3 py-2.5">
                      <p className="text-[11px] text-[#6b6a65]">Totais</p>
                      <p className="text-sm text-[#c2c0b6]">
                        Subtotal: {formatCurrency(saleDetail.subtotal)}
                      </p>
                      <p className="text-sm text-[#c2c0b6]">
                        Desconto: {formatCurrency(saleDetail.discount_amount)}
                      </p>
                      <p className="text-sm font-medium text-[#e8e6df]">
                        Total: {formatCurrency(saleDetail.total)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </ScrollArea>

            {detailError ? (
              <div className="border-t border-error-border bg-error-bg px-4 py-2 text-sm text-error-text">
                {detailError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[#2a2d35] px-4 py-3">
              <button
                type="button"
                onClick={() => void handleReprintReceipt()}
                disabled={!saleDetail || reprinting}
                className="rounded border border-[#378ADD] bg-[#0e2337] px-3 py-1.5 text-xs text-[#66b1ff] disabled:opacity-50"
              >
                {reprinting ? "Reimprimindo…" : "Reimprimir comprovante"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
