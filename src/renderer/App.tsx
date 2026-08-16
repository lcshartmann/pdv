import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import CatalogPage from "./pages/Catalog";
import ReportsPage from "./pages/Reports";
import SalePage from "./pages/Sale";
import SettingsPage from "./pages/Settings";

function KeyboardPageNavigation(): null {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const hasOpenModal = document.body.dataset.posModalOpen === "true";
      if (hasOpenModal && (event.key === "F1" || event.key === "F6" || event.key === "F7")) {
        event.preventDefault();
        return;
      }

      if (event.key === "F1" && location.pathname !== "/") {
        event.preventDefault();
        navigate("/");
      }

      if (event.key === "F6") {
        event.preventDefault();
        navigate("/catalog");
      }

      if (event.key === "F7") {
        event.preventDefault();
        navigate("/reports");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [location.pathname, navigate]);

  return null;
}

export default function App(): JSX.Element {
  return (
    <HashRouter>
      <div className="h-screen overflow-hidden bg-[#111318] text-[#e8e6df]">
        <KeyboardPageNavigation />
        <Routes>
          <Route path="/" element={<SalePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <Toaster theme="dark" position="top-right" richColors closeButton />
      </div>
    </HashRouter>
  );
}
