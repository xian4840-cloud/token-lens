import { formatTokensCn } from "@/lib/format";
import {
  LOCAL_SOURCES,
  LOCAL_SOURCE_COLORS,
  type DailyUsageRow,
} from "@/lib/local-sources";

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "var(--popover)",
  border: "1px solid rgba(255, 255, 255, 0.5)",
  borderRadius: "12px",
  fontSize: "12px",
  boxShadow: "0 8px 30px rgba(90, 75, 50, 0.12)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  color: "var(--popover-foreground)",
  padding: "8px 12px",
};

function Row({
  label,
  value,
  dot,
}: {
  label: string;
  value: string;
  dot: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: dot }}
        />
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** 模型分项行：缩进 + 等宽字体，模型名过长截断 */
function ModelRow({ model, tokens }: { model: string; tokens: number }) {
  return (
    <div className="flex items-center justify-between gap-4 pl-3.5 text-[11px] text-muted-foreground">
      <span className="max-w-44 truncate font-mono">{model}</span>
      <span className="shrink-0 tabular-nums">{formatTokensCn(tokens)}</span>
    </div>
  );
}

/** 本地 agent 每日柱状图 Tooltip：各来源（含模型分项）+ 当日 Input / Output / 总 tokens */
export function LocalUsageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: DailyUsageRow }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const sources = LOCAL_SOURCES.filter(
    (s) =>
      typeof row[s.value] === "number" && (row[s.value] as number) > 0,
  );
  return (
    <div style={TOOLTIP_STYLE}>
      <div className="mb-1 font-medium">{label ?? row.date}</div>
      {sources.map((s, i) => (
        <div key={s.value} className="mb-0.5">
          <Row
            label={s.label}
            value={formatTokensCn(row[s.value] as number)}
            dot={LOCAL_SOURCE_COLORS[i % LOCAL_SOURCE_COLORS.length]}
          />
          {(row.models?.[s.value] ?? []).map((m) => (
            <ModelRow key={m.model} model={m.model} tokens={m.tokens} />
          ))}
        </div>
      ))}
      {sources.length > 0 && <div className="my-1 border-t border-border/60" />}
      <Row
        label="Input"
        value={formatTokensCn(row.input ?? 0)}
        dot="var(--muted-foreground)"
      />
      <Row
        label="Output"
        value={formatTokensCn(row.output ?? 0)}
        dot="var(--muted-foreground)"
      />
      <Row
        label="总 tokens"
        value={formatTokensCn(row.total ?? 0)}
        dot="var(--muted-foreground)"
      />
    </div>
  );
}
