import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Server } from "lucide-react";
import { useAppStore } from "@/store/app";
import { ServiceFormDialog } from "@/components/ServiceFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { showToast } from "@/lib/toast";
import { applySearchEscape } from "@/lib/search-escape";
import type { ServiceRecord } from "@/types";

export function Services() {
  const services = useAppStore((s) => s.services);
  const definitions = useAppStore((s) => s.definitions);
  const loaded = useAppStore((s) => s.loaded);
  const deleteService = useAppStore((s) => s.deleteService);
  const hiddenIds = useAppStore((s) => s.hiddenIds);
  const toggleHidden = useAppStore((s) => s.toggleHidden);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [deleting, setDeleting] = useState<ServiceRecord | null>(null);
  const [query, setQuery] = useState("");
  const [onlyHidden, setOnlyHidden] = useState(false);

  const hiddenCount = useMemo(
    () => services.filter((s) => hiddenIds.includes(s.id)).length,
    [services, hiddenIds],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = services.filter((s) => {
      if (onlyHidden && hiddenCount > 0 && !hiddenIds.includes(s.id)) return false;
      if (!q) return true;
      const label = definitions.find((d) => d.provider === s.provider)?.label ?? s.provider;
      return (
        s.name.toLowerCase().includes(q) ||
        s.provider.toLowerCase().includes(q) ||
        label.toLowerCase().includes(q)
      );
    });
    if (hiddenCount === 0) return matched;
    return [...matched].sort((a, b) => {
      const ah = hiddenIds.includes(a.id);
      const bh = hiddenIds.includes(b.id);
      if (ah === bh) return 0;
      return ah ? -1 : 1;
    });
  }, [services, definitions, query, hiddenIds, onlyHidden, hiddenCount]);

  return (
    <div>
      <PageHeader title="管理" description="管理 API key 与订阅账号">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          添加服务
        </Button>
      </PageHeader>
      <div className="space-y-3 px-8 pb-8">
        {loaded && services.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称或服务类型"
              onKeyDown={(e) => applySearchEscape(e, query, () => setQuery(""))}
              aria-label="搜索服务"
              className="max-w-sm"
            />
            {hiddenCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant={onlyHidden ? "secondary" : "outline"}
                onClick={() => setOnlyHidden((v) => !v)}
              >
                总览已隐藏（{hiddenCount}）
              </Button>
            ) : null}
          </div>
        ) : null}
        {!loaded ? (
          <Card className="py-16 text-center text-sm text-muted-foreground">加载中…</Card>
        ) : services.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-white/30 py-16 text-center">
            <Server className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还未添加任何服务</p>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus />
              添加第一个服务
            </Button>
          </Card>
        ) : visible.length === 0 ? (
          <Card className="py-10 text-center text-sm text-muted-foreground">
            {query.trim()
              ? `没有匹配「${query.trim()}」的服务`
              : onlyHidden
                ? "没有从总览隐藏的服务"
                : "没有可显示的服务"}
          </Card>
        ) : (
          visible.map((s) => {
            const def = definitions.find((d) => d.provider === s.provider);
            return (
              <Card
                key={s.id}
                className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_40px_rgba(90,75,50,0.14)]"
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      <Badge variant={s.kind === "api" ? "default" : "secondary"}>
                        {def?.label ?? s.provider}
                      </Badge>
                      {def && !def.official && <Badge variant="warning">非官方</Badge>}
                      {s.needsCredentials && <Badge variant="warning">需重新填写密钥</Badge>}
                      {hiddenIds.includes(s.id) && <Badge variant="outline">总览已隐藏</Badge>}
                    </div>
                    {def?.description && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {def.description}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => void toggleHidden(s.id)}
                    >
                      {hiddenIds.includes(s.id) ? "在总览显示" : "从总览隐藏"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`编辑「${s.name}」`}
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:text-destructive"
                      aria-label={`删除「${s.name}」`}
                      onClick={() => setDeleting(s)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      <ServiceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `删除「${deleting.name}」？` : "删除服务"}
        description="密钥和这张卡的余额记录会一起删掉，用量历史仍留在本机。"
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          if (!deleting) return;
          const name = deleting.name;
          void deleteService(deleting.id).then(
            () => showToast(`已删除「${name}」`),
            (e: unknown) => showToast(e instanceof Error ? e.message : "删除失败", "err"),
          );
          setDeleting(null);
        }}
      />
    </div>
  );
}
