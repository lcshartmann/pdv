import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

interface NavItem {
  to: string;
  label: string;
  hotkey?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Venda", hotkey: "F1" },
  { to: "/catalog", label: "Produtos", hotkey: "F6" },
  { to: "/reports", label: "Relatórios", hotkey: "F7" },
  { to: "/settings", label: "Configurações" }
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
    <div className="flex items-center justify-between border-b border-[#2a2d35] bg-[#1a1d24] px-4 py-2">
      <nav className="flex items-center gap-2 text-sm">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={
                active
                  ? "rounded-md bg-[#22262f] px-3 py-1.5 text-[#e8e6df]"
                  : "rounded-md px-3 py-1.5 text-[#c2c0b6] hover:bg-[#22262f] hover:text-[#e8e6df]"
              }
            >
              {item.label}
              {item.hotkey ? (
                <span className="ml-2 rounded border border-[#343945] bg-[#0f131f] px-1.5 py-0.5 text-xs">
                  {item.hotkey}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <span className="text-sm text-[#9d9c99]">{clockLabel}</span>
    </div>
  );
}
