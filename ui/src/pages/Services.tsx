import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Server } from "lucide-react";
import { useAppStore } from "@/store/app";
import { ServiceFormDialog } from "@/components/ServiceFormDialog";
import type { ServiceRecord } from "@/types";

export function Services() {
  const services = useAppStore((s) => s.services);
  const definitions = useAppStore((s) => s.definitions);
  const loaded = useAppStore((s) => s.loaded);
  const init = useAppStore((s) => s.init);
  const deleteService = useAppStore((s) => s.deleteService);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);

  useEffect(() => {
    if (!loaded) init();
  }, [loaded, init]);

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
        {services.length === 0 ? (
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
        ) : (
          services.map((s) => {
            const def = definitions.find((d) => d.provider === s.provider);
            return (
              <Card key={s.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_40px_rgba(90,75,50,0.14)]">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      <Badge variant={s.kind === "api" ? "default" : "secondary"}>
                        {def?.label ?? s.provider}
                      </Badge>
                      {def && !def.official && <Badge variant="warning">非官方</Badge>}
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
                      size="icon"
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(`删除「${s.name}」？`)) deleteService(s.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      <ServiceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
    </div>
  );
}
