import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  Clock,
  Package,
  Settings as SettingsIcon,
  ShoppingCart
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  hotkey?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Venda", icon: ShoppingCart, hotkey: "F1" },
  { to: "/catalog", label: "Produtos", icon: Package, hotkey: "F6" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, hotkey: "F7" },
  { to: "/settings", label: "Configurações", icon: SettingsIcon }
];

function useClockLabel(): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
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
}

/**
 * Barra de navegação compartilhada (extraída do header duplicado das páginas).
 * Aba ativa é derivada da rota atual; o relógio é auto-contido.
 */
export default function NavBar(): JSX.Element {
  const location = useLocation();
  const clockLabel = useClockLabel();

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
      <nav className="flex items-center gap-1 text-sm">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                active
                  ? "bg-surface text-foreground"
                  : "text-secondary-foreground hover:bg-surface hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.label}
              {item.hotkey ? (
                <span className="ml-1 rounded border border-input bg-[#0f131f] px-1.5 py-0.5 text-xs text-muted-foreground">
                  {item.hotkey}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground [font-variant-numeric:tabular-nums]">
        <Clock className="size-3.5" />
        {clockLabel}
      </span>
    </header>
  );
}
