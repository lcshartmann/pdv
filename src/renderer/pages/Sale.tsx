import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ScrollArea from "../components/ScrollArea";
import { uiStoreActions, useUiStore } from "../store/uiStore";
import type { Product, SaleItem, UnitType } from "../../shared/types";

interface SaleLine {
  saleItemId: number;
  productId: number;
  product: string;
  detail: string;
  quantityLabel: string;
  quantityValue: number;
  unitPrice: number;
  total: number;
}

interface UnitModalState {
  open: boolean;
  product: Product | null;
  quantity: string;
}

interface WeightModalState {
  open: boolean;
  product: Product | null;
  weight: string;
  loading: boolean;
  scaleError: string | null;
}

interface EditModalState {
  open: boolean;
  line: SaleLine | null;
  quantity: string;
}

interface CancelModalState {
  open: boolean;
  error: string | null;
}

interface CashModalState {
  open: boolean;
  amountReceived: string;
  error: string | null;
}

interface PrinterWarningState {
  open: boolean;
  saleId: number | null;
  message: string;
}

// Quantidade de cards fixos no rail de seleção (atalhos 1-9 e 0).
const QUICK_CARD_COUNT = 10;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function formatQuantity(value: number, unitType: Product["unit_type"]): string {
  if (unitType === "kg") {
    return `${value.toFixed(3).replace(".", ",")} kg`;
  }

  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    value
  );
}

// Valor monetário — sempre em serifada com dígitos tabulares para alinhar
// colunas. É o único lugar onde fugimos da fonte sans do sistema.
function Money({
  value,
  className = ""
}: {
  value: number;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={`font-serif [font-variant-numeric:tabular-nums] ${className}`.trim()}
    >
      {formatCurrency(value)}
    </span>
  );
}

// Atalho exibido/ativado por card: 1..9 e 0 para o décimo.
function shortcutFor(index: number): string {
  return String((index + 1) % 10);
}

// Data local no formato ISO (YYYY-MM-DD), como o painel de relatórios espera.
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createLine(item: SaleItem, product: Product): SaleLine {
  return {
    saleItemId: item.id,
    productId: product.id,
    product: product.name,
    detail:
      product.unit_type === "kg"
        ? `kg · ${formatCurrency(item.unit_price)}/kg`
        : "unidade",
    quantityLabel: formatQuantity(item.quantity, product.unit_type),
    quantityValue: item.quantity,
    unitPrice: item.unit_price,
    total: item.total
  };
}

export default function SalePage(): JSX.Element {
  const { saleId, saleStatus, saleLines } = useUiStore(
    (current) => current.saleSession
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [mostSoldIds, setMostSoldIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStartingSale, setIsStartingSale] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState(false);
  const [isCancellingSale, setIsCancellingSale] = useState(false);
  const [isProcessingCashPayment, setIsProcessingCashPayment] = useState(false);
  const [unitModal, setUnitModal] = useState<UnitModalState>({
    open: false,
    product: null,
    quantity: "1"
  });
  const [weightModal, setWeightModal] = useState<WeightModalState>({
    open: false,
    product: null,
    weight: "",
    loading: false,
    scaleError: null
  });
  const [editModal, setEditModal] = useState<EditModalState>({
    open: false,
    line: null,
    quantity: ""
  });
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState<CancelModalState>({
    open: false,
    error: null
  });
  const [cashModal, setCashModal] = useState<CashModalState>({
    open: false,
    amountReceived: "",
    error: null
  });
  const [printerWarning, setPrinterWarning] = useState<PrinterWarningState>({
    open: false,
    saleId: null,
    message: ""
  });
  const [now, setNow] = useState(new Date());
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleStatusLabel, setScaleStatusLabel] = useState(
    "Balança Prix 3 desconectada"
  );
  const [lastScaleWeightKg, setLastScaleWeightKg] = useState(0);

  const startingSaleRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const productUnitById = useMemo(() => {
    const map = new Map<number, UnitType>();
    products.forEach((product) => map.set(product.id, product.unit_type));
    return map;
  }, [products]);

  // Resultado do rail: busca por nome quando há termo; senão, os mais vendidos
  // (ordenados pelo relatório) seguidos do resto do catálogo, até 10 slots.
  const pickerResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      return products
        .filter((product) => product.name.toLowerCase().includes(term))
        .slice(0, QUICK_CARD_COUNT);
    }

    if (mostSoldIds.length > 0) {
      const byId = new Map(products.map((product) => [product.id, product]));
      const ordered = mostSoldIds
        .map((id) => byId.get(id))
        .filter((product): product is Product => Boolean(product));
      const seen = new Set(ordered.map((product) => product.id));
      const rest = products.filter((product) => !seen.has(product.id));
      return [...ordered, ...rest].slice(0, QUICK_CARD_COUNT);
    }

    return products.slice(0, QUICK_CARD_COUNT);
  }, [products, search, mostSoldIds]);

  const quickCards = useMemo<(Product | null)[]>(
    () =>
      Array.from(
        { length: QUICK_CARD_COUNT },
        (_, index) => pickerResults[index] ?? null
      ),
    [pickerResults]
  );

  // Ao mudar a busca, volta o destaque para o primeiro resultado.
  useEffect(() => {
    setHighlight(0);
  }, [search]);

  const loadProducts = useCallback(async (): Promise<void> => {
    const productRows = await window.api.productList();
    setProducts(productRows);
  }, []);

  const loadMostSold = useCallback(async (): Promise<void> => {
    try {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 90);
      const dashboard = await window.api.reportsDashboard({
        fromDate: toIsoDate(from),
        toDate: toIsoDate(to)
      });
      setMostSoldIds(
        dashboard.top_products_by_quantity.map((entry) => entry.product_id)
      );
    } catch {
      // Sem dados de venda ainda: o rail cai no catálogo em ordem padrão.
      setMostSoldIds([]);
    }
  }, []);

  const syncScaleStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.scaleGetStatus();
      setScaleConnected(status.connected);
      setScaleStatusLabel(
        status.connected
          ? "Balança Prix 3 conectada"
          : "Balança Prix 3 desconectada"
      );
      setLastScaleWeightKg(status.lastWeightKg ?? 0);
    } catch {
      setScaleConnected(false);
      setScaleStatusLabel("Balança Prix 3 desconectada");
    }
  }, []);

  const startNewSale = useCallback(
    async (options?: { force?: boolean }): Promise<void> => {
      if (startingSaleRef.current) {
        return;
      }

      const force = options?.force ?? false;
      const isCurrentSaleEmpty =
        saleStatus === "open" && saleLines.length === 0;
      if (!force && isCurrentSaleEmpty) {
        return;
      }

      startingSaleRef.current = true;
      setIsStartingSale(true);
      setErrorMessage(null);
      uiStoreActions.setSaleStatus("open");
      uiStoreActions.setSaleLines([]);
      setSearch("");
      setUnitModal({ open: false, product: null, quantity: "1" });
      setWeightModal({
        open: false,
        product: null,
        weight: "",
        loading: false,
        scaleError: null
      });
      setEditModal({ open: false, line: null, quantity: "" });
      setEditModalError(null);
      setCancelModal({ open: false, error: null });
      setCashModal({ open: false, amountReceived: "", error: null });

      try {
        const saleResponse = await window.api.saleCreate();
        uiStoreActions.setSaleId(saleResponse.saleId);
        searchInputRef.current?.focus();
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Falha ao iniciar nova venda."
        );
      } finally {
        startingSaleRef.current = false;
        setIsStartingSale(false);
      }
    },
    [saleLines.length, saleStatus]
  );

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    const bootstrap = async (): Promise<void> => {
      try {
        await loadProducts();
        await loadMostSold();
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Falha ao carregar tela de venda."
        );
      }
    };

    void bootstrap();
  }, [loadMostSold, loadProducts, saleId, startNewSale]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void syncScaleStatus();
    const timer = window.setInterval(() => {
      void syncScaleStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [syncScaleStatus]);

  const clockLabel = useMemo(() => {
    const time = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);
    const date = new Intl.DateTimeFormat("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    }).format(now);
    return `${time} · ${date.replace(".", "")}`;
  }, [now]);

  const subtotal = useMemo(
    () => saleLines.reduce((acc, line) => acc + line.total, 0),
    [saleLines]
  );
  const unitCount = useMemo(
    () => saleLines.reduce((acc, line) => acc + line.quantityValue, 0),
    [saleLines]
  );
  const isCurrentSaleEmpty = saleStatus === "open" && saleLines.length === 0;
  const amountReceivedValue = Number(
    cashModal.amountReceived.replace(",", ".")
  );
  const isAmountReceivedValid =
    Number.isFinite(amountReceivedValue) && amountReceivedValue >= 0;
  const changeAmount = isAmountReceivedValid
    ? amountReceivedValue - subtotal
    : 0;
  const isCashConfirmDisabled =
    isProcessingCashPayment ||
    saleStatus !== "open" ||
    subtotal <= 0 ||
    !isAmountReceivedValid ||
    amountReceivedValue < subtotal;

  const openCashModal = useCallback((): void => {
    if (!saleId || saleStatus !== "open") {
      return;
    }

    setCashModal({
      open: true,
      amountReceived: subtotal > 0 ? subtotal.toFixed(2).replace(".", ",") : "",
      error: null
    });
  }, [saleId, saleStatus, subtotal]);

  const confirmCashPayment = useCallback(async (): Promise<void> => {
    if (!saleId || saleStatus !== "open") {
      return;
    }

    const received = Number(cashModal.amountReceived.replace(",", "."));
    if (!Number.isFinite(received) || received < 0) {
      setCashModal((state) => ({
        ...state,
        error: "Valor recebido inválido."
      }));
      return;
    }

    if (subtotal <= 0) {
      setCashModal((state) => ({
        ...state,
        error: "Não há itens para pagamento."
      }));
      return;
    }

    if (received < subtotal) {
      setCashModal((state) => ({
        ...state,
        error: "Valor recebido deve ser maior ou igual ao total."
      }));
      return;
    }

    setIsProcessingCashPayment(true);
    setCashModal((state) => ({ ...state, error: null }));
    setErrorMessage(null);
    try {
      const change = received - subtotal;
      await window.api.paymentCreate({
        sale_id: saleId,
        method: "cash",
        amount: subtotal,
        change_amount: change,
        status: "confirmed"
      });
      await window.api.saleComplete({ saleId });
      uiStoreActions.setSaleStatus("completed");
      setCashModal({ open: false, amountReceived: "", error: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Falha ao finalizar pagamento em dinheiro.";
      if (message.startsWith("[PRINTER_OFFLINE]")) {
        uiStoreActions.setSaleStatus("completed");
        setCashModal({ open: false, amountReceived: "", error: null });
        setPrinterWarning({
          open: true,
          saleId,
          message: message.replace("[PRINTER_OFFLINE] ", "")
        });
      } else {
        setCashModal({
          open: true,
          amountReceived: cashModal.amountReceived,
          error: message
        });
      }
    } finally {
      setIsProcessingCashPayment(false);
    }
  }, [cashModal.amountReceived, saleId, saleStatus, subtotal]);

  const closeOpenModal = useCallback((): boolean => {
    if (cashModal.open) {
      setCashModal({ open: false, amountReceived: "", error: null });
      return true;
    }

    if (printerWarning.open) {
      setPrinterWarning({ open: false, saleId: null, message: "" });
      return true;
    }

    if (unitModal.open) {
      setUnitModal({ open: false, product: null, quantity: "1" });
      return true;
    }

    if (editModal.open) {
      setEditModal({ open: false, line: null, quantity: "" });
      setEditModalError(null);
      return true;
    }

    if (weightModal.open) {
      setWeightModal({
        open: false,
        product: null,
        weight: "",
        loading: false,
        scaleError: null
      });
      return true;
    }

    if (cancelModal.open) {
      setCancelModal({ open: false, error: null });
      return true;
    }

    return false;
  }, [
    cancelModal.open,
    cashModal.open,
    editModal.open,
    printerWarning.open,
    unitModal.open,
    weightModal.open
  ]);

  const hasOpenModal =
    cashModal.open ||
    printerWarning.open ||
    unitModal.open ||
    editModal.open ||
    weightModal.open ||
    cancelModal.open;

  useEffect(() => {
    document.body.dataset.posModalOpen = hasOpenModal ? "true" : "false";
    return () => {
      delete document.body.dataset.posModalOpen;
    };
  }, [hasOpenModal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "F1") {
        event.preventDefault();
        if (hasOpenModal) {
          return;
        }
        void startNewSale();
      }

      if (event.key === "F2") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }

      if (event.key === "F3") {
        event.preventDefault();
        openCashModal();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (closeOpenModal()) {
          return;
        }

        if (saleStatus === "open" && saleId) {
          setCancelModal({ open: true, error: null });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeOpenModal,
    hasOpenModal,
    openCashModal,
    saleId,
    saleStatus,
    startNewSale
  ]);

  const persistAddedItem = useCallback(
    async (
      product: Product,
      quantity: number,
      options?: { refocusSearch?: boolean }
    ): Promise<void> => {
      if (saleStatus !== "open") {
        setErrorMessage("Nenhuma venda aberta.");
        return;
      }

      setIsAddingItem(true);
      setErrorMessage(null);

      try {
        let currentSaleId = saleId;
        if (!currentSaleId) {
          const saleResponse = await window.api.saleCreate();
          currentSaleId = saleResponse.saleId;
          uiStoreActions.setSaleId(currentSaleId);
        }

        const { item } = await window.api.saleAddItem({
          saleId: currentSaleId,
          productId: product.id,
          quantity
        });
        const line = createLine(item, product);

        uiStoreActions.upsertSaleLine(line);

        setSearch("");
        if (options?.refocusSearch ?? true) {
          searchInputRef.current?.focus();
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Falha ao adicionar item."
        );
      } finally {
        setIsAddingItem(false);
      }
    },
    [saleId, saleStatus]
  );

  const runScaleRead = useCallback(async (product: Product): Promise<void> => {
    setScaleStatusLabel("Lendo balança...");
    setWeightModal({
      open: true,
      product,
      weight: "",
      loading: true,
      scaleError: null
    });

    try {
      const weight = await window.api.scaleReadStableWeight();
      setScaleConnected(true);
      setScaleStatusLabel("Balança Prix 3 conectada");
      setLastScaleWeightKg(weight);
      setWeightModal({
        open: true,
        product,
        weight: weight.toFixed(3),
        loading: false,
        scaleError: null
      });
    } catch {
      setScaleConnected(false);
      setScaleStatusLabel("Balança Prix 3 desconectada");
      setWeightModal({
        open: true,
        product,
        weight: "",
        loading: false,
        scaleError: "Balança desconectada. Informe o peso manualmente."
      });
    }
  }, []);

  // Seleção de produto pelo rail: kg abre a balança; unitário entra direto com
  // quantidade 1 (o caixa ajusta na linha do carrinho se precisar).
  const pickProduct = useCallback(
    async (
      product: Product,
      options?: { refocusSearch?: boolean }
    ): Promise<void> => {
      if (saleStatus !== "open" || isAddingItem) {
        return;
      }

      if (product.unit_type === "kg") {
        await runScaleRead(product);
        return;
      }

      await persistAddedItem(product, 1, options);
    },
    [isAddingItem, persistAddedItem, runScaleRead, saleStatus]
  );

  // Seleção via card/atalho numérico: NÃO devolve o foco à busca, senão o
  // próximo número digitado cairia no input em vez de acionar outro card.
  const pickByIndex = useCallback(
    (index: number, product: Product): void => {
      setFlashIndex(index);
      window.setTimeout(
        () => setFlashIndex((current) => (current === index ? null : current)),
        220
      );
      void pickProduct(product, { refocusSearch: false });
    },
    [pickProduct]
  );

  // Teclas 1-9 e 0 (0 = décimo card) adicionam direto, fora de inputs/modais.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (hasOpenModal) {
        return;
      }
      const element = document.activeElement;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key >= "0" && event.key <= "9") {
        const index = event.key === "0" ? 9 : Number(event.key) - 1;
        const product = quickCards[index];
        if (product) {
          event.preventDefault();
          pickByIndex(index, product);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasOpenModal, pickByIndex, quickCards]);

  const onSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      const count = pickerResults.length;
      if (event.key === "ArrowDown") {
        if (count > 0) {
          setHighlight((current) => (current + 1) % count);
          event.preventDefault();
        }
      } else if (event.key === "ArrowUp") {
        if (count > 0) {
          setHighlight((current) => (current - 1 + count) % count);
          event.preventDefault();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const product = pickerResults[highlight] ?? pickerResults[0];
        if (product) {
          setHighlight(0);
          void pickProduct(product);
        }
      }
    },
    [highlight, pickProduct, pickerResults]
  );

  const confirmUnitSelection = useCallback(async (): Promise<void> => {
    if (!unitModal.product) {
      return;
    }

    const quantity = Number(unitModal.quantity.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage("Quantidade inválida.");
      return;
    }

    await persistAddedItem(unitModal.product, quantity);
    setUnitModal({ open: false, product: null, quantity: "1" });
  }, [persistAddedItem, unitModal]);

  const confirmWeightSelection = useCallback(async (): Promise<void> => {
    if (!weightModal.product) {
      return;
    }

    const quantity = Number(weightModal.weight.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage("Peso inválido.");
      return;
    }
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(weightModal.weight.trim())) {
      setErrorMessage("Peso deve ter até 3 casas decimais.");
      return;
    }

    await persistAddedItem(weightModal.product, quantity);
    setWeightModal({
      open: false,
      product: null,
      weight: "",
      loading: false,
      scaleError: null
    });
  }, [persistAddedItem, weightModal]);

  const openEditModal = useCallback((line: SaleLine): void => {
    setEditModalError(null);
    setEditModal({
      open: true,
      line,
      quantity: line.quantityValue.toString().replace(".", ",")
    });
  }, []);

  const confirmEditSelection = useCallback(async (): Promise<void> => {
    if (!saleId || !editModal.line || saleStatus !== "open") {
      return;
    }

    const editedProduct = products.find(
      (entry) => entry.id === editModal.line?.productId
    );
    if (!editedProduct) {
      setEditModalError("Produto do item não encontrado.");
      return;
    }

    const quantity = Number(editModal.quantity.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setEditModalError("Quantidade inválida.");
      return;
    }

    if (editedProduct.unit_type === "unit" && !Number.isInteger(quantity)) {
      setEditModalError(
        "Para produtos unitários, informe uma quantidade inteira."
      );
      return;
    }

    setIsUpdatingItem(true);
    setEditModalError(null);
    try {
      const { item } = await window.api.saleUpdateItemQuantity({
        saleId,
        saleItemId: editModal.line.saleItemId,
        quantity
      });

      const product = products.find((entry) => entry.id === item.product_id);
      if (!product) {
        throw new Error("Produto do item não encontrado.");
      }

      const line = createLine(item, product);
      uiStoreActions.upsertSaleLine(line);
      setEditModal({ open: false, line: null, quantity: "" });
      setEditModalError(null);
    } catch (error) {
      setEditModalError(
        error instanceof Error ? error.message : "Falha ao atualizar item."
      );
    } finally {
      setIsUpdatingItem(false);
    }
  }, [editModal, products, saleId, saleStatus]);

  const removeSaleLine = useCallback(
    async (line: SaleLine): Promise<void> => {
      if (!saleId || saleStatus !== "open") {
        return;
      }

      setIsUpdatingItem(true);
      setErrorMessage(null);
      try {
        await window.api.saleRemoveItem({
          saleId,
          saleItemId: line.saleItemId
        });
        uiStoreActions.removeSaleLine(line.saleItemId);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Falha ao remover item."
        );
      } finally {
        setIsUpdatingItem(false);
      }
    },
    [saleId, saleStatus]
  );

  const openCancelModal = useCallback((): void => {
    if (!saleId || saleStatus !== "open") {
      return;
    }

    setCancelModal({ open: true, error: null });
  }, [saleId, saleStatus]);

  const confirmCancelSale = useCallback(async (): Promise<void> => {
    if (!saleId || saleStatus !== "open") {
      return;
    }

    setIsCancellingSale(true);
    setCancelModal((state) => ({ ...state, error: null }));
    setErrorMessage(null);
    try {
      await window.api.saleCancel({ saleId });
      uiStoreActions.setSaleStatus("cancelled");
      uiStoreActions.setSaleLines([]);
      setSearch("");
      setUnitModal({ open: false, product: null, quantity: "1" });
      setWeightModal({
        open: false,
        product: null,
        weight: "",
        loading: false,
        scaleError: null
      });
      setEditModal({ open: false, line: null, quantity: "" });
      setEditModalError(null);
      setCancelModal({ open: false, error: null });
      setCashModal({ open: false, amountReceived: "", error: null });
      setPrinterWarning({ open: false, saleId: null, message: "" });
    } catch (error) {
      setCancelModal({
        open: true,
        error:
          error instanceof Error ? error.message : "Falha ao cancelar venda."
      });
    } finally {
      setIsCancellingSale(false);
    }
  }, [saleId, saleStatus]);

  const retryPrinter = useCallback(async (): Promise<void> => {
    if (!printerWarning.saleId) {
      return;
    }
    setPrinterWarning((state) => ({
      ...state,
      message: "Tentando reimprimir..."
    }));
    try {
      await window.api.reportsReprintReceipt({ saleId: printerWarning.saleId });
      setPrinterWarning({ open: false, saleId: null, message: "" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Falha ao reimprimir comprovante.";
      setPrinterWarning((state) => ({ ...state, message }));
    }
  }, [printerWarning.saleId]);

  const searching = search.trim().length > 0;
  const statusLabel =
    saleStatus === "cancelled"
      ? "Cancelada"
      : saleStatus === "completed"
        ? "Concluída"
        : "Aberta";
  const statusColor =
    saleStatus === "cancelled"
      ? "text-[#ff6f99]"
      : saleStatus === "completed"
        ? "text-[#7dc8ff]"
        : "text-[#7fd1b6]";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111318] text-[#e8e6df]">
      <div className="flex items-center justify-between border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-2">
        <nav className="flex items-center gap-2 text-sm">
          <Link
            to="/"
            className="rounded-md bg-[#22262f] px-3 py-1.5 text-[#e8e6df]"
          >
            Venda{" "}
            <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">
              F1
            </span>
          </Link>
          <Link
            to="/catalog"
            className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]"
          >
            Produtos{" "}
            <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">
              F6
            </span>
          </Link>
          <Link
            to="/reports"
            className="rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]"
          >
            Relatórios{" "}
            <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">
              F7
            </span>
          </Link>
        </nav>
        <span className="text-sm text-[#9d9c99]">{clockLabel}</span>
      </div>

      {errorMessage ? (
        <div className="border-b border-[#3c1e24] bg-[#2b1519] px-4 py-2 text-sm text-[#ff8d8d]">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_3fr]">
        {/* Rail de seleção — 25% */}
        <section className="flex min-h-0 flex-col gap-3 border-r border-[#2a2d35] bg-[#0f131f] p-4">
          <div className="relative flex items-center">
            <input
              ref={searchInputRef}
              value={search}
              disabled={saleStatus !== "open"}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Buscar produto ou código..."
              className="w-full rounded-lg border border-[#1D9E75] bg-[#22262f] px-4 py-3 pr-12 text-base text-[#e8e6df] outline-none placeholder:text-[#8d8c89] focus:border-[#2ad6a2] focus:ring-2 focus:ring-[#2ad6a2]/30 disabled:cursor-not-allowed disabled:border-[#353846] disabled:text-[#6f706c]"
            />
            <span className="pointer-events-none absolute right-3 rounded border border-[#2d3240] bg-[#111522] px-2 py-1 text-xs text-[#8b8d95]">
              F2
            </span>
          </div>

          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8e8b]">
            {searching ? `Resultados (${pickerResults.length})` : "Mais vendidos"}
          </p>

          <ScrollArea className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {quickCards.map((product, index) => {
              const isFlash = flashIndex === index;
              const isHighlighted =
                Boolean(product) && searching && index === highlight;

              if (!product) {
                return (
                  <div
                    key={index}
                    className="mb-2 flex min-h-[56px] items-center gap-3 rounded-lg border border-dashed border-[#242832] px-3 text-[#3a3e49]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-sm font-semibold">
                      {shortcutFor(index)}
                    </span>
                  </div>
                );
              }

              return (
                <button
                  key={index}
                  onClick={() => pickByIndex(index, product)}
                  disabled={saleStatus !== "open"}
                  className={`mb-2 flex min-h-[50px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isFlash
                      ? "scale-[1.02] border-[#2ad6a2] bg-[#1f4638] ring-2 ring-[#2ad6a2]"
                      : isHighlighted
                        ? "border-[#2ad6a2] bg-[#183028] ring-2 ring-[#2ad6a2]"
                        : "border-[#2a2d35] bg-[#22262f] hover:border-[#3a5f52] hover:bg-[#262b36]"
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#101521] text-sm font-semibold text-[#8b8d95]">
                    {shortcutFor(index)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-md font-medium text-[#e8e6df]">
                    {product.name}
                  </span>
                  <span className="shrink-0 text-sm text-[#c2c0b6]">
                    <Money value={product.price_per_unit} />
                    <span className="text-[#7f807c]">
                      /{product.unit_type === "kg" ? "kg" : "un"}
                    </span>
                  </span>
                </button>
              );
            })}
          </ScrollArea>

          <div className="flex items-center justify-between border-t border-[#2a2d35] pt-3 text-xs">
            <span className="flex items-center text-[#7f807c]">
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${scaleConnected ? "bg-[#00b386]" : "bg-[#ff6f99]"}`}
              />
              {scaleStatusLabel}
            </span>
            <span className="font-medium text-[#00b4a1]">
              {lastScaleWeightKg.toFixed(3).replace(".", ",")} kg
            </span>
          </div>
        </section>

        {/* Painel de venda — 75% */}
        <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] bg-[#12161f]">
          <div className="flex items-center justify-between border-b border-[#2a2d35] px-6 py-3">
            <div className="flex items-baseline gap-3">
              <span className="text-sm text-[#c2c0b6]">
                Venda #{saleId ? String(saleId).padStart(4, "0") : "----"}
              </span>
              <span className={`text-xs font-medium ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
            <span className="text-xs text-[#8d8c89]">
              Desconto <span className="text-[#f4ae2f]">− {formatCurrency(0)}</span>
            </span>
          </div>

          <div className="grid grid-cols-[1fr_150px_120px_150px_92px] items-baseline border-b border-[#2a2d35] px-6 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8e8b]">
            <span>Produto</span>
            <span className="text-right">Preço un.</span>
            <span className="text-center">Qtd</span>
            <span className="text-right">Subtotal</span>
            <span />
          </div>

          <ScrollArea className="min-h-0 overflow-y-auto">
            {saleLines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-[#7f807c]">
                  Venda aberta. Selecione um produto para adicionar.
                </p>
                <p className="text-xs text-[#5b5c58]">
                  Use as teclas 1-9 e 0, ou busque com F2.
                </p>
              </div>
            ) : (
              saleLines.map((line) => (
                <div
                  key={line.saleItemId}
                  className="grid grid-cols-[1fr_150px_120px_150px_92px] items-center border-b border-[#1e222c] px-6 py-3 transition-colors hover:bg-[#141924]"
                >
                  <p className="min-w-0 truncate text-[15px] font-medium text-[#e8e6df]">
                    {line.product}
                  </p>
                  <span className="text-right text-sm text-[#c2c0b6]">
                    <Money value={line.unitPrice} />
                    <span className="text-[#7f807c]">
                      /{productUnitById.get(line.productId) === "kg" ? "kg" : "un"}
                    </span>
                  </span>
                  <span className="text-center text-sm tabular-nums text-[#d4d3cf]">
                    {line.quantityLabel}
                  </span>
                  <Money
                    value={line.total}
                    className="text-right text-[15px] text-[#e8e6df]"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openEditModal(line)}
                      disabled={saleStatus !== "open"}
                      className="rounded border border-[#303543] bg-[#202532] px-2 py-1 text-xs text-[#9ca1ab] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      E
                    </button>
                    <button
                      onClick={() => void removeSaleLine(line)}
                      disabled={saleStatus !== "open"}
                      className="rounded border border-[#303543] bg-[#202532] px-2 py-1 text-xs text-[#9ca1ab] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Del
                    </button>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>

          <div className="border-t border-[#2a2d35] bg-[#0f131d]">
            <div className="flex items-end justify-between px-6 py-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8e8b]">
                  Total
                </p>
                <p className="mt-0.5 text-xs text-[#6b6a65]">
                  {saleLines.length}{" "}
                  {saleLines.length === 1 ? "produto" : "produtos"} ·{" "}
                  {unitCount.toLocaleString("pt-BR")}{" "}
                  {unitCount === 1 ? "item" : "itens"}
                </p>
              </div>
              <Money
                value={subtotal}
                className="text-5xl font-medium leading-none text-[#f3f1eb]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5 px-6">
              <button
                onClick={openCashModal}
                disabled={!saleId || saleStatus !== "open"}
                className="flex flex-col items-start rounded-lg bg-[#11ad7d] px-4 py-3.5 text-sm font-semibold text-[#063f2d] transition-colors hover:bg-[#14c48e] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dinheiro
                <span className="mt-0.5 text-xs font-normal opacity-70">F3</span>
              </button>
              <button className="flex flex-col items-start rounded-lg border border-[#EF9F27] bg-[#2d2612] px-4 py-3.5 text-sm font-medium text-[#efab2d] transition-colors hover:bg-[#38301a]">
                PIX
                <span className="mt-0.5 text-xs opacity-70">F4</span>
              </button>
              <button className="flex flex-col items-start rounded-lg border border-[#378ADD] bg-[#0e2337] px-4 py-3.5 text-sm font-medium text-[#66b1ff] transition-colors hover:bg-[#132d45]">
                Cartão (Point)
                <span className="mt-0.5 text-xs opacity-70">F5</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 px-6 py-4">
              <button
                onClick={() => void startNewSale()}
                disabled={isStartingSale || isCurrentSaleEmpty}
                className="rounded-lg bg-[#222834] px-3 py-3 text-sm font-medium text-[#d2d2cf] transition-colors hover:bg-[#2a313f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Nova venda{" "}
                <span className="ml-1 rounded bg-[#101521] px-1.5 py-0.5 text-xs text-[#7f838a]">
                  F1
                </span>
              </button>
              <button
                onClick={openCancelModal}
                disabled={!saleId || saleStatus !== "open" || isCancellingSale}
                className="rounded-lg border border-[#791F1F] bg-[#1f1215] px-3 py-3 text-sm font-medium text-[#ff8d8d] transition-colors hover:bg-[#2a181c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar{" "}
                <span className="ml-1 rounded bg-[#101521] px-1.5 py-0.5 text-xs text-[#7f838a]">
                  Esc
                </span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {cashModal.open ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h2 className="text-lg font-medium">Pagamento em dinheiro</h2>
            <p className="mt-1 text-sm text-[#9ea097]">
              Total da venda: {formatCurrency(subtotal)}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirmCashPayment();
              }}
            >
              <label className="mt-4 block text-sm text-[#9ea097]">
                Valor recebido
              </label>
              <input
                autoFocus
                value={cashModal.amountReceived}
                onChange={(event) =>
                  setCashModal((state) => ({
                    ...state,
                    amountReceived: event.target.value
                  }))
                }
                className="mt-1 w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
              />
              <p
                className={`mt-2 text-sm ${changeAmount < 0 ? "text-[#ff8d8d]" : "text-[#7fd1b6]"}`}
              >
                Troco:{" "}
                {changeAmount >= 0
                  ? formatCurrency(changeAmount)
                  : `-${formatCurrency(Math.abs(changeAmount))}`}
              </p>
              {cashModal.error ? (
                <p className="mt-2 text-sm text-[#ff8d8d]">{cashModal.error}</p>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCashModal({
                      open: false,
                      amountReceived: "",
                      error: null
                    })
                  }
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCashConfirmDisabled}
                  className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Confirmar pagamento
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {unitModal.open && unitModal.product ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h2 className="text-lg font-medium">Quantidade</h2>
            <p className="mt-1 text-sm text-[#9ea097]">
              {unitModal.product.name}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirmUnitSelection();
              }}
            >
              <input
                autoFocus
                value={unitModal.quantity}
                onChange={(event) =>
                  setUnitModal((state) => ({
                    ...state,
                    quantity: event.target.value
                  }))
                }
                className="mt-4 w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setUnitModal({ open: false, product: null, quantity: "1" })
                  }
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isAddingItem}
                  className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editModal.open && editModal.line ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h2 className="text-lg font-medium">Editar quantidade</h2>
            <p className="mt-1 text-sm text-[#9ea097]">
              {editModal.line.product}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirmEditSelection();
              }}
            >
              <input
                autoFocus
                value={editModal.quantity}
                onChange={(event) =>
                  setEditModal((state) => ({
                    ...state,
                    quantity: event.target.value
                  }))
                }
                className="mt-4 w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
              />
              {editModalError ? (
                <p className="mt-2 text-sm text-[#ff8d8d]">{editModalError}</p>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditModal({ open: false, line: null, quantity: "" });
                    setEditModalError(null);
                  }}
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingItem}
                  className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {weightModal.open && weightModal.product ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h2 className="text-lg font-medium">Peso do produto</h2>
            <p className="mt-1 text-sm text-[#9ea097]">
              {weightModal.product.name}
            </p>

            {weightModal.loading ? (
              <p className="mt-4 text-sm text-[#c2c0b6]">
                Lendo peso estável da balança...
              </p>
            ) : null}
            {weightModal.scaleError ? (
              <p className="mt-4 text-sm text-[#ff8d8d]">
                {weightModal.scaleError}
              </p>
            ) : null}

            <label className="mt-4 block text-sm text-[#9ea097]">
              Peso (kg)
            </label>
            <input
              autoFocus
              value={weightModal.weight}
              onChange={(event) =>
                setWeightModal((state) => ({
                  ...state,
                  weight: event.target.value
                }))
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !isAddingItem &&
                  !weightModal.loading
                ) {
                  event.preventDefault();
                  void confirmWeightSelection();
                }
              }}
              className="mt-1 w-full rounded-md border border-[#2a2d35] bg-[#22262f] px-3 py-2 text-sm outline-none focus:border-[#1D9E75]"
            />

            <div className="mt-4 flex justify-between gap-2">
              <button
                onClick={() => {
                  if (weightModal.product) {
                    void runScaleRead(weightModal.product);
                  }
                }}
                className="rounded-md border border-[#378ADD] px-3 py-1.5 text-sm text-[#66b1ff]"
              >
                Re-ler balança
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setWeightModal({
                      open: false,
                      product: null,
                      weight: "",
                      loading: false,
                      scaleError: null
                    })
                  }
                  className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void confirmWeightSelection()}
                  disabled={isAddingItem || weightModal.loading}
                  className="rounded-md bg-[#1D9E75] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal.open ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2d35] bg-[#1a1d24] p-4">
            <h2 className="text-lg font-medium text-[#ff8cad]">
              Cancelar venda
            </h2>
            <p className="mt-2 text-sm text-[#c2c0b6]">
              Tem certeza que deseja cancelar esta venda? Esta ação define o
              status como <strong>cancelled</strong> e não exclui o registro.
            </p>
            {cancelModal.error ? (
              <p className="mt-3 text-sm text-[#ff8d8d]">{cancelModal.error}</p>
            ) : null}
            <form
              className="mt-4 flex justify-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmCancelSale();
              }}
            >
              <button
                type="button"
                onClick={() => setCancelModal({ open: false, error: null })}
                className="rounded-md border border-[#3a3f4d] px-3 py-1.5 text-sm"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={isCancellingSale}
                className="rounded-md border border-[#ff0059] bg-[#2a0714] px-3 py-1.5 text-sm font-medium text-[#ff4f8a] disabled:opacity-60"
              >
                Confirmar cancelamento
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {printerWarning.open ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-panel p-4">
            <h2 className="text-lg font-medium text-warning">
              Impressora offline
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              A venda foi concluída com sucesso, mas o comprovante não foi
              impresso.
            </p>
            {printerWarning.message ? (
              <p className="mt-3 rounded-lg bg-surface p-2 text-sm text-error-text">
                {printerWarning.message}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setPrinterWarning({ open: false, saleId: null, message: "" })
                }
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => void retryPrinter()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white"
              >
                Reimprimir comprovante
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
