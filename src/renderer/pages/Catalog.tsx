import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Category, Product, UnitType } from "../../shared/types";

type StockFilter = "all" | "low" | "out";
type SortKey = "name" | "category" | "unit_type" | "price" | "stock";

interface ProductFormState {
  id?: number;
  name: string;
  barcode: string;
  unit_type: UnitType;
  price_per_unit: string;
  stock_qty: string;
  stock_alert_qty: string;
  category_id: string;
}

interface PriceModalState {
  open: boolean;
  product: Product | null;
  value: string;
  error: string | null;
}

interface RestockModalState {
  open: boolean;
  product: Product | null;
  value: string;
  error: string | null;
}

interface ProductModalState {
  open: boolean;
}

interface ProductRow {
  raw: Product;
  category: string;
}

const initialForm: ProductFormState = {
  name: "",
  barcode: "",
  unit_type: "unit",
  price_per_unit: "",
  stock_qty: "0",
  stock_alert_qty: "0",
  category_id: ""
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatStock(value: number, unitType: UnitType): string {
  if (unitType === "kg") return `${value.toFixed(3).replace(".", ",")} kg`;
  return `${value.toLocaleString("pt-BR")} un`;
}

function getStockStatus(product: Product): "ok" | "low" | "out" {
  if (product.stock_qty <= 0) return "out";
  if (product.stock_qty <= product.stock_alert_qty) return "low";
  return "ok";
}

export default function CatalogPage(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ProductFormState>(initialForm);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todos");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(new Date());
  const [priceModal, setPriceModal] = useState<PriceModalState>({ open: false, product: null, value: "", error: null });
  const [restockModal, setRestockModal] = useState<RestockModalState>({ open: false, product: null, value: "", error: null });
  const [productModal, setProductModal] = useState<ProductModalState>({ open: false });
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    const [productRows, categoryRows] = await Promise.all([window.api.productList(), window.api.categoryList()]);
    setProducts(productRows);
    setCategories(categoryRows);
  }, []);

  useEffect(() => {
    void loadData().catch((error: unknown) => {
      setFormError(error instanceof Error ? error.message : "Falha ao carregar catálogo.");
    });
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setPriceModal({ open: false, product: null, value: "", error: null });
        setRestockModal({ open: false, product: null, value: "", error: null });
        setProductModal({ open: false });
        setForm(initialForm);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const categoryNameById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const categoryNames = useMemo(() => categories.map((category) => category.name), [categories]);
  const rows = useMemo<ProductRow[]>(
    () =>
      products.map((product) => ({
        raw: product,
        category: product.category_id ? categoryNameById.get(product.category_id) ?? "Sem categoria" : "Sem categoria"
      })),
    [products, categoryNameById]
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = rows.filter(({ raw, category }) => {
      const matchSearch = !query || raw.name.toLowerCase().includes(query) || (raw.barcode ? raw.barcode.includes(query) : false);
      const matchCategory = categoryFilter === "Todos" || category === categoryFilter;
      const status = getStockStatus(raw);
      const matchStock = stockFilter === "all" || (stockFilter === "out" && status === "out") || (stockFilter === "low" && status !== "ok");
      return matchSearch && matchCategory && matchStock;
    });

    list.sort((left, right) => {
      const getValue = (row: ProductRow): string | number => {
        if (sortKey === "category") return row.category.toLowerCase();
        if (sortKey === "price") return row.raw.price_per_unit;
        if (sortKey === "stock") return row.raw.stock_qty;
        if (sortKey === "name") return row.raw.name.toLowerCase();
        return row.raw.unit_type;
      };
      const a = getValue(left);
      const b = getValue(right);
      return a < b ? -sortDir : a > b ? sortDir : 0;
    });

    return list;
  }, [rows, search, categoryFilter, stockFilter, sortKey, sortDir]);

  const stats = useMemo(
    () => ({
      total: products.length,
      lowStock: products.filter((product) => getStockStatus(product) === "low").length,
      outStock: products.filter((product) => getStockStatus(product) === "out").length
    }),
    [products]
  );

  const categoryCounts = useMemo(
    () => Object.fromEntries(categoryNames.map((name) => [name, rows.filter((row) => row.category === name).length])),
    [categoryNames, rows]
  );

  const clockLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return formatter.format(now);
  }, [now]);

  const toggleSort = useCallback(
    (key: SortKey): void => {
      if (sortKey === key) {
        setSortDir((current) => (current === 1 ? -1 : 1));
        return;
      }
      setSortKey(key);
      setSortDir(1);
    },
    [sortKey]
  );

  const saveProduct = useCallback(async (): Promise<void> => {
    const name = form.name.trim();
    const barcode = form.barcode.trim();
    const price = Number(form.price_per_unit.replace(",", "."));
    const stock = Number(form.stock_qty.replace(",", "."));
    const stockAlert = Number(form.stock_alert_qty.replace(",", "."));
    const categoryId = Number(form.category_id);

    if (!name) return setFormError("Nome é obrigatório.");
    if (!Number.isFinite(price) || price <= 0) return setFormError("Preço deve ser maior que zero.");
    if (!Number.isFinite(stock) || stock < 0) return setFormError("Estoque deve ser maior ou igual a zero.");
    if (!Number.isFinite(stockAlert) || stockAlert < 0) return setFormError("Alerta de estoque deve ser maior ou igual a zero.");
    if (!Number.isFinite(categoryId) || categoryId <= 0) return setFormError("Categoria é obrigatória.");

    setLoading(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      if (form.id) {
        await window.api.productUpdate({
          id: form.id,
          name,
          barcode: barcode || undefined,
          unit_type: form.unit_type,
          price_per_unit: price,
          stock_qty: stock,
          stock_alert_qty: stockAlert,
          category_id: categoryId
        });
        setFormSuccess("Produto atualizado com sucesso.");
      } else {
        await window.api.productCreate({
          name,
          barcode: barcode || undefined,
          unit_type: form.unit_type,
          price_per_unit: price,
          stock_qty: stock,
          stock_alert_qty: stockAlert,
          category_id: categoryId
        });
        setFormSuccess("Produto cadastrado com sucesso.");
      }

      setForm((current) => ({
        ...initialForm,
        unit_type: current.unit_type,
        category_id: current.category_id
      }));
      await loadData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Falha ao salvar produto.");
    } finally {
      setLoading(false);
    }
  }, [form, loadData]);

  const openPriceModal = useCallback((product: Product): void => {
    setPriceModal({
      open: true,
      product,
      value: product.price_per_unit.toFixed(2).replace(".", ","),
      error: null
    });
  }, []);

  const savePrice = useCallback(async (): Promise<void> => {
    if (!priceModal.product) return;
    const nextPrice = Number(priceModal.value.replace(",", "."));
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      setPriceModal((state) => ({ ...state, error: "Preço deve ser maior que zero." }));
      return;
    }
    if (nextPrice === priceModal.product.price_per_unit) {
      setPriceModal((state) => ({ ...state, error: "Novo preço deve ser diferente do atual." }));
      return;
    }

    setPriceModal((state) => ({ ...state, error: null }));
    try {
      await window.api.productUpdate({
        id: priceModal.product.id,
        name: priceModal.product.name,
        barcode: priceModal.product.barcode ?? undefined,
        unit_type: priceModal.product.unit_type,
        price_per_unit: nextPrice,
        stock_qty: priceModal.product.stock_qty,
        stock_alert_qty: priceModal.product.stock_alert_qty,
        category_id: priceModal.product.category_id ?? undefined
      });
      setPriceModal({ open: false, product: null, value: "", error: null });
      setFormSuccess("Preço atualizado com sucesso.");
      setFormError(null);
      await loadData();
    } catch (error) {
      setPriceModal((state) => ({ ...state, error: error instanceof Error ? error.message : "Falha ao atualizar preço." }));
    }
  }, [priceModal, loadData]);

  const openRestockModal = useCallback((product: Product): void => {
    setRestockModal({ open: true, product, value: "", error: null });
  }, []);

  const confirmRestock = useCallback(async (): Promise<void> => {
    if (!restockModal.product) return;
    const quantity = Number(restockModal.value.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRestockModal((state) => ({ ...state, error: "Quantidade deve ser maior que zero." }));
      return;
    }

    setRestockModal((state) => ({ ...state, error: null }));
    try {
      await window.api.productReceiveStock({
        product_id: restockModal.product.id,
        quantity
      });
      setRestockModal({ open: false, product: null, value: "", error: null });
      setFormSuccess("Entrada de estoque registrada com sucesso.");
      setFormError(null);
      await loadData();
    } catch (error) {
      setRestockModal((state) => ({ ...state, error: error instanceof Error ? error.message : "Falha ao registrar entrada de estoque." }));
    }
  }, [restockModal, loadData]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111318] text-[#e8e6df]">
      <div className="flex items-center justify-between border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-2">
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/" className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]">
            Venda <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F1</span>
          </Link>
          <Link to="/catalog" className="rounded-md bg-[#22262f] px-3 py-1.5 text-[#e8e6df]">
            Produtos <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F6</span>
          </Link>
          <Link to="/reports" className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]">
            Relatórios <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F7</span>
          </Link>
        </nav>
        <span className="text-sm text-[#9d9c99]">{clockLabel}</span>
      </div>

      <div className="border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou código de barras..."
              className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 pr-14 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs text-[#6b6a65]">
              F2
            </span>
          </div>

          {["Todos", ...categoryNames].map((name) => (
            <button
              key={name}
              onClick={() => setCategoryFilter(name)}
              className={`rounded-full border px-3 py-1 text-xs ${
                categoryFilter === name ? "border-[#1D9E75] bg-[#0a1f14] text-[#1D9E75]" : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65]"
              }`}
            >
              {name}
            </button>
          ))}

          {[
            { key: "all", label: "Todos" },
            { key: "low", label: "Baixo" },
            { key: "out", label: "Zerado" }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setStockFilter(item.key as StockFilter)}
              className={`rounded-md border px-3 py-1 text-xs ${
                stockFilter === item.key ? "border-[#EF9F27] bg-[#2a2410] text-[#EF9F27]" : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] overflow-hidden">
        <aside className="min-h-0 overflow-y-auto border-r border-[#2a2d35] bg-[#1a1d24] p-3">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#6b6a65]">Resumo</h2>
          <div className="space-y-2">
            <div className="rounded-md bg-[#22262f] p-3">
              <p className="text-[11px] text-[#6b6a65]">Total de produtos</p>
              <p className="text-2xl font-medium">{stats.total}</p>
            </div>
            <div className="rounded-md bg-[#22262f] p-3">
              <p className="text-[11px] text-[#6b6a65]">Estoque baixo</p>
              <p className="text-2xl font-medium text-[#EF9F27]">{stats.lowStock}</p>
            </div>
            <div className="rounded-md bg-[#22262f] p-3">
              <p className="text-[11px] text-[#6b6a65]">Sem estoque</p>
              <p className="text-2xl font-medium text-[#E24B4A]">{stats.outStock}</p>
            </div>
          </div>

          <h3 className="mt-4 mb-2 text-xs uppercase tracking-wide text-[#6b6a65]">Categorias</h3>
          <div className="space-y-1">
            {categoryNames.map((name) => (
              <button
                key={name}
                onClick={() => setCategoryFilter((current) => (current === name ? "Todos" : name))}
                className={`flex w-full items-center justify-between border-b border-[#2a2d35] py-1.5 text-xs ${
                  categoryFilter === name ? "text-[#1D9E75]" : "text-[#c2c0b6]"
                }`}
              >
                <span>{name}</span>
                <span className="rounded bg-[#22262f] px-1.5 py-0.5 text-[10px] text-[#6b6a65]">{categoryCounts[name] ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_1fr_auto]">
          <div className="grid grid-cols-[2fr_120px_80px_120px_140px_160px] gap-2 border-b border-[#2a2d35] bg-[#1a1d24] px-3 py-2 text-xs uppercase tracking-wide text-[#6b6a65]">
            {[
              { key: "name", label: "Produto" },
              { key: "category", label: "Categoria" },
              { key: "unit_type", label: "Tipo" },
              { key: "price", label: "Preço" },
              { key: "stock", label: "Estoque" }
            ].map((column) => (
              <button
                key={column.key}
                onClick={() => toggleSort(column.key as SortKey)}
                className="flex items-center justify-start gap-1 text-left"
              >
                <span>{column.label}</span>
                <span className="text-[10px] text-[#444441]">{sortKey === column.key ? (sortDir === 1 ? "↑" : "↓") : "⇅"}</span>
              </button>
            ))}
            <span>Ações</span>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {filteredRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-[#6b6a65]">Nenhum produto encontrado.</div>
            ) : (
              filteredRows.map(({ raw, category }, index) => {
                const status = getStockStatus(raw);
                return (
                  <div
                    key={raw.id}
                    className={`grid grid-cols-[2fr_120px_80px_120px_140px_160px] gap-2 border-b border-[#1e2128] px-3 py-2 ${
                      index % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
                    } hover:bg-[#1a1d24]`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{raw.name}</p>
                      <p className="truncate text-xs text-[#444441]">{raw.barcode ?? "sem código"}</p>
                    </div>
                    <p className="truncate text-xs text-[#c2c0b6]">{category}</p>
                    <p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          raw.unit_type === "kg" ? "bg-[#0e1f35] text-[#378ADD]" : "bg-[#22262f] text-[#6b6a65]"
                        }`}
                      >
                        {raw.unit_type === "kg" ? "kg" : "un"}
                      </span>
                    </p>
                    <p className="text-sm font-medium">
                      {formatCurrency(raw.price_per_unit)}
                      {raw.unit_type === "kg" ? <span className="ml-1 text-[10px] font-normal text-[#6b6a65]">/kg</span> : null}
                    </p>
                    <div>
                      <p
                        className={`text-sm ${
                          status === "out" ? "text-[#E24B4A]" : status === "low" ? "text-[#EF9F27]" : "text-[#c2c0b6]"
                        }`}
                      >
                        {formatStock(raw.stock_qty, raw.unit_type)}
                      </p>
                      {status === "low" ? (
                        <span className="rounded bg-[#2a2410] px-1.5 py-0.5 text-[10px] text-[#EF9F27]">
                          Baixo estoque (mín. {formatStock(raw.stock_alert_qty, raw.unit_type)})
                        </span>
                      ) : null}
                      {status === "out" ? <span className="rounded bg-[#1f1215] px-1.5 py-0.5 text-[10px] text-[#E24B4A]">Sem estoque</span> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openRestockModal(raw)}
                        className="rounded border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-xs text-[#6b6a65] hover:border-[#1D9E75] hover:bg-[#0a1f14] hover:text-[#1D9E75]"
                      >
                        +Estoque
                      </button>
                      <button
                        onClick={() => openPriceModal(raw)}
                        className="rounded border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-xs text-[#6b6a65] hover:border-[#378ADD] hover:bg-[#0e1f35] hover:text-[#378ADD]"
                      >
                        Preço
                      </button>
                      <button
                         onClick={() => {
                           setForm({
                             id: raw.id,
                             name: raw.name,
                             barcode: raw.barcode ?? "",
                             unit_type: raw.unit_type,
                             price_per_unit: raw.price_per_unit.toString(),
                             stock_qty: raw.stock_qty.toString(),
                             stock_alert_qty: raw.stock_alert_qty.toString(),
                             category_id: raw.category_id ? String(raw.category_id) : ""
                           });
                           setFormError(null);
                           setFormSuccess(null);
                           setProductModal({ open: true });
                         }}
                         className="rounded border border-[#2a2d35] bg-[#22262f] px-2 py-1 text-xs text-[#6b6a65] hover:border-[#1D9E75] hover:bg-[#0a1f14] hover:text-[#1D9E75]"
                       >
                         Editar
                       </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-[#2a2d35] px-3 py-2 text-xs text-[#6b6a65] flex items-center justify-between">
            <div>
              {filteredRows.length} produto{filteredRows.length !== 1 ? "s" : ""}
              {filteredRows.length !== rows.length ? ` (de ${rows.length} total)` : ""}
            </div>
            <button
              onClick={() => {
                setForm(initialForm);
                setFormError(null);
                setFormSuccess(null);
                setProductModal({ open: true });
              }}
              className="rounded-md bg-[#1D9E75] px-3 py-1 text-xs font-medium text-white hover:bg-[#16845f]"
            >
              + Novo produto
            </button>
          </div>
        </section>
      </div>

      {productModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-5">
            <h2 className="text-lg font-medium">{form.id ? "Editar produto" : "Novo produto"}</h2>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProduct();
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-[#c2c0b6]">Nome *</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                  className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[#c2c0b6]">Código de barras (opcional)</span>
                <input
                  value={form.barcode}
                  onChange={(event) => setForm((state) => ({ ...state, barcode: event.target.value }))}
                  className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[#c2c0b6]">Tipo de unidade *</span>
                <select
                  value={form.unit_type}
                  onChange={(event) => setForm((state) => ({ ...state, unit_type: event.target.value as UnitType }))}
                  className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                >
                  <option value="unit">unidade</option>
                  <option value="kg">kg</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[#c2c0b6]">Preço *</span>
                  <input
                    value={form.price_per_unit}
                    onChange={(event) => setForm((state) => ({ ...state, price_per_unit: event.target.value }))}
                    className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[#c2c0b6]">Categoria *</span>
                  <select
                    value={form.category_id}
                    onChange={(event) => setForm((state) => ({ ...state, category_id: event.target.value }))}
                    className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                  >
                    <option value="">Selecione</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[#c2c0b6]">Estoque atual</span>
                  <input
                    value={form.stock_qty}
                    onChange={(event) => setForm((state) => ({ ...state, stock_qty: event.target.value }))}
                    className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[#c2c0b6]">Alerta de estoque</span>
                  <input
                    value={form.stock_alert_qty}
                    onChange={(event) => setForm((state) => ({ ...state, stock_alert_qty: event.target.value }))}
                    className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm text-[#e8e6df] outline-none focus:border-[#1D9E75]"
                  />
                </label>
              </div>

              {formError ? <p className="text-sm text-[#ff8d8d]">{formError}</p> : null}
              {formSuccess ? <p className="text-sm text-[#7fd1b6]">{formSuccess}</p> : null}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setProductModal({ open: false });
                    setForm(initialForm);
                    setFormError(null);
                    setFormSuccess(null);
                  }}
                  className="flex-1 rounded-md border border-[#3a3f4d] px-3 py-2 text-sm text-[#c2c0b6] hover:bg-[#22262f]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-md bg-[#1D9E75] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {form.id ? "Salvar alterações" : "Cadastrar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {priceModal.open && priceModal.product ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h3 className="text-base font-medium">Atualizar preço</h3>
            <p className="mt-1 text-sm text-[#9ea097]">{priceModal.product.name}</p>
            {priceModal.error ? <p className="mt-3 text-sm text-[#ff8d8d]">{priceModal.error}</p> : null}
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void savePrice();
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-[#c2c0b6]">Novo preço</span>
                <input
                  autoFocus
                  value={priceModal.value}
                  onChange={(event) => setPriceModal((state) => ({ ...state, value: event.target.value }))}
                  className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
                  placeholder="0,00"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPriceModal({ open: false, product: null, value: "", error: null })}
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button type="submit" className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white">
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {restockModal.open && restockModal.product ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h3 className="text-base font-medium">Entrada de estoque</h3>
            <p className="mt-1 text-sm text-[#9ea097]">{restockModal.product.name}</p>
            <p className="mt-1 text-xs text-[#6b6a65]">Estoque atual: {formatStock(restockModal.product.stock_qty, restockModal.product.unit_type)}</p>
            {restockModal.error ? <p className="mt-3 text-sm text-[#ff8d8d]">{restockModal.error}</p> : null}
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmRestock();
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-[#c2c0b6]">Quantidade recebida ({restockModal.product.unit_type === "kg" ? "kg" : "un"})</span>
                <input
                  autoFocus
                  value={restockModal.value}
                  onChange={(event) => setRestockModal((state) => ({ ...state, value: event.target.value }))}
                  className="w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
                  placeholder="0"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRestockModal({ open: false, product: null, value: "", error: null })}
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button type="submit" className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white">
                  Confirmar entrada
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
