import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogIn } from "lucide-react";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { nextServiceName } from "@/lib/service-name";
import type { ServiceInput, ServiceRecord } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ServiceRecord | null;
}

export function ServiceFormDialog({ open, onOpenChange, editing }: Props) {
  const { definitions, createService, updateService } = useAppStore();
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [logining, setLogining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setProvider(editing.provider);
      setName(editing.name);
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(editing.config)) f[k] = String(v ?? "");
      setFields(f);
    } else {
      // 名称预填为服务类型名，而不是留空：空白框逼着用户自己想名字，
      // 是名称与实际服务不符的源头之一
      const first = definitions[0];
      setProvider(first?.provider ?? "");
      setName(first?.label ?? "");
      setFields({});
    }
    setError("");
  }, [open, editing, definitions]);

  const def = definitions.find((d) => d.provider === provider);

  /**
   * 切换服务类型时同步名称，规则见 lib/service-name。
   * 防的是「标题写百炼、实际查超算互联网」这类名实不符。
   */
  const handleProviderChange = (next: string): void => {
    setProvider(next);
    setFields({});
    setName((current) => nextServiceName(current, next, definitions));
  };

  const handleLogin = async () => {
    setLogining(true);
    setError("");
    try {
      if (provider === "scnet_token_plan") {
        const cred = await ipc.loginScnet();
        if (cred) {
          setFields((s) => ({ ...s, cookie: cred.cookie }));
        }
      } else if (provider === "volcengine_plan") {
        const cred = await ipc.loginVolcengine();
        if (cred) {
          setFields((s) => ({ ...s, cookie: cred.cookie, xWebId: cred.xWebId }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogining(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!provider) return setError("请选择服务类型");
    if (!name.trim()) return setError("请填写名称");
    for (const f of def?.configSchema ?? []) {
      if (f.required && !fields[f.key]?.trim()) return setError(`请填写 ${f.label}`);
    }
    setSaving(true);
    try {
      const input: ServiceInput = { name: name.trim(), provider, fields };
      if (editing) await updateService(editing.id, input);
      else await createService(input);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑服务" : "添加服务"}</DialogTitle>
          <DialogDescription>
            {def?.description ?? "选择服务类型并填写凭证"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>服务类型</Label>
            <Select
              value={provider}
              onValueChange={handleProviderChange}
              disabled={!!editing}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择服务类型" />
              </SelectTrigger>
              <SelectContent>
                {definitions.map((d) => (
                  <SelectItem key={d.provider} value={d.provider}>
                    {d.label}
                    {!d.official ? "（非官方）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="自定义名称，如&ldquo;工作号&rdquo;"
            />
          </div>
          {(provider === "volcengine_plan" || provider === "scnet_token_plan") && (
            <div className="space-y-2 rounded-lg border border-dashed bg-white/30 p-3">
              <p className="text-xs text-muted-foreground">
                {provider === "scnet_token_plan"
                  ? "免去手动抓 cookie：点「登录获取凭证」在弹窗中登录超算互联网，登录成功后 Cookie 会自动抓取并填入下方字段。"
                  : "免去手动抓 cookie：点「登录获取凭证」在弹窗中登录火山方舟，登录成功后 Cookie 与 x-web-id 会自动抓取并填入下方字段。"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogin}
                disabled={logining || saving}
              >
                <LogIn className="size-4" />
                {logining ? "登录中…" : "登录获取凭证"}
              </Button>
            </div>
          )}
          {def?.configSchema.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>
                {f.label}
                {f.required && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              {f.type === "select" ? (
                <Select
                  value={fields[f.key] ?? ""}
                  onValueChange={(v) => setFields((s) => ({ ...s, [f.key]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === "password" ? "password" : "text"}
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              )}
              {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
