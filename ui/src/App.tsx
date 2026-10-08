import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { BackgroundLayer } from "@/components/BackgroundLayer";
import { Sidebar } from "@/components/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { ToastHost } from "@/components/ToastHost";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import {
  documentTitleForPath,
  isCommandPaletteKey,
  isHelpKey,
  isRefreshKey,
  pagePathForAltKey,
} from "@/lib/shortcuts";
import { CommandPalette } from "@/components/CommandPalette";
import { useAppStore } from "@/store/app";

const Usage = lazy(() => import("@/pages/Usage").then((m) => ({ default: m.Usage })));
const Trends = lazy(() => import("@/pages/Trends").then((m) => ({ default: m.Trends })));
const Services = lazy(() => import("@/pages/Services").then((m) => ({ default: m.Services })));
const SettingsPage = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })),
);
const PricingPage = lazy(() => import("@/pages/Pricing").then((m) => ({ default: m.PricingPage })));
const PetPage = lazy(() => import("@/pages/Pet").then((m) => ({ default: m.PetPage })));
const ModelMonitor = lazy(() =>
  import("@/pages/ModelMonitor").then((m) => ({ default: m.ModelMonitor })),
);

function PageFallback() {
  return <div className="p-8 text-sm text-muted-foreground">加载中…</div>;
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = documentTitleForPath(pathname);
  }, [pathname]);
}

function MainShell() {
  const loaded = useAppStore((s) => s.loaded);
  const initError = useAppStore((s) => s.initError);
  const init = useAppStore((s) => s.init);
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  useDocumentTitle();
  useEffect(() => {
    if (!loaded && !initError) void init();
  }, [loaded, init, initError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCommandPaletteKey(e)) {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      if (isRefreshKey(e)) {
        e.preventDefault();
        void useAppStore.getState().refreshAll();
        return;
      }
      if (isHelpKey(e)) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      const path = pagePathForAltKey(e);
      if (path) {
        e.preventDefault();
        navigate(path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex h-full">
      <BackgroundLayer />
      <Sidebar />
      <ToastHost />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <main className="relative z-10 flex-1 overflow-auto">
        {initError ? (
          <div className="space-y-3 p-8 text-sm">
            <p className="text-destructive">启动失败：{initError}</p>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
              onClick={() => void init()}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="page-fade">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}

const router = createHashRouter([
  {
    path: "/pet",
    element: (
      <Suspense fallback={null}>
        <PetPage />
      </Suspense>
    ),
  },
  {
    path: "/",
    element: <MainShell />,
    children: [
      { index: true, element: <Dashboard /> },
      {
        path: "usage",
        element: (
          <LazyPage>
            <Usage />
          </LazyPage>
        ),
      },
      {
        path: "trends",
        element: (
          <LazyPage>
            <Trends />
          </LazyPage>
        ),
      },
      {
        path: "model-monitor",
        element: (
          <LazyPage>
            <ModelMonitor />
          </LazyPage>
        ),
      },
      {
        path: "services",
        element: (
          <LazyPage>
            <Services />
          </LazyPage>
        ),
      },
      {
        path: "settings",
        element: (
          <LazyPage>
            <SettingsPage />
          </LazyPage>
        ),
      },
      {
        path: "settings/pricing",
        element: (
          <LazyPage>
            <PricingPage />
          </LazyPage>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
