import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Coins,
  TrendingUp,
  Server,
  Settings as SettingsIcon,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "总览", icon: LayoutDashboard },
  { to: "/usage", label: "用量明细", icon: Coins },
  { to: "/trends", label: "趋势", icon: TrendingUp },
  { to: "/services", label: "管理", icon: Server },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <aside className="relative z-10 flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur-xl">
      <div className="flex items-center gap-2 px-5 py-5">
        <Wallet className="size-5 text-primary" />
        <span className="font-display text-lg tracking-tight">Token Lens</span>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 font-display text-[15px] transition-colors",
                isActive
                  ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/20"
                  : "text-muted-foreground hover:bg-white/40 hover:text-foreground",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 text-xs text-muted-foreground">v0.1.0</div>
    </aside>
  );
}
