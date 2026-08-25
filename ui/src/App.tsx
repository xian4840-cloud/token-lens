import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { BackgroundLayer } from "@/components/BackgroundLayer";
import { Sidebar } from "@/components/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { Usage } from "@/pages/Usage";
import { Trends } from "@/pages/Trends";
import { Services } from "@/pages/Services";
import { SettingsPage } from "@/pages/Settings";
import { PricingPage } from "@/pages/Pricing";

/** 按路由 key 重挂载内容区，触发 page-fade 淡入动画 */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-fade">
      <Routes location={location}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/trends" element={<Trends />} />
        <Route path="/services" element={<Services />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/pricing" element={<PricingPage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="flex h-full">
        <BackgroundLayer />
        <Sidebar />
        <main className="relative z-10 flex-1 overflow-auto">
          <AnimatedRoutes />
        </main>
      </div>
    </HashRouter>
  );
}
