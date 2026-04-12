import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Category, Product, UnitType } from "../../shared/types";

const T = {
  bg: "#111318",
  surface: "#22262f",
  panel: "#1a1d24",
  border: "#2a2d35",
  teal: "#1D9E75",
  tealDim: "#0F6E56",
  tealBg: "#0a1f14",
  red: "#E24B4A",
  redBg: "#1f1215",
  amber: "#EF9F27",
  amberBg: "#2a2410",
  blue: "#378ADD",
  blueBg: "#0e1f35",
  textPri: "#e8e6df",
  textSec: "#c2c0b6",
  textMut: "#6b6a65",
  textHint: "#444441"
} as const;

type StockFilter = "all" | "low" | "out";
type SortKey = "name" | "category" | "unit_type" | "price" | "stock";
type ModalState = "new" | { product: ViewProduct } | null;

interface ViewProduct {
  id: number;
  name: string;
  barcode: string | null;
  unit_type: UnitType;
  price: number;
  stock: number;
  alert: number;
  category_id: number | null;
  category: string;
}

interface ProductFormValue {
  id?: number;
  name: string;
  barcode: string;
  unit_type: UnitType;
  price: string;
  stock: string;
  alert: string;
  category: string;
}

interface ProductModalProps {
  product: ViewProduct | null;
  categories: string[];
  onClose: () => void;
  onSave: (form: ProductFormValue) => void;
}

interface RestockModalProps {
  product: ViewProduct;
  onClose: () => void;
  onSave: (qty: number) => void;
}

function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtQ(value: number, unitType: UnitType): string {
  return unitType === "kg" ? `${value.toFixed(3).replace(".", ",")} kg` : `${value} un`;
}

function stockStatus(product: ViewProduct): "ok" | "low" | "out" {
  if (product.stock <= 0) return "out";
  if (product.stock <= product.alert) return "low";
  return "ok";
}

const inputStyle: CSSProperties = {
  width: "100%",
  background: T.surface,
  border: `0.5px solid ${T.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: T.textPri,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit"
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: T.textMut,
  marginBottom: 5
};

const btnPrimary: CSSProperties = {
  background: T.teal,
  color: T.tealDim,
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit"
};

const btnNeutral: CSSProperties = {
  background: T.surface,
  color: T.textSec,
  border: `0.5px solid ${T.border}`,
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit"
};

const iconBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 5,
  border: `0.5px solid ${T.border}`,
  background: T.surface,
  color: T.textMut,
  fontSize: 13,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "inherit"
};

function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 4,
        padding: "1px 5px",
        fontSize: 10,
        color: T.textHint,
        fontFamily: "monospace"
      }}
    >
      {children}
    </span>
  );
}

function ProductModal({ product, categories, onClose, onSave }: ProductModalProps): JSX.Element {
  const isNew = !product;
  const [form, setForm] = useState<ProductFormValue>(
    product
      ? {
          id: product.id,
          name: product.name,
          barcode: product.barcode ?? "",
          unit_type: product.unit_type,
          price: product.price.toString(),
          stock: product.stock.toString(),
          alert: product.alert.toString(),
          category: product.category || (categories[0] ?? "")
        }
      : {
          name: "",
          barcode: "",
          unit_type: "unit",
          price: "",
          stock: "0",
          alert: "0",
          category: categories[0] ?? ""
        }
  );
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const setField = useCallback(<K extends keyof ProductFormValue>(key: K, value: ProductFormValue[K]) => {
    setForm((state) => ({ ...state, [key]: value }));
  }, []);

  const valid = form.name.trim() && form.price !== "" && Number(form.price.replace(",", ".")) > 0 && Boolean(form.category);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        style={{
          background: T.panel,
          border: `0.5px solid ${T.border}`,
          borderRadius: 12,
          width: 480,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `0.5px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: T.textPri }}>{isNew ? "Novo produto" : "Editar produto"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMut, fontSize: 18, cursor: "pointer" }}>
            ×
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Nome do produto *</label>
            <input
              ref={nameRef}
              style={inputStyle}
              value={form.name}
              disabled={!isNew}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="Ex: Tomate"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Código de barras</label>
              <input
                style={inputStyle}
                value={form.barcode}
                disabled={!isNew}
                onChange={(event) => setField("barcode", event.target.value)}
                placeholder="Escanear ou digitar"
              />
            </div>
            <div>
              <label style={labelStyle}>Tipo de unidade *</label>
              <select
                style={inputStyle}
                value={form.unit_type}
                disabled={!isNew}
                onChange={(event) => setField("unit_type", event.target.value as UnitType)}
              >
                <option value="unit">Unidade</option>
                <option value="kg">Quilograma (kg)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Preço {form.unit_type === "kg" ? "(por kg)" : "(por unidade)"} *</label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 13,
                    color: T.textMut,
                    pointerEvents: "none"
                  }}
                >
                  R$
                </span>
                <input
                  style={{ ...inputStyle, paddingLeft: 30 }}
                  value={form.price}
                  type="number"
                  min="0"
                  step="0.01"
                  onChange={(event) => setField("price", event.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Categoria</label>
              <select style={inputStyle} value={form.category} onChange={(event) => setField("category", event.target.value)}>
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Estoque atual ({form.unit_type === "kg" ? "kg" : "un"})</label>
              <input
                style={inputStyle}
                value={form.stock}
                type="number"
                min="0"
                step={form.unit_type === "kg" ? "0.001" : "1"}
                onChange={(event) => setField("stock", event.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label style={labelStyle}>Alerta de estoque mínimo</label>
              <input
                style={inputStyle}
                value={form.alert}
                type="number"
                min="0"
                step={form.unit_type === "kg" ? "0.001" : "1"}
                onChange={(event) => setField("alert", event.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 16px", borderTop: `0.5px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnNeutral}>
            Cancelar
          </button>
          <button
            onClick={() => valid && onSave(form)}
            style={{ ...btnPrimary, opacity: valid ? 1 : 0.4, cursor: valid ? "pointer" : "not-allowed" }}
          >
            {isNew ? "Criar produto" : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RestockModal({ product, onClose, onSave }: RestockModalProps): JSX.Element {
  const [qty, setQty] = useState("");
  const valid = qty !== "" && Number(qty) > 0;
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div style={{ background: T.panel, border: `0.5px solid ${T.border}`, borderRadius: 12, width: 360, overflow: "hidden" }}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `0.5px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: T.textPri }}>Entrada de estoque</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMut, fontSize: 18, cursor: "pointer" }}>
            ×
          </button>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ background: T.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: T.textSec }}>
            <span style={{ fontWeight: 500, color: T.textPri }}>{product.name}</span>
            <span style={{ marginLeft: 8, color: T.textMut }}>Estoque atual: {fmtQ(product.stock, product.unit_type)}</span>
          </div>

          <label style={labelStyle}>Quantidade recebida ({product.unit_type === "kg" ? "kg" : "unidades"})</label>
          <input
            ref={ref}
            style={inputStyle}
            value={qty}
            type="number"
            min="0"
            step={product.unit_type === "kg" ? "0.001" : "1"}
            onChange={(event) => setQty(event.target.value)}
            placeholder="0"
          />

          {qty && Number(qty) > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: T.teal }}>Novo estoque: {fmtQ(product.stock + Number(qty), product.unit_type)}</div>
          ) : null}
        </div>

        <div style={{ padding: "12px 16px", borderTop: `0.5px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnNeutral}>
            Cancelar
          </button>
          <button
            onClick={() => valid && onSave(Number(qty))}
            style={{ ...btnPrimary, opacity: valid ? 1 : 0.4, cursor: valid ? "pointer" : "not-allowed" }}
          >
            Confirmar entrada
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CatalogPage(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todos");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [modal, setModal] = useState<ModalState>(null);
  const [restock, setRestock] = useState<ViewProduct | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    const [productRows, categoryRows] = await Promise.all([window.api.productList(), window.api.categoryList()]);
    setProducts(productRows);
    setCategories(categoryRows);
  }, []);

  useEffect(() => {
    void loadData().catch((error: unknown) => {
      setMessageError(error instanceof Error ? error.message : "Falha ao carregar catálogo.");
    });
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setModal(null);
        setRestock(null);
        return;
      }
      if (modal || restock) {
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "F8") {
        event.preventDefault();
        setModal("new");
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [modal, restock]);

  const categoryNameById = useMemo(() => new Map(categories.map((entry) => [entry.id, entry.name])), [categories]);
  const selectableCategories = useMemo(() => categories.map((entry) => entry.name), [categories]);
  const categoryPills = useMemo(() => ["Todos", ...selectableCategories], [selectableCategories]);

  const viewProducts = useMemo<ViewProduct[]>(
    () =>
      products.map((product) => ({
        id: product.id,
        name: product.name,
        barcode: product.barcode,
        unit_type: product.unit_type,
        price: product.price_per_unit,
        stock: product.stock_qty,
        alert: product.stock_alert_qty,
        category_id: product.category_id,
        category: product.category_id ? categoryNameById.get(product.category_id) ?? "Sem categoria" : "Sem categoria"
      })),
    [categoryNameById, products]
  );

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    const result = viewProducts.filter((product) => {
      const matchSearch = !query || product.name.toLowerCase().includes(query) || (product.barcode ? product.barcode.includes(query) : false);
      const matchCategory = category === "Todos" || product.category === category;
      const stock = stockStatus(product);
      const matchStock =
        stockFilter === "all" || (stockFilter === "out" && stock === "out") || (stockFilter === "low" && (stock === "low" || stock === "out"));
      return matchSearch && matchCategory && matchStock;
    });

    result.sort((left, right) => {
      const a = sortKey === "price" ? left.price : sortKey === "stock" ? left.stock : left[sortKey];
      const b = sortKey === "price" ? right.price : sortKey === "stock" ? right.stock : right[sortKey];
      if (typeof a === "string" && typeof b === "string") {
        return a.toLowerCase() < b.toLowerCase() ? -sortDir : a.toLowerCase() > b.toLowerCase() ? sortDir : 0;
      }
      return a < b ? -sortDir : a > b ? sortDir : 0;
    });

    return result;
  }, [category, search, sortDir, sortKey, stockFilter, viewProducts]);

  const toggleSort = useCallback((key: SortKey): void => {
    if (sortKey === key) {
      setSortDir((direction) => (direction === 1 ? -1 : 1));
      return;
    }
    setSortKey(key);
    setSortDir(1);
  }, [sortKey]);

  const saveProduct = useCallback(
    async (form: ProductFormValue): Promise<void> => {
      const name = form.name.trim();
      const price = Number(form.price.replace(",", "."));
      const stock = Number(form.stock.replace(",", "."));
      const alert = Number(form.alert.replace(",", "."));
      const categoryMatch = categories.find((entry) => entry.name === form.category);
      const categoryId = categoryMatch?.id;

      if (!name) {
        setMessageError("Nome é obrigatório.");
        return;
      }
      if (!Number.isFinite(price) || price <= 0) {
        setMessageError("Preço deve ser maior que zero.");
        return;
      }
      if (!Number.isFinite(stock) || stock < 0) {
        setMessageError("Estoque deve ser maior ou igual a zero.");
        return;
      }
      if (!Number.isFinite(alert) || alert < 0) {
        setMessageError("Alerta deve ser maior ou igual a zero.");
        return;
      }
      if (!categoryId) {
        setMessageError("Categoria é obrigatória.");
        return;
      }

      setMessageError(null);
      setMessageSuccess(null);

      try {
        if (!form.id) {
          await window.api.productCreate({
            name,
            barcode: form.barcode.trim() || undefined,
            unit_type: form.unit_type,
            price_per_unit: price,
            stock_qty: stock,
            stock_alert_qty: alert,
            category_id: categoryId
          });
          setMessageSuccess("Produto cadastrado com sucesso.");
        } else {
          const current = products.find((entry) => entry.id === form.id);
          if (!current) {
            throw new Error("Produto não encontrado.");
          }
          await window.api.productUpdate({
            id: current.id,
            name,
            barcode: form.barcode.trim() || undefined,
            unit_type: form.unit_type,
            price_per_unit: price,
            stock_qty: stock,
            stock_alert_qty: alert,
            category_id: categoryId
          });
          setMessageSuccess("Produto atualizado com sucesso.");
        }

        setModal(null);
        await loadData();
      } catch (error) {
        setMessageError(error instanceof Error ? error.message : "Falha ao salvar produto.");
      }
    },
    [categories, loadData, products]
  );

  const saveRestock = useCallback(
    async (qty: number): Promise<void> => {
      if (!restock) {
        return;
      }
      const current = products.find((entry) => entry.id === restock.id);
      if (!current) {
        setMessageError("Produto não encontrado.");
        return;
      }

      setMessageError(null);
      setMessageSuccess(null);
      try {
        await window.api.productUpdate({
          id: current.id,
          name: current.name,
          barcode: current.barcode ?? undefined,
          unit_type: current.unit_type,
          price_per_unit: current.price_per_unit,
          stock_qty: current.stock_qty + qty,
          stock_alert_qty: current.stock_alert_qty,
          category_id: current.category_id ?? undefined
        });
        setRestock(null);
        setMessageSuccess("Entrada de estoque registrada.");
        await loadData();
      } catch (error) {
        setMessageError(error instanceof Error ? error.message : "Falha ao registrar entrada de estoque.");
      }
    },
    [loadData, products, restock]
  );

  const deleteProduct = useCallback((): void => {
    setMessageError("Remoção de produto ainda não está disponível nesta versão.");
  }, []);

  const stats = useMemo(
    () => ({
      total: viewProducts.length,
      lowStock: viewProducts.filter((product) => stockStatus(product) === "low").length,
      outStock: viewProducts.filter((product) => stockStatus(product) === "out").length
    }),
    [viewProducts]
  );

  const catCounts = useMemo(() => {
    return Object.fromEntries(selectableCategories.map((cat) => [cat, viewProducts.filter((product) => product.category === cat).length]));
  }, [selectableCategories, viewProducts]);

  const COLS: Array<{ key: SortKey | ""; label: string; width: string }> = [
    { key: "name", label: "Produto", width: "2fr" },
    { key: "category", label: "Categoria", width: "100px" },
    { key: "unit_type", label: "Tipo", width: "60px" },
    { key: "price", label: "Preço", width: "90px" },
    { key: "stock", label: "Estoque", width: "110px" },
    { key: "", label: "Ações", width: "88px" }
  ];
  const gridCols = COLS.map((column) => column.width).join(" ");

  const SortArrow = ({ k }: { k: SortKey }): JSX.Element => {
    if (sortKey !== k) return <span style={{ color: T.textHint, fontSize: 9, marginLeft: 3 }}>⇅</span>;
    return <span style={{ color: T.teal, fontSize: 9, marginLeft: 3 }}>{sortDir === 1 ? "↑" : "↓"}</span>;
  };

  return (
    <div style={{ background: T.bg, height: "100%", minHeight: 0, fontFamily: "system-ui, sans-serif", color: T.textPri, display: "flex", flexDirection: "column" }}>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${T.border}`,
          background: T.panel,
          padding: "8px 16px",
          flexShrink: 0
        }}
      >
        <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <Link
            to="/"
            style={{
              borderRadius: 6,
              padding: "6px 12px",
              color: "#c2c0b6",
              display: "flex",
              alignItems: "center",
              gap: 6,
              textDecoration: "none"
            }}
          >
            Venda <Kbd>F1</Kbd>
          </Link>
        <Link
          to="/catalog"
          style={{
            borderRadius: 6,
            padding: "6px 12px",
            color: "#e8e6df",
            background: T.surface,
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none"
          }}
        >
          Produtos <Kbd>F6</Kbd>
        </Link>
        <Link
          to="/reports"
          style={{
            borderRadius: 6,
            padding: "6px 12px",
            color: "#c2c0b6",
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none"
          }}
        >
          Relatórios <Kbd>F7</Kbd>
        </Link>
        </nav>
        <div style={{ fontSize: 14, color: "#9d9c99" }}>
          {new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(now)}
        </div>
      </div>

      <div
        style={{
          background: T.panel,
          borderBottom: `0.5px solid ${T.border}`,
          padding: "10px 16px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          flexShrink: 0
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 13,
              color: T.textMut,
              pointerEvents: "none"
            }}
          >
            ⌕
          </span>
          <input
            ref={searchRef}
            style={{ ...inputStyle, paddingLeft: 30, paddingRight: 44 }}
            placeholder="Buscar por nome ou código de barras..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
            <Kbd>F2</Kbd>
          </span>
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {categoryPills.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              style={{
                padding: "5px 12px",
                borderRadius: 99,
                fontSize: 12,
                fontFamily: "inherit",
                border: `0.5px solid ${category === item ? T.teal : T.border}`,
                background: category === item ? T.tealBg : T.surface,
                color: category === item ? T.teal : T.textMut,
                cursor: "pointer"
              }}
            >
              {item}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {[
            ["all", "Todos"],
            ["low", "Baixo"],
            ["out", "Zerado"]
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStockFilter(key as StockFilter)}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "inherit",
                border: `0.5px solid ${stockFilter === key ? T.amber : T.border}`,
                background: stockFilter === key ? T.amberBg : T.surface,
                color: stockFilter === key ? T.amber : T.textMut,
                cursor: "pointer"
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button onClick={() => setModal("new")} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          + Novo produto <Kbd>F8</Kbd>
        </button>
      </div>

      {(messageError || messageSuccess) && (
        <div style={{ background: T.panel, borderBottom: `0.5px solid ${T.border}`, padding: "6px 16px", fontSize: 12 }}>
          {messageError ? <span style={{ color: "#ff8d8d" }}>{messageError}</span> : null}
          {messageSuccess ? <span style={{ color: "#7fd1b6" }}>{messageSuccess}</span> : null}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            width: 196,
            background: T.panel,
            borderRight: `0.5px solid ${T.border}`,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flexShrink: 0,
            overflowY: "auto"
          }}
        >
          <div style={{ fontSize: 11, color: T.textMut, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Resumo</div>
          {[
            { label: "Total de produtos", value: stats.total, color: T.textPri },
            { label: "Estoque baixo", value: stats.lowStock, color: T.amber },
            { label: "Sem estoque", value: stats.outStock, color: T.red }
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: T.surface, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: T.textMut, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 500, color }}>{value}</div>
            </div>
          ))}

          <div style={{ marginTop: 8, borderTop: `0.5px solid ${T.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: T.textMut, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Categorias</div>
            {selectableCategories.map((item) => (
              <div
                key={item}
                onClick={() => setCategory(item === category ? "Todos" : item)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 0",
                  fontSize: 12,
                  cursor: "pointer",
                  color: category === item ? T.teal : T.textSec,
                  borderBottom: `0.5px solid ${T.border}`
                }}
              >
                <span>{item}</span>
                <span style={{ background: T.surface, borderRadius: 4, padding: "1px 7px", fontSize: 11, color: T.textMut }}>
                  {catCounts[item] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              gap: 8,
              padding: "7px 14px",
              fontSize: 11,
              color: T.textMut,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: `0.5px solid ${T.border}`,
              background: T.panel,
              flexShrink: 0
            }}
          >
            {COLS.map(({ key, label }) => (
              <div
                key={label}
                onClick={() => key && toggleSort(key)}
                style={{ cursor: key ? "pointer" : "default", userSelect: "none", display: "flex", alignItems: "center" }}
              >
                {label}
                {key ? <SortArrow k={key} /> : null}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "48px 0", textAlign: "center", color: T.textMut, fontSize: 13 }}>Nenhum produto encontrado.</div>
            ) : (
              filtered.map((product, index) => {
                const status = stockStatus(product);
                const rowBg = index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)";
                return (
                  <div
                    key={product.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      gap: 8,
                      padding: "9px 14px",
                      alignItems: "center",
                      borderBottom: "0.5px solid #1e2128",
                      background: rowBg,
                      transition: "background 0.08s"
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = T.panel;
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = rowBg;
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.textPri }}>{product.name}</div>
                      {product.barcode ? (
                        <div style={{ fontSize: 11, color: T.textHint, marginTop: 1, fontFamily: "monospace" }}>{product.barcode}</div>
                      ) : (
                        <div style={{ fontSize: 11, color: T.textHint, marginTop: 1 }}>sem código</div>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: T.textSec }}>{product.category}</div>

                    <div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: product.unit_type === "kg" ? T.blueBg : T.surface,
                          color: product.unit_type === "kg" ? T.blue : T.textMut
                        }}
                      >
                        {product.unit_type === "kg" ? "kg" : "un"}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 500, color: T.textPri }}>
                      {fmtCurrency(product.price)}
                      {product.unit_type === "kg" ? <span style={{ fontSize: 10, color: T.textMut, fontWeight: 400 }}>/kg</span> : null}
                    </div>

                    <div>
                      <div style={{ fontSize: 13, color: status === "out" ? T.red : status === "low" ? T.amber : T.textSec, fontWeight: status !== "ok" ? 500 : 400 }}>
                        {fmtQ(product.stock, product.unit_type)}
                      </div>
                      {status === "out" ? <div style={{ fontSize: 10, color: T.red, marginTop: 1 }}>Sem estoque</div> : null}
                      {status === "low" ? <div style={{ fontSize: 10, color: T.amber, marginTop: 1 }}>Mín: {fmtQ(product.alert, product.unit_type)}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 4 }}>
                      {[
                        {
                          label: "+",
                          title: "Entrada de estoque",
                          hoverBg: T.tealBg,
                          hoverBorder: T.teal,
                          hoverColor: T.teal,
                          action: () => setRestock(product)
                        },
                        {
                          label: "✎",
                          title: "Editar produto",
                          hoverBg: T.blueBg,
                          hoverBorder: T.blue,
                          hoverColor: T.blue,
                          action: () => setModal({ product })
                        },
                        {
                          label: "×",
                          title: "Remover produto",
                          hoverBg: T.redBg,
                          hoverBorder: T.red,
                          hoverColor: T.red,
                          action: () => deleteProduct()
                        }
                      ].map(({ label, title, hoverBg, hoverBorder, hoverColor, action }) => (
                        <button
                          key={label}
                          title={title}
                          onClick={action}
                          style={iconBtn}
                          onMouseEnter={(event) => {
                            event.currentTarget.style.background = hoverBg;
                            event.currentTarget.style.borderColor = hoverBorder;
                            event.currentTarget.style.color = hoverColor;
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.style.background = T.surface;
                            event.currentTarget.style.borderColor = T.border;
                            event.currentTarget.style.color = T.textMut;
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <div style={{ padding: "8px 14px", fontSize: 12, color: T.textMut, borderTop: `0.5px solid ${T.border}` }}>
              {filtered.length} produto{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== viewProducts.length ? ` (de ${viewProducts.length} total)` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "#0d0f14", borderTop: `0.5px solid ${T.border}`, padding: "5px 14px", display: "flex", gap: 16, flexWrap: "wrap", flexShrink: 0 }}>
        <Link to="/" style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint, textDecoration: "none" }}>
          <Kbd>F1</Kbd> Ir para venda
        </Link>
        <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint }}>
          <Kbd>F2</Kbd> Buscar
        </div>
        <Link to="/catalog" style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint, textDecoration: "none" }}>
          <Kbd>F6</Kbd> Produtos
        </Link>
        <Link to="/reports" style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint, textDecoration: "none" }}>
          <Kbd>F7</Kbd> Relatórios
        </Link>
        <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint }}>
          <Kbd>F8</Kbd> Novo produto
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: T.textHint }}>
          <Kbd>Esc</Kbd> Fechar modal
        </div>
      </div>

      {modal === "new" ? <ProductModal product={null} categories={selectableCategories} onClose={() => setModal(null)} onSave={(form) => void saveProduct(form)} /> : null}
      {modal && modal !== "new" ? (
        <ProductModal product={modal.product} categories={selectableCategories} onClose={() => setModal(null)} onSave={(form) => void saveProduct(form)} />
      ) : null}
      {restock ? <RestockModal product={restock} onClose={() => setRestock(null)} onSave={(qty) => void saveRestock(qty)} /> : null}
    </div>
  );
}
