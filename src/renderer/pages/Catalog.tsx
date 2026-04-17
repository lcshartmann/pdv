/**
 * Catalog.tsx — Tela de Produtos
 *
 * Cobre as histórias:
 *   PROD-01  Registrar novo produto
 *   PROD-02  Atualizar preço
 *   PROD-03  Entrada de estoque
 *   PROD-04  Alerta de estoque baixo
 *
 * Em produção, substitua o estado local pelos canais IPC:
 *   window.api.product.list()    → listar produtos
 *   window.api.product.create()  → criar produto
 *   window.api.product.update()  → editar produto
 *   window.api.stock.receive()   → entrada de estoque (cria STOCK_MOVEMENT)
 */

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  type ChangeEvent,
} from "react";
import { Link } from "react-router-dom";
import ScrollArea from "../components/ScrollArea";
import { uiStoreActions, useUiStore, type CatalogStockFilter } from "../store/uiStore";
import type { Category, Product as ApiProduct, UnitType } from "../../shared/types";

// ─── Tipos (espelham /shared/types.ts) ───────────────────────────────────────

interface Product extends ApiProduct {
  category_name: string;
}

type SortKey = keyof Pick<Product, "name" | "category_name" | "unit_type" | "price_per_unit" | "stock_qty">;
type SortDir = 1 | -1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtQty = (v: number, u: UnitType) =>
  u === "kg" ? `${v.toFixed(3).replace(".", ",")} kg` : `${v} un`;

type StockStatus = "ok" | "low" | "out";

const stockStatus = (p: Product): StockStatus => {
  if (p.stock_qty === 0 && p.stock_alert_qty > 0)                  return "out";
  if (p.stock_qty <= p.stock_alert_qty && p.stock_alert_qty > 0)   return "low";
  return "ok";
};

// ─── Formulário de produto ────────────────────────────────────────────────────

interface ProductFormState {
  name: string;
  barcode: string;
  unit_type: UnitType;
  price_per_unit: string;
  stock_qty: string;
  stock_alert_qty: string;
  category_id: string;
}

const emptyForm = (defaultCategoryId: number | null): ProductFormState => ({
  name: "",
  barcode: "",
  unit_type: "unit",
  price_per_unit: "",
  stock_qty: "0",
  stock_alert_qty: "0",
  category_id: defaultCategoryId === null ? "" : String(defaultCategoryId),
});

const productToForm = (p: Product): ProductFormState => ({
  name:            p.name,
  barcode:         p.barcode ?? "",
  unit_type:       p.unit_type,
  price_per_unit:  p.price_per_unit.toString(),
  stock_qty:       p.stock_qty.toString(),
  stock_alert_qty: p.stock_alert_qty.toString(),
  category_id:     p.category_id === null ? "" : String(p.category_id),
});

const isFormValid = (f: ProductFormState) =>
  f.name.trim().length > 0 &&
  f.price_per_unit !== "" &&
  parseFloat(f.price_per_unit) >= 0;

// ─── Componentes atômicos ─────────────────────────────────────────────────────

const Kbd = ({ children }: { children: string }) => (
  <kbd className="bg-[#111318] border border-[#2a2d35] rounded px-1 py-px text-[10px] text-[#444441] font-mono">
    {children}
  </kbd>
);

interface LabelProps { children: React.ReactNode; required?: boolean }
const Label = ({ children, required }: LabelProps) => (
  <label className="block text-[11px] text-[#6b6a65] mb-1 uppercase tracking-wider">
    {children}{required && <span className="text-[#E24B4A] ml-0.5">*</span>}
  </label>
);
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <input
    ref={ref}
    {...props}
    className={[
      "w-full bg-[#22262f] border border-[#2a2d35] rounded-lg px-3 py-2",
      "text-[13px] text-[#e8e6df] outline-none",
      "focus:border-[#1D9E75] transition-colors",
      "placeholder:text-[#444441]",
      props.className ?? "",
    ].join(" ")}
  />
));
Input.displayName = "Input";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}
const Select = ({ children, ...props }: SelectProps) => (
  <select
    {...props}
    className={[
      "w-full bg-[#22262f] border border-[#2a2d35] rounded-lg px-3 py-2",
      "text-[13px] text-[#e8e6df] outline-none cursor-pointer",
      "focus:border-[#1D9E75] transition-colors",
      props.className ?? "",
    ].join(" ")}
  >
    {children}
  </select>
);

// ─── Modal base ───────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: string;
}

const Modal = ({ title, onClose, children, footer, width = "w-[480px]" }: ModalProps) => {
  // Fecha ao pressionar Esc
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`bg-[#1a1d24] border border-[#2a2d35] rounded-xl overflow-hidden ${width}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d35]">
          <span className="text-[14px] font-medium text-[#e8e6df]">{title}</span>
          <button
            onClick={onClose}
            className="text-[#6b6a65] hover:text-[#e8e6df] text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-4">{children}</div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2a2d35]">
          {footer}
        </div>
      </div>
    </div>
  );
};

// ─── PROD-01 / PROD-02 · Modal de produto ─────────────────────────────────────

interface ProductModalProps {
  product: Product | null;
  categories: Category[];
  existingBarcodes: (string | null)[];
  onClose: () => void;
  /** PROD-01: cria novo | PROD-02: salva edição */
  onSave: (form: ProductFormState, isNew: boolean) => Promise<void>;
}

const ProductModal = ({ product, categories, existingBarcodes, onClose, onSave }: ProductModalProps) => {
  const isNew = product === null;
  const [form, setForm] = useState<ProductFormState>(
    isNew ? emptyForm(categories[0]?.id ?? null) : productToForm(product)
  );
  const [barcodeError, setBarcodeError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleBarcodeChange = (v: string) => {
    // PROD-01: barcodes duplicados são rejeitados
    const isDuplicate = v.trim() !== "" &&
      existingBarcodes.some(
        (b) => b === v.trim() && (isNew || b !== product?.barcode)
      );
    setBarcodeError(isDuplicate ? "Código de barras já cadastrado." : "");
    set("barcode", v);
  };

  const valid = isFormValid(form) && !barcodeError;

  const step = form.unit_type === "kg" ? "0.001" : "1";

  return (
    <Modal
      title={isNew ? "Novo produto" : "Editar produto"}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#22262f] border border-[#2a2d35] text-[13px] text-[#c2c0b6] hover:bg-[#2a2d35] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (valid) {
                void onSave(form, isNew);
              }
            }}
            disabled={!valid}
            className="px-4 py-2 rounded-lg bg-[#1D9E75] text-[#085041] text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isNew ? "Criar produto" : "Salvar alterações"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Nome */}
        <div>
          <Label required>Nome do produto</Label>
          <Input
            ref={nameRef}
            value={form.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("name", e.target.value)}
            placeholder="Ex: Tomate"
          />
        </div>

        {/* Código de barras + Tipo */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Código de barras</Label>
            <Input
              value={form.barcode}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleBarcodeChange(e.target.value)}
              placeholder="Escanear ou digitar"
            />
            {barcodeError && (
              <p className="text-[11px] text-[#E24B4A] mt-1">{barcodeError}</p>
            )}
          </div>
          <div>
            <Label required>Tipo de unidade</Label>
            <Select
              value={form.unit_type}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                set("unit_type", e.target.value as UnitType)
              }
            >
              <option value="unit">Unidade</option>
              <option value="kg">Quilograma (kg)</option>
            </Select>
          </div>
        </div>

        {/* Preço + Categoria */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {/* PROD-02: campo de preço */}
            <Label required>
              Preço {form.unit_type === "kg" ? "por kg" : "por unidade"}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#6b6a65] pointer-events-none">
                R$
              </span>
              <Input
                className="pl-8"
                value={form.price_per_unit}
                type="number"
                min="0"
                step="0.01"
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  set("price_per_unit", e.target.value)
                }
                placeholder="0,00"
              />
            </div>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select
              value={form.category_id}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                set("category_id", e.target.value)
              }
            >
              {categories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Estoque + Alerta */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Estoque atual ({form.unit_type === "kg" ? "kg" : "un"})</Label>
            <Input
              value={form.stock_qty}
              type="number"
              min="0"
              step={step}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set("stock_qty", e.target.value)
              }
              placeholder="0"
            />
          </div>
          <div>
            {/* PROD-04: threshold de alerta */}
            <Label>Alerta de estoque mínimo</Label>
            <Input
              value={form.stock_alert_qty}
              type="number"
              min="0"
              step={step}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set("stock_alert_qty", e.target.value)
              }
              placeholder="0"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ─── PROD-03 · Modal de entrada de estoque ────────────────────────────────────

interface RestockModalProps {
  product: Product;
  onClose: () => void;
  /** PROD-03: cria STOCK_MOVEMENT { type: "restock", qty_change: qty } */
  onConfirm: (product: Product, qty: number) => Promise<void>;
}

const RestockModal = ({ product, onClose, onConfirm }: RestockModalProps) => {
  const [qty, setQty] = useState("");
  const parsed = parseFloat(qty);
  const valid  = qty !== "" && !isNaN(parsed) && parsed > 0;
  const step   = product.unit_type === "kg" ? "0.001" : "1";
  const ref    = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <Modal
      title="Entrada de estoque"
      onClose={onClose}
      width="w-[360px]"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#22262f] border border-[#2a2d35] text-[13px] text-[#c2c0b6] hover:bg-[#2a2d35] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (valid) {
                void onConfirm(product, parsed);
              }
            }}
            disabled={!valid}
            className="px-4 py-2 rounded-lg bg-[#1D9E75] text-[#085041] text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Confirmar entrada
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Info do produto */}
        <div className="bg-[#22262f] rounded-lg px-3 py-2.5 flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#e8e6df]">{product.name}</span>
          <span className="text-[12px] text-[#6b6a65]">
            Atual: {fmtQty(product.stock_qty, product.unit_type)}
          </span>
        </div>

        {/* Quantidade */}
        <div>
          <Label>Quantidade recebida ({product.unit_type === "kg" ? "kg" : "unidades"})</Label>
          <Input
            ref={ref}
            value={qty}
            type="number"
            min="0"
            step={step}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQty(e.target.value)}
            placeholder="0"
          />
        </div>

        {/* Preview do novo estoque */}
        {valid && (
          <p className="text-[12px] text-[#1D9E75]">
            Novo estoque: {fmtQty(product.stock_qty + parsed, product.unit_type)}
          </p>
        )}
      </div>
    </Modal>
  );
};

// ─── Linha da tabela ──────────────────────────────────────────────────────────

interface RowProps {
  product: Product;
  index: number;
  onEdit: (p: Product) => void;
  onRestock: (p: Product) => void;
}

const ProductRow = ({ product: p, index, onEdit, onRestock }: RowProps) => {
  const status = stockStatus(p);

  const stockColor =
    status === "out" ? "text-[#E24B4A]" :
    status === "low" ? "text-[#EF9F27]" :
    "text-[#c2c0b6]";

  return (
    <div
      className={[
        "grid items-center gap-2 px-4 py-2.5 border-b border-[#1e2128]",
        "hover:bg-[#1a1d24] transition-colors group",
        index % 2 !== 0 ? "bg-white/[0.012]" : "",
      ].join(" ")}
      style={{ gridTemplateColumns: "2fr 100px 64px 96px 120px 64px" }}
    >
      {/* Nome + barcode */}
      <div>
        <p className="text-[13px] font-medium text-[#e8e6df] leading-tight">{p.name}</p>
        <p className="text-[11px] text-[#444441] mt-0.5 font-mono">
          {p.barcode ?? "sem código"}
        </p>
      </div>

      {/* Categoria */}
      <p className="text-[12px] text-[#c2c0b6]">{p.category_name}</p>

      {/* Tipo */}
      <div>
        <span className={[
          "text-[11px] px-1.5 py-0.5 rounded",
          p.unit_type === "kg"
            ? "bg-[#0e1f35] text-[#378ADD]"
            : "bg-[#22262f] text-[#6b6a65]",
        ].join(" ")}>
          {p.unit_type === "kg" ? "kg" : "un"}
        </span>
      </div>

      {/* Preço */}
      <div>
        <span className="text-[13px] font-medium text-[#e8e6df]">
          {fmtBRL(p.price_per_unit)}
        </span>
        {p.unit_type === "kg" && (
          <span className="text-[10px] text-[#6b6a65]">/kg</span>
        )}
      </div>

      {/* Estoque — PROD-04: colorido quando baixo/zerado */}
      <div>
        <p className={`text-[13px] font-medium leading-tight ${stockColor}`}>
          {p.stock_alert_qty > 0 ? fmtQty(p.stock_qty, p.unit_type) : '-'}
        </p>
        {status === "out" && (
          <p className="text-[10px] text-[#E24B4A] mt-0.5">Sem estoque</p>
        )}
        {status === "low" && (
          <p className="text-[10px] text-[#EF9F27] mt-0.5">
            Mín: {fmtQty(p.stock_alert_qty, p.unit_type)}
          </p>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1">
        {/* PROD-03: entrada de estoque */}
        <button
          onClick={() => onRestock(p)}
          title="Entrada de estoque"
          className="w-7 h-7 rounded flex items-center justify-center text-[13px] bg-[#22262f] border border-[#2a2d35] text-[#6b6a65] hover:bg-[#0a1f14] hover:border-[#1D9E75] hover:text-[#1D9E75] transition-colors"
        >
          +
        </button>

        {/* PROD-02: editar / atualizar preço */}
        <button
          onClick={() => onEdit(p)}
          title="Editar produto"
          className="w-7 h-7 rounded flex items-center justify-center text-[13px] bg-[#22262f] border border-[#2a2d35] text-[#6b6a65] hover:bg-[#0e1f35] hover:border-[#378ADD] hover:text-[#378ADD] transition-colors"
        >
          ✎
        </button>

      </div>
    </div>
  );
};

// ─── Página principal ─────────────────────────────────────────────────────────

type ModalState =
  | { type: "none" }
  | { type: "new" }
  | { type: "edit"; product: Product }
  | { type: "restock"; product: Product };

export default function Catalog() {
  const [products, setProducts]       = useState<Product[]>([]);
  const [categories, setCategories]   = useState<Category[]>([]);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const { search, categoryFilter, stockFilter } = useUiStore((current) => current.catalogUi);
  const [sortKey, setSortKey]         = useState<SortKey>("name");
  const [sortDir, setSortDir]         = useState<SortDir>(1);
  const [modal, setModal]             = useState<ModalState>({ type: "none" });
  const searchRef = useRef<HTMLInputElement>(null);
  const hasOpenModal = modal.type !== "none";

  const closeModal = useCallback(() => setModal({ type: "none" }), []);

  // ── Atalhos de teclado ──
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (modal.type !== "none") return;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F8") { e.preventDefault(); setModal({ type: "new" }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal.type]);

  useEffect(() => {
    document.body.dataset.posModalOpen = hasOpenModal ? "true" : "false";
    return () => {
      delete document.body.dataset.posModalOpen;
    };
  }, [hasOpenModal]);

  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const [categoryRows, productRows] = await Promise.all([
        window.api.categoryList(),
        window.api.productList(),
      ]);
      const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));
      setCategories(categoryRows);
      setProducts(
        productRows.map((product) => ({
          ...product,
          category_name: product.category_id === null ? "Sem categoria" : (categoryNameById.get(product.category_id) ?? "Sem categoria"),
        }))
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar catálogo.");
    }
  }, []);

  // Fetch produtos
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // ── Filtro + ordenação ──
  const filtered = useMemo<Product[]>(() => {
    const q = search.toLowerCase();
    let list = products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode?.includes(q) ?? false);
      const matchCat =
        categoryFilter === "Todos" || p.category_id === categoryFilter;
      const s = stockStatus(p);
      const matchStock =
        stockFilter === "all" ||
        (stockFilter === "out" && s === "out") ||
        (stockFilter === "low" && (s === "low" || s === "out"));
      return matchSearch && matchCat && matchStock;
    });

    list.sort((a, b) => {
      let av: string | number = a[sortKey];
      let bv: string | number = b[sortKey];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
    return list;
  }, [products, search, categoryFilter, stockFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };

  
  // ── Estatísticas (PROD-04) ──
  const stats = useMemo(() => ({
    total:    products.length,
    lowStock: products.filter((p) => stockStatus(p) === "low").length,
    outStock: products.filter((p) => stockStatus(p) === "out").length,
  }), [products]);

  const catCounts = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [category.id, products.filter((p) => p.category_id === category.id).length])
      ) as Record<number, number>,
    [categories, products]
  );

  const existingBarcodes = useMemo(
    () => products.map((p) => p.barcode),
    [products]
  );

  // ── Handlers ──

  /** PROD-01 / PROD-02 */
  const handleSave = async (form: ProductFormState, isNew: boolean): Promise<void> => {
    const parsedCategoryId = Number(form.category_id);
    const categoryId = form.category_id === "" || Number.isNaN(parsedCategoryId) ? null : parsedCategoryId;
    const payload = {
      name:            form.name.trim(),
      barcode:         form.barcode.trim() || undefined,
      unit_type:       form.unit_type,
      price_per_unit:  parseFloat(form.price_per_unit),
      stock_qty:       parseFloat(form.stock_qty)       || 0,
      stock_alert_qty: parseFloat(form.stock_alert_qty) || 0,
      category_id:     categoryId ?? undefined,
    };

    try {
      if (isNew) {
        await window.api.productCreate(payload);
      } else if (modal.type === "edit") {
        await window.api.productUpdate({
          id: modal.product.id,
          ...payload,
        });
      }
      await loadCatalog();
      closeModal();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao salvar produto.");
    }
  };

  /** PROD-03 */
  const handleRestock = async (product: Product, qty: number): Promise<void> => {
    try {
      await window.api.productUpdate({
        id: product.id,
        name: product.name,
        barcode: product.barcode ?? undefined,
        unit_type: product.unit_type,
        price_per_unit: product.price_per_unit,
        stock_qty: product.stock_qty + qty,
        stock_alert_qty: product.stock_alert_qty,
        category_id: product.category_id ?? undefined,
      });
      await loadCatalog();
      closeModal();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao atualizar estoque.");
    }
  };

  // ── Colunas da tabela ──
  const COLS: { key: SortKey | ""; label: string }[] = [
    { key: "name",          label: "Produto"   },
    { key: "category_name", label: "Categoria" },
    { key: "unit_type",     label: "Tipo"      },
    { key: "price_per_unit",label: "Preço"     },
    { key: "stock_qty",     label: "Estoque"   },
    { key: "",              label: "Ações"     },
  ];

  const SortArrow = ({ k }: { k: SortKey | "" }) => {
    if (!k || sortKey !== k) return <span className="text-[#444441] text-[9px] ml-1">⇅</span>;
    return <span className="text-[#1D9E75] text-[9px] ml-1">{sortDir === 1 ? "↑" : "↓"}</span>;
  };

  const clockLabel = useMemo(() => {
    const nowDate = new Date();
    const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(nowDate);
    const date = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).format(nowDate);
    return `${time} · ${date.replace(".", "")}`;
  }, []);


  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111318] text-[#e8e6df]" style={{ fontFamily: "system-ui, sans-serif" }}>

     
      <div className="flex items-center justify-between border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-2">
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/" className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]">
            Venda <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F1</span>
          </Link>
          <Link to="/" className="rounded-md bg-[#22262f] px-3 py-1.5 text-[#e8e6df]">
            Produtos <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F6</span>
          </Link>
          <Link to="/reports" className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]">
            Relatórios <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">F7</span>
          </Link>
        </nav>
        <span className="text-sm text-[#9d9c99]">{clockLabel}</span>
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-[#1a1d24] border-b border-[#2a2d35] px-4 py-2.5 flex items-center gap-2.5 flex-wrap shrink-0">
        {/* Busca */}
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#6b6a65] pointer-events-none">
            ⌕
          </span>
          <Input
            ref={searchRef}
            className="pl-8 pr-14"
              placeholder="Buscar por nome ou código de barras..."
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => uiStoreActions.setCatalogSearch(e.target.value)}
            />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Kbd>F2</Kbd>
          </span>
        </div>

        {/* Filtro categoria */}
        <div className="flex gap-1 flex-wrap">
          {["Todos", ...categories.map((category) => category.id)].map((c) => (
            <button
              key={c}
              onClick={() => uiStoreActions.setCatalogCategoryFilter(c as number | "Todos")}
              className={[
                "px-3 py-1 rounded-full text-[12px] border transition-colors",
                categoryFilter === c
                  ? "border-[#1D9E75] bg-[#0a1f14] text-[#1D9E75]"
                  : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65] hover:text-[#c2c0b6]",
              ].join(" ")}
            >
              {c === "Todos" ? c : (categories.find((category) => category.id === c)?.name ?? "Sem categoria")}
            </button>
          ))}
        </div>

        {/* Filtro estoque — PROD-04 */}
        <div className="flex gap-1">
          {([["all", "Todos"], ["low", "Baixo"], ["out", "Zerado"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => uiStoreActions.setCatalogStockFilter(k as CatalogStockFilter)}
              className={[
                "px-2.5 py-1 rounded text-[12px] border transition-colors",
                stockFilter === k
                  ? "border-[#EF9F27] bg-[#2a2410] text-[#EF9F27]"
                  : "border-[#2a2d35] bg-[#22262f] text-[#6b6a65] hover:text-[#c2c0b6]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* PROD-01: botão novo produto */}
        <button
          onClick={() => setModal({ type: "new" })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1D9E75] text-[13px] text-[#d2d2cf] font-medium hover:bg-[#1a8f69] transition-colors whitespace-nowrap shrink-0"
        >
          + Novo produto <Kbd>F8</Kbd>
        </button>
      </div>

      {/* ── Corpo ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {loadError && (
          <div className="absolute right-4 top-[88px] z-10 rounded-lg border border-[#E24B4A] bg-[#1f1215] px-3 py-2 text-[12px] text-[#E24B4A]">
            {loadError}
          </div>
        )}

        {/* Sidebar */}
        <aside className="w-48 shrink-0 border-r border-[#2a2d35] bg-[#1a1d24]">
          <ScrollArea className="flex h-full flex-col gap-2 overflow-y-auto p-3.5">
            <p className="mb-1 text-[11px] uppercase tracking-widest text-[#6b6a65]">Resumo</p>

          {/* Stats — PROD-04: destaque visual */}
          {[
            { label: "Total",        value: stats.total,    color: "text-[#e8e6df]" },
            { label: "Estoque baixo",value: stats.lowStock, color: "text-[#EF9F27]" },
            { label: "Sem estoque",  value: stats.outStock, color: "text-[#E24B4A]" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#22262f] rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-[#6b6a65] mb-1">{label}</p>
              <p className={`text-2xl font-medium ${color}`}>{value}</p>
            </div>
          ))}

          {/* Categorias */}
            <div className="mt-2 border-t border-[#2a2d35] pt-3">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-[#6b6a65]">Categorias</p>
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => uiStoreActions.setCatalogCategoryFilter(category.id === categoryFilter ? "Todos" : category.id)}
                className={[
                  "w-full flex items-center justify-between py-1.5 text-[12px] border-b border-[#2a2d35]",
                  "transition-colors text-left",
                  categoryFilter === category.id ? "text-[#1D9E75]" : "text-[#c2c0b6] hover:text-[#e8e6df]",
                ].join(" ")}
              >
                <span>{category.name}</span>
                <span className="bg-[#22262f] rounded px-1.5 py-px text-[11px] text-[#6b6a65]">
                  {catCounts[category.id] ?? 0}
                </span>
              </button>
            ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Tabela */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Cabeçalho fixo */}
          <div
            className="grid gap-2 px-4 py-1.5 text-[11px] text-[#6b6a65] uppercase tracking-wider border-b border-[#2a2d35] bg-[#1a1d24] shrink-0"
            style={{ gridTemplateColumns: "2fr 100px 64px 96px 120px 64px" }}
          >
            {COLS.map(({ key, label }) => (
              <button
                key={label}
                onClick={() => key && toggleSort(key as SortKey)}
                className="flex items-center text-left hover:text-[#c2c0b6] transition-colors disabled:cursor-default"
                disabled={!key}
              >
                {label}
                <SortArrow k={key as SortKey | ""} />
              </button>
            ))}
          </div>

          {/* Linhas */}
          <ScrollArea className="flex-1 min-h-0 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-[13px] text-[#6b6a65]">
                Nenhum produto encontrado.
              </div>
            ) : (
              filtered.map((p, i) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  index={i}
                  onEdit={(p) => setModal({ type: "edit", product: p })}
                  onRestock={(p) => setModal({ type: "restock", product: p })}
                />
              ))
            )}

            {/* Rodapé */}
            <div className="px-4 py-2 text-[12px] text-[#6b6a65] border-t border-[#2a2d35]">
              {filtered.length} produto{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== products.length && ` (de ${products.length} total)`}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* ── Barra de atalhos ── */}
      <div className="bg-[#0d0f14] border-t border-[#2a2d35] px-4 py-1.5 flex gap-4 flex-wrap shrink-0">
        {[
          ["F1", "Ir para venda"],
          ["F2", "Buscar"],
          ["F6", "Produtos"],
          ["F7", "Relatórios"],
          ["F8", "Novo produto"],
          ["Esc", "Fechar modal"],
        ].map(([k, label]) => (
          <div key={k} className="flex items-center gap-1.5 text-[11px] text-[#444441]">
            <Kbd>{k}</Kbd>
            {label}
          </div>
        ))}
      </div>

      {/* ── Modais ── */}
      {modal.type === "new" && (
        <ProductModal
          product={null}
          categories={categories}
          existingBarcodes={existingBarcodes}
          onClose={closeModal}
          onSave={handleSave}
        />
      )}
      {modal.type === "edit" && (
        <ProductModal
          product={modal.product}
          categories={categories}
          existingBarcodes={existingBarcodes}
          onClose={closeModal}
          onSave={handleSave}
        />
      )}
      {modal.type === "restock" && (
        <RestockModal
          product={modal.product}
          onClose={closeModal}
          onConfirm={handleRestock}
        />
      )}
    </div>
  );
}
