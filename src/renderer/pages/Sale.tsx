import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavBar from "../components/NavBar";
import { toast } from "sonner";
import {
  Banknote,
  CreditCard,
  Pencil,
  Printer,
  QrCode,
  RotateCcw,
  Scale,
  Search,
  Tag,
  Trash2,
  X
} from "lucide-react";
import ScrollArea from "../components/ScrollArea";
import { uiStoreActions, useUiStore } from "../store/uiStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import type {
  DiscountBasis,
  Product,
  SaleItem,
  UnitType
} from "../../shared/types";

interface SaleLine {
  saleItemId: number;
  productId: number;
  product: string;
  detail: string;
  quantityLabel: string;
  quantityValue: number;
  unitPrice: number;
  discountAmount: number;
  discountBasis: DiscountBasis | null;
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

interface DiscountModalState {
  open: boolean;
  line: SaleLine | null;
  basis: DiscountBasis;
  newPrice: string;
  error: string | null;
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
    discountAmount: item.discount_amount,
    discountBasis: item.discount_basis,
    total: item.total
  };
}

// Preço unitário já com o desconto aplicado (usado no display "de → por").
function effectiveUnitPrice(line: SaleLine): number {
  if (line.quantityValue <= 0) {
    return line.unitPrice;
  }
  return line.total / line.quantityValue;
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
  // Pagamentos sem troco (PIX/cartão): apenas registram o meio para relatório.
  const [isProcessingDirectPayment, setIsProcessingDirectPayment] =
    useState(false);
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
  const [discountModal, setDiscountModal] = useState<DiscountModalState>({
    open: false,
    line: null,
    basis: "unit",
    newPrice: "",
    error: null
  });
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
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
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleStatusLabel, setScaleStatusLabel] = useState(
    "Balança Prix 3 desconectada"
  );
  const [lastScaleWeightKg, setLastScaleWeightKg] = useState(0);
  const [printerAvailable, setPrinterAvailable] = useState(false);

  const startingSaleRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Espelha scaleConnected para que runScaleRead (useCallback com deps []) leia
  // sempre o status atual, sem cair em stale closure.
  const scaleConnectedRef = useRef(false);

  useEffect(() => {
    scaleConnectedRef.current = scaleConnected;
  }, [scaleConnected]);

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

  const syncPrinterStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.printerGetStatus();
      setPrinterAvailable(status.available);
    } catch {
      setPrinterAvailable(false);
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
    void syncScaleStatus();
    const timer = window.setInterval(() => {
      void syncScaleStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [syncScaleStatus]);

  useEffect(() => {
    void syncPrinterStatus();
    // Intervalo mais folgado que a balança: o status da impressora muda
    // raramente e o healthcheck de rede abre um socket a cada checagem.
    const timer = window.setInterval(() => {
      void syncPrinterStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [syncPrinterStatus]);

  // Total líquido da venda (já com descontos) — é o valor a pagar.
  const subtotal = useMemo(
    () => saleLines.reduce((acc, line) => acc + line.total, 0),
    [saleLines]
  );
  // Subtotal bruto (aos preços originais) e a soma dos descontos por linha,
  // exibidos na linha "Desconto" do cabeçalho.
  const grossSubtotal = useMemo(
    () =>
      saleLines.reduce(
        (acc, line) => acc + line.quantityValue * line.unitPrice,
        0
      ),
    [saleLines]
  );
  const discountTotal = useMemo(
    () => saleLines.reduce((acc, line) => acc + line.discountAmount, 0),
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
    if (!saleId || saleStatus !== "open" || subtotal <= 0) {
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
      const completeResult = await window.api.saleComplete({ saleId });
      uiStoreActions.setSaleStatus("completed");
      setCashModal({ open: false, amountReceived: "", error: null });
      if (completeResult.printerOffline) {
        toast.warning(
          "Impressora offline: venda concluída, comprovante não impresso."
        );
      }
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

  // PIX e cartão: não têm troco. Registram o meio de pagamento pelo valor total
  // (para o relatório) e finalizam a venda direto, sem modal de valor recebido.
  const confirmDirectPayment = useCallback(
    async (method: "pix" | "card"): Promise<void> => {
      if (
        !saleId ||
        saleStatus !== "open" ||
        isProcessingDirectPayment ||
        isProcessingCashPayment
      ) {
        return;
      }

      if (subtotal <= 0) return;

      setIsProcessingDirectPayment(true);
      setErrorMessage(null);
      try {
        await window.api.paymentCreate({
          sale_id: saleId,
          method,
          amount: subtotal,
          change_amount: 0,
          status: "confirmed"
        });
        const completeResult = await window.api.saleComplete({ saleId });
        uiStoreActions.setSaleStatus("completed");
        if (completeResult.printerOffline) {
          toast.warning(
            "Impressora offline: venda concluída, comprovante não impresso."
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao finalizar pagamento.";
        if (message.startsWith("[PRINTER_OFFLINE]")) {
          uiStoreActions.setSaleStatus("completed");
          setPrinterWarning({
            open: true,
            saleId,
            message: message.replace("[PRINTER_OFFLINE] ", "")
          });
        } else {
          setErrorMessage(message);
        }
      } finally {
        setIsProcessingDirectPayment(false);
      }
    },
    [
      isProcessingCashPayment,
      isProcessingDirectPayment,
      saleId,
      saleStatus,
      subtotal
    ]
  );

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

    if (discountModal.open) {
      setDiscountModal({
        open: false,
        line: null,
        basis: "unit",
        newPrice: "",
        error: null
      });
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
    discountModal.open,
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
    discountModal.open ||
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
        if(hasOpenModal) return;
        searchInputRef.current?.focus();
      }

      if (event.key === "F3") {
        event.preventDefault();
        if(hasOpenModal) return;
        openCashModal();
      }

      if (event.key === "F4") {
        event.preventDefault();
        if(hasOpenModal) return;
        void confirmDirectPayment("pix");
      }

      if (event.key === "F5") {
        event.preventDefault();
        if(hasOpenModal) return;
        void confirmDirectPayment("card");
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (closeOpenModal()) {
          return;
        }

        if (saleStatus === "open" && saleId && !hasOpenModal) {
          setCancelModal({ open: true, error: null });
        }
      }

      if (event.key === "Delete") {
        event.preventDefault();
        if(hasOpenModal) return;
        removeLastSaleLine()
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeOpenModal,
    confirmDirectPayment,
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

  const runScaleRead = useCallback(
    async (
      product: Product,
      options?: { refocusSearch?: boolean }
    ): Promise<void> => {
      // Sem balança conectada: vai direto para a entrada manual no modal.
      if (!scaleConnectedRef.current) {
        setScaleStatusLabel("Balança Prix 3 desconectada");
        setWeightModal({
          open: true,
          product,
          weight: "",
          loading: false,
          scaleError: "Balança desconectada. Informe o peso manualmente."
        });
        return;
      }

      setScaleStatusLabel("Lendo balança…");
      try {
        const weight = await window.api.scaleReadStableWeight();
        setScaleConnected(true);
        setScaleStatusLabel("Balança Prix 3 conectada");
        setLastScaleWeightKg(weight);

        // Peso válido lido da balança: adiciona o item direto, sem modal.
        if (Number.isFinite(weight) && weight > 0) {
          setWeightModal({
            open: false,
            product: null,
            weight: "",
            loading: false,
            scaleError: null
          });
          await persistAddedItem(product, weight, options);
          return;
        }

        // Peso lido inválido (zero/negativo): abre o modal para ajuste manual.
        setWeightModal({
          open: true,
          product,
          weight: "",
          loading: false,
          scaleError: "Peso inválido na balança. Informe o peso manualmente."
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
    },
    [persistAddedItem]
  );

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
        await runScaleRead(product, options);
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
      setWeightModal(prev => ({
        ...prev,
        scaleError: "Peso inválido."
      }));
      return;
    }
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(weightModal.weight.trim())) {
      setWeightModal(prev => ({
        ...prev,
        scaleError: "Peso deve ter até 3 casas decimais."
      }));
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

  const openDiscountModal = useCallback((line: SaleLine): void => {
    // Pré-preenche com o desconto atual (se houver), senão com o preço cheio.
    const basis: DiscountBasis = line.discountBasis ?? "unit";
    const currentPrice =
      line.discountBasis === "total"
        ? line.total
        : line.discountBasis === "unit"
          ? effectiveUnitPrice(line)
          : line.unitPrice;
    setDiscountModal({
      open: true,
      line,
      basis,
      newPrice: currentPrice.toFixed(2).replace(".", ","),
      error: null
    });
  }, []);

  const persistDiscount = useCallback(
    async (
      line: SaleLine,
      basis: DiscountBasis | "none",
      newPrice?: number
    ): Promise<void> => {
      if (!saleId || saleStatus !== "open") {
        return;
      }

      setIsSavingDiscount(true);
      try {
        const { item } = await window.api.saleSetItemDiscount({
          saleId,
          saleItemId: line.saleItemId,
          basis,
          newPrice
        });
        const product = products.find((entry) => entry.id === item.product_id);
        if (!product) {
          throw new Error("Produto do item não encontrado.");
        }
        uiStoreActions.upsertSaleLine(createLine(item, product));
        setDiscountModal({
          open: false,
          line: null,
          basis: "unit",
          newPrice: "",
          error: null
        });
      } catch (error) {
        setDiscountModal((state) => ({
          ...state,
          error:
            error instanceof Error
              ? error.message
              : "Falha ao aplicar desconto."
        }));
      } finally {
        setIsSavingDiscount(false);
      }
    },
    [products, saleId, saleStatus]
  );

  const confirmDiscount = useCallback((): void => {
    if (!discountModal.line) {
      return;
    }
    const newPrice = Number(discountModal.newPrice.replace(",", "."));
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      setDiscountModal((state) => ({
        ...state,
        error: "Novo preço inválido."
      }));
      return;
    }
    void persistDiscount(discountModal.line, discountModal.basis, newPrice);
  }, [discountModal.basis, discountModal.line, discountModal.newPrice, persistDiscount]);

  const removeDiscount = useCallback((): void => {
    if (!discountModal.line) {
      return;
    }
    void persistDiscount(discountModal.line, "none");
  }, [discountModal.line, persistDiscount]);

  // Oferece "Desfazer" após remover: re-adiciona o produto com a mesma
  // quantidade (gera um novo item de venda, mas restaura o carrinho).
  const offerUndoRemoval = useCallback(
    (line: SaleLine): void => {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product) {
        return;
      }
      toast("Item removido", {
        description: line.product,
        action: {
          label: "Desfazer",
          onClick: () => {
            void persistAddedItem(product, line.quantityValue, {
              refocusSearch: false
            });
          }
        }
      });
    },
    [persistAddedItem, products]
  );

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
        offerUndoRemoval(line);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Falha ao remover item."
        );
      } finally {
        setIsUpdatingItem(false);
      }
    },
    [offerUndoRemoval, saleId, saleStatus]
  );

  const removeLastSaleLine = useCallback(
    async (): Promise<void> => {
      if (!saleId || saleStatus !== "open") {
        return;
      }

      const lastLine = saleLines[saleLines.length - 1] ?? null;

      setIsUpdatingItem(true);
      setErrorMessage(null);
      try {
        await window.api.saleRemoveLastItem({
          saleId,
        });
        uiStoreActions.removeLastSaleLine();
        if (lastLine) {
          offerUndoRemoval(lastLine);
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Falha ao remover item."
        );
      } finally {
        setIsUpdatingItem(false);
      }
    },
    [offerUndoRemoval, saleId, saleLines, saleStatus]
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
      message: "Tentando reimprimir…"
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
  // Peso para o visor LCD. Mantém o ponto decimal (a fonte DSEG7 não tem
  // vírgula, e o "." é o pontinho de sete segmentos autêntico do visor). A
  // "sombra" repete a string com todo dígito virando 8 — os segmentos apagados
  // desenhados atrás, como num LCD real.
  const scaleWeightText = lastScaleWeightKg.toFixed(3);
  const scaleWeightGhost = scaleWeightText.replace(/\d/g, "8");
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

  // Preview do modal de desconto (recalculado a cada render enquanto aberto).
  const discountLine = discountModal.line;
  const discountUnitLabel =
    discountLine && productUnitById.get(discountLine.productId) === "kg"
      ? "kg"
      : "un";
  const discountGross = discountLine
    ? discountLine.quantityValue * discountLine.unitPrice
    : 0;
  const discountNewPriceValue = Number(
    discountModal.newPrice.replace(",", ".")
  );
  const discountPreviewNewTotal =
    discountModal.basis === "unit"
      ? (discountLine?.quantityValue ?? 0) * discountNewPriceValue
      : discountNewPriceValue;
  const discountPreviewAmount = discountGross - discountPreviewNewTotal;
  const discountPreviewValid =
    Number.isFinite(discountNewPriceValue) &&
    discountNewPriceValue > 0 &&
    discountPreviewAmount > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111318] text-[#e8e6df]">
      <NavBar />

      {errorMessage ? (
        <div className="border-b border-[#3c1e24] bg-[#2b1519] px-4 py-2 text-sm text-[#ff8d8d]">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_3fr]">
        {/* Rail de seleção — 25% */}
        <section className="flex min-h-0 flex-col gap-3 border-r border-[#2a2d35] bg-[#0f131f] p-4">
          {/* Visor LCD do peso da balança — o dado que o caixa mais consulta
              ao pesar, por isso ganha destaque no topo do rail. */}
          <div className="rounded-md border border-[#0d1d16] bg-[#04100b] px-4 py-4 shadow-[inset_0_2px_10px_rgba(0,0,0,0.8)]">
            <div className="flex items-baseline justify-end gap-2 overflow-hidden">
              <span
                className="lcd-display text-[52px] leading-none text-[#2fffb0]"
                data-ghost={scaleWeightGhost}
              >
                {scaleWeightText}
              </span>
              <span className="text-lg font-medium text-[#2f8c6a]">kg</span>
            </div>
          </div>

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              disabled={saleStatus !== "open"}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Buscar produto ou código…"
              className="h-12 border-primary pl-10 pr-12 text-base"
            />
            <span className="pointer-events-none absolute right-3 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              F2
            </span>
          </div>

          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
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
                  className={`mb-2 flex min-h-[50px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-[transform,background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
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

          <div className="flex items-center gap-4 border-t border-[#2a2d35] pt-3 text-xs">
            <span className="flex items-center text-[#7f807c]">
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${scaleConnected ? "bg-[#00b386]" : "bg-[#ff6f99]"}`}
              />
              {scaleStatusLabel}
            </span>
            <span className="flex items-center text-[#7f807c]">
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${printerAvailable ? "bg-[#00b386]" : "bg-[#ff6f99]"}`}
              />
              {printerAvailable
                ? "Impressora conectada"
                : "Impressora desconectada"}
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
            <span className="flex items-baseline gap-3 text-xs text-[#8d8c89]">
              {discountTotal > 0 ? (
                <span>
                  Subtotal{" "}
                  <span className="text-[#c2c0b6]">
                    {formatCurrency(grossSubtotal)}
                  </span>
                </span>
              ) : null}
              <span>
                Desconto{" "}
                <span
                  className={
                    discountTotal > 0 ? "text-[#f4ae2f]" : "text-[#5b5c58]"
                  }
                >
                  − {formatCurrency(discountTotal)}
                </span>
              </span>
            </span>
          </div>

          <div className="grid grid-cols-[1fr_150px_110px_150px_128px] items-baseline border-b border-[#2a2d35] px-6 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8e8b]">
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
                  className="grid grid-cols-[1fr_150px_110px_150px_128px] items-center border-b border-[#1e222c] px-6 py-3 transition-colors hover:bg-[#141924]"
                >
                  <p className="min-w-0 truncate text-[15px] font-medium text-[#e8e6df]">
                    {line.product}
                  </p>
                  <span className="text-right text-sm text-[#c2c0b6]">
                    {line.discountBasis === "unit" ? (
                      <Money
                        value={line.unitPrice}
                        className="mr-1 text-xs text-[#7f807c] line-through"
                      />
                    ) : null}
                    <Money
                      value={
                        line.discountBasis === "unit"
                          ? effectiveUnitPrice(line)
                          : line.unitPrice
                      }
                      className={
                        line.discountBasis === "unit" ? "text-[#f4ae2f]" : ""
                      }
                    />
                    <span className="text-[#7f807c]">
                      /{productUnitById.get(line.productId) === "kg" ? "kg" : "un"}
                    </span>
                  </span>
                  <span className="text-center text-sm tabular-nums text-[#d4d3cf]">
                    {line.quantityLabel}
                  </span>
                  <span className="text-right text-[15px] text-[#e8e6df]">
                    {line.discountBasis === "total" ? (
                      <Money
                        value={line.quantityValue * line.unitPrice}
                        className="mr-1 text-xs text-[#7f807c] line-through"
                      />
                    ) : null}
                    <Money
                      value={line.total}
                      className={
                        line.discountBasis === "total" ? "text-[#f4ae2f]" : ""
                      }
                    />
                  </span>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Desconto em ${line.product}`}
                      onClick={() => openDiscountModal(line)}
                      disabled={saleStatus !== "open"}
                      className={`size-8 ${
                        line.discountBasis
                          ? "border-[#f4ae2f]/50 text-[#f4ae2f] hover:text-[#f4ae2f]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Tag className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Editar quantidade de ${line.product}`}
                      onClick={() => openEditModal(line)}
                      disabled={saleStatus !== "open"}
                      className="size-8 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Remover ${line.product}`}
                      onClick={() => void removeSaleLine(line)}
                      disabled={saleStatus !== "open"}
                      className="size-8 text-muted-foreground hover:border-danger-dark hover:text-error-text"
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
                disabled={
                  !saleId ||
                  saleStatus !== "open" ||
                  subtotal <= 0 ||
                  isProcessingCashPayment ||
                  isProcessingDirectPayment
                }
                className="flex flex-col items-start rounded-lg bg-[#11ad7d] px-4 py-3.5 text-sm font-semibold text-[#063f2d] transition-colors hover:bg-[#14c48e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <Banknote className="size-4" />
                  Dinheiro
                </span>
                <span className="mt-0.5 text-xs font-normal opacity-70">F3</span>
              </button>
              <button
                type="button"
                onClick={() => void confirmDirectPayment("pix")}
                disabled={
                  !saleId ||
                  saleStatus !== "open" ||
                  subtotal <= 0 ||
                  isProcessingCashPayment ||
                  isProcessingDirectPayment
                }
                aria-label="Pagar com PIX"
                className="flex flex-col items-start rounded-lg bg-[#f4ae2f] px-4 py-3.5 text-sm font-semibold text-[#3a2c05] transition-colors hover:bg-[#ffbe4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <QrCode className="size-4" />
                  PIX
                </span>
                <span className="mt-0.5 text-xs opacity-70">
                  F4
                </span>
              </button>
              <button
                type="button"
                onClick={() => void confirmDirectPayment("card")}
                disabled={
                  !saleId ||
                  saleStatus !== "open" ||
                  subtotal <= 0 ||
                  isProcessingCashPayment ||
                  isProcessingDirectPayment
                }
                aria-label="Pagar com cartão"
                className="flex flex-col items-start rounded-lg bg-[#2f81f7] px-4 py-3.5 text-sm font-semibold text-[#04122b] transition-colors hover:bg-[#4f9bff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="size-4" />
                  Cartão
                </span>
                <span className="mt-0.5 text-xs font-normal opacity-70">
                  F5
                </span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 px-6 py-4">
              <Button
                variant="secondary"
                onClick={() => void startNewSale()}
                disabled={isStartingSale || isCurrentSaleEmpty}
                className="h-auto py-3"
              >
                <RotateCcw className="size-4" />
                Nova venda
                <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                  F1
                </span>
              </Button>
              <Button
                variant="destructive"
                onClick={openCancelModal}
                disabled={!saleId || saleStatus !== "open" || isCancellingSale}
                className="h-auto py-3"
              >
                <X className="size-4" />
                Cancelar
                <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                  Esc
                </span>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={cashModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setCashModal({ open: false, amountReceived: "", error: null });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="size-5 text-primary" />
              Pagamento em dinheiro
            </DialogTitle>
            <DialogDescription>
              Total da venda:{" "}
              <Money value={subtotal} className="text-foreground" />
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmCashPayment();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cash-amount">Valor recebido</Label>
              <Input
                id="cash-amount"
                autoFocus
                inputMode="decimal"
                value={cashModal.amountReceived}
                onChange={(event) =>
                  setCashModal((state) => ({
                    ...state,
                    amountReceived: event.target.value
                  }))
                }
                className="font-serif text-lg [font-variant-numeric:tabular-nums]"
              />
            </div>
            <p
              className={`text-sm ${changeAmount < 0 ? "text-error-text" : "text-success-text"}`}
            >
              Troco:{" "}
              <span className="font-serif [font-variant-numeric:tabular-nums]">
                {changeAmount >= 0
                  ? formatCurrency(changeAmount)
                  : `-${formatCurrency(Math.abs(changeAmount))}`}
              </span>
            </p>
            {cashModal.error ? (
              <p role="alert" className="text-sm text-error-text">
                {cashModal.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setCashModal({
                    open: false,
                    amountReceived: "",
                    error: null
                  })
                }
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isCashConfirmDisabled}>
                Confirmar pagamento
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unitModal.open && unitModal.product !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUnitModal({ open: false, product: null, quantity: "1" });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quantidade</DialogTitle>
            <DialogDescription>{unitModal.product?.name}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmUnitSelection();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-quantity">Quantidade (un)</Label>
              <Input
                id="unit-quantity"
                autoFocus
                inputMode="numeric"
                value={unitModal.quantity}
                onChange={(event) =>
                  setUnitModal((state) => ({
                    ...state,
                    quantity: event.target.value
                  }))
                }
                className="font-serif text-lg [font-variant-numeric:tabular-nums]"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setUnitModal({ open: false, product: null, quantity: "1" })
                }
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isAddingItem}>
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editModal.open && editModal.line !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditModal({ open: false, line: null, quantity: "" });
            setEditModalError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar quantidade</DialogTitle>
            <DialogDescription>{editModal.line?.product}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmEditSelection();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-quantity">Nova quantidade</Label>
              <Input
                id="edit-quantity"
                autoFocus
                inputMode="decimal"
                value={editModal.quantity}
                onChange={(event) =>
                  setEditModal((state) => ({
                    ...state,
                    quantity: event.target.value
                  }))
                }
                className="font-serif text-lg [font-variant-numeric:tabular-nums]"
              />
            </div>
            {editModalError ? (
              <p role="alert" className="text-sm text-error-text">
                {editModalError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditModal({ open: false, line: null, quantity: "" });
                  setEditModalError(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isUpdatingItem}>
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={discountModal.open && discountModal.line !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDiscountModal({
              open: false,
              line: null,
              basis: "unit",
              newPrice: "",
              error: null
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="size-5 text-[#f4ae2f]" />
              Desconto
            </DialogTitle>
            <DialogDescription>{discountModal.line?.product}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              confirmDiscount();
            }}
          >
            <div className="flex gap-2">
              <Button
                type="button"
                variant={discountModal.basis === "unit" ? "default" : "outline"}
                onClick={() =>
                  setDiscountModal((state) => ({
                    ...state,
                    basis: "unit",
                    error: null
                  }))
                }
                className="flex-1"
              >
                Preço unitário
              </Button>
              <Button
                type="button"
                variant={
                  discountModal.basis === "total" ? "default" : "outline"
                }
                onClick={() =>
                  setDiscountModal((state) => ({
                    ...state,
                    basis: "total",
                    error: null
                  }))
                }
                className="flex-1"
              >
                Total da linha
              </Button>
            </div>

            <p className="text-sm text-text-secondary">
              {discountModal.basis === "unit" ? (
                <>
                  Preço atual:{" "}
                  <Money
                    value={discountModal.line?.unitPrice ?? 0}
                    className="text-foreground"
                  />
                  /{discountUnitLabel}
                </>
              ) : (
                <>
                  Total atual:{" "}
                  <Money value={discountGross} className="text-foreground" />
                </>
              )}
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="discount-price">
                {discountModal.basis === "unit"
                  ? `Novo preço (${discountUnitLabel})`
                  : "Novo total da linha"}
              </Label>
              <Input
                id="discount-price"
                autoFocus
                inputMode="decimal"
                value={discountModal.newPrice}
                onChange={(event) =>
                  setDiscountModal((state) => ({
                    ...state,
                    newPrice: event.target.value,
                    error: null
                  }))
                }
                className="font-serif text-lg [font-variant-numeric:tabular-nums]"
              />
            </div>

            {discountPreviewValid ? (
              <p className="text-sm text-[#f4ae2f]">
                Desconto:{" "}
                <span className="font-serif [font-variant-numeric:tabular-nums]">
                  −{formatCurrency(discountPreviewAmount)}
                </span>{" "}
                · Novo total:{" "}
                <span className="font-serif [font-variant-numeric:tabular-nums]">
                  {formatCurrency(discountPreviewNewTotal)}
                </span>
              </p>
            ) : null}

            {discountModal.error ? (
              <p role="alert" className="text-sm text-error-text">
                {discountModal.error}
              </p>
            ) : null}

            <DialogFooter className="justify-between">
              {discountModal.line?.discountBasis ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={removeDiscount}
                  disabled={isSavingDiscount}
                  className="text-error-text hover:text-error-text"
                >
                  Remover desconto
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDiscountModal({
                      open: false,
                      line: null,
                      basis: "unit",
                      newPrice: "",
                      error: null
                    })
                  }
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSavingDiscount || !discountPreviewValid}
                >
                  Aplicar desconto
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={weightModal.open && weightModal.product !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWeightModal({
              open: false,
              product: null,
              weight: "",
              loading: false,
              scaleError: null
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="size-5 text-primary" />
              Peso do produto
            </DialogTitle>
            <DialogDescription>{weightModal.product?.name}</DialogDescription>
          </DialogHeader>

          {weightModal.loading ? (
            <p className="text-sm text-text-secondary">
              Lendo peso estável da balança…
            </p>
          ) : null}
          {weightModal.scaleError ? (
            <p role="alert" className="text-sm text-error-text">
              {weightModal.scaleError}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weight-value">Peso (kg)</Label>
            <Input
              id="weight-value"
              autoFocus
              inputMode="decimal"
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
              className="font-serif text-lg [font-variant-numeric:tabular-nums]"
            />
          </div>

          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (weightModal.product) {
                  void runScaleRead(weightModal.product);
                }
              }}
              className="text-info"
            >
              <RotateCcw className="size-4" />
              Re-ler balança
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setWeightModal({
                    open: false,
                    product: null,
                    weight: "",
                    loading: false,
                    scaleError: null
                  })
                }
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void confirmWeightSelection()}
                disabled={isAddingItem || weightModal.loading}
              >
                Confirmar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cancelModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setCancelModal({ open: false, error: null });
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-cancelled-text">
              Cancelar venda
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar esta venda? A venda é marcada como
              cancelada e o registro é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelModal.error ? (
            <p role="alert" className="text-sm text-error-text">
              {cancelModal.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancellingSale}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isCancellingSale}
              onClick={(event) => {
                event.preventDefault();
                void confirmCancelSale();
              }}
              className="border border-danger-dark bg-[#1f1215] text-error-text hover:bg-[#2a181c]"
            >
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={printerWarning.open}
        onOpenChange={(open) => {
          if (!open) {
            setPrinterWarning({ open: false, saleId: null, message: "" });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <Printer className="size-5" />
              Impressora offline
            </DialogTitle>
            <DialogDescription>
              A venda foi concluída com sucesso, mas o comprovante não foi
              impresso.
            </DialogDescription>
          </DialogHeader>
          {printerWarning.message ? (
            <p className="rounded-lg bg-surface p-2 text-sm text-error-text">
              {printerWarning.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPrinterWarning({ open: false, saleId: null, message: "" })
              }
            >
              Fechar
            </Button>
            <Button type="button" onClick={() => void retryPrinter()}>
              <Printer className="size-4" />
              Reimprimir comprovante
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
