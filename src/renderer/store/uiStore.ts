import { useSyncExternalStore } from "react";
import type { SaleStatus } from "../../shared/types";

export type CatalogStockFilter = "all" | "low" | "out";
export type CatalogCategoryFilter = number | "Todos";

export interface SaleCartLine {
  saleItemId: number;
  productId: number;
  product: string;
  detail: string;
  quantityLabel: string;
  quantityValue: number;
  unitPrice: number;
  total: number;
}

interface UiStoreState {
  saleSession: {
    saleId: number | null;
    saleStatus: SaleStatus;
    saleLines: SaleCartLine[];
  };
  catalogUi: {
    search: string;
    categoryFilter: CatalogCategoryFilter;
    stockFilter: CatalogStockFilter;
  };
}

const initialState: UiStoreState = {
  saleSession: {
    saleId: null,
    saleStatus: "open",
    saleLines: []
  },
  catalogUi: {
    search: "",
    categoryFilter: "Todos",
    stockFilter: "all"
  }
};

let state: UiStoreState = initialState;
const listeners = new Set<() => void>();

function setState(updater: (current: UiStoreState) => UiStoreState): void {
  state = updater(state);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): UiStoreState {
  return state;
}

export function useUiStore<T>(selector: (current: UiStoreState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()), () => selector(initialState));
}

export const uiStoreActions = {
  setCatalogSearch(search: string): void {
    setState((current) => ({
      ...current,
      catalogUi: {
        ...current.catalogUi,
        search
      }
    }));
  },
  setCatalogCategoryFilter(categoryFilter: CatalogCategoryFilter): void {
    setState((current) => ({
      ...current,
      catalogUi: {
        ...current.catalogUi,
        categoryFilter
      }
    }));
  },
  setCatalogStockFilter(stockFilter: CatalogStockFilter): void {
    setState((current) => ({
      ...current,
      catalogUi: {
        ...current.catalogUi,
        stockFilter
      }
    }));
  },
  setSaleSession(next: UiStoreState["saleSession"]): void {
    setState((current) => ({
      ...current,
      saleSession: next
    }));
  },
  setSaleId(saleId: number | null): void {
    setState((current) => ({
      ...current,
      saleSession: {
        ...current.saleSession,
        saleId
      }
    }));
  },
  setSaleStatus(saleStatus: SaleStatus): void {
    setState((current) => ({
      ...current,
      saleSession: {
        ...current.saleSession,
        saleStatus
      }
    }));
  },
  setSaleLines(saleLines: SaleCartLine[]): void {
    setState((current) => ({
      ...current,
      saleSession: {
        ...current.saleSession,
        saleLines
      }
    }));
  },
  upsertSaleLine(line: SaleCartLine): void {
    setState((current) => {
      const index = current.saleSession.saleLines.findIndex((entry) => entry.saleItemId === line.saleItemId);
      if (index === -1) {
        return {
          ...current,
          saleSession: {
            ...current.saleSession,
            saleLines: [...current.saleSession.saleLines, line]
          }
        };
      }

      const updatedLines = [...current.saleSession.saleLines];
      updatedLines[index] = line;
      return {
        ...current,
        saleSession: {
          ...current.saleSession,
          saleLines: updatedLines
        }
      };
    });
  },
  removeSaleLine(saleItemId: number): void {
    setState((current) => ({
      ...current,
      saleSession: {
        ...current.saleSession,
        saleLines: current.saleSession.saleLines.filter((entry) => entry.saleItemId !== saleItemId)
      }
    }));
  },
  removeLastSaleLine(): void {
    setState((current) => ({
      ...current,
      saleSession: {
        ...current.saleSession,
        saleLines: current.saleSession.saleLines.slice(0, -1)
      }
    }));
  }
};
