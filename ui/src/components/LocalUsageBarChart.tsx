import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LocalUsageTooltip } from "@/components/LocalUsageTooltip";
import { formatCompact } from "@/lib/format";
import {
  LOCAL_SOURCES,
  LOCAL_SOURCE_COLORS,
  type DailyUsageRow,
  type LocalMetric,
} from "@/lib/local-sources";

/**
 * 用量页与趋势页共用的本地 agent 每日堆叠柱图。
 * 焦点描边、配色、Tooltip 只在这一处改。
 */
export function LocalUsageBarChart({
  data,
  height,
  metric = "tokens",
}: {
  data: DailyUsageRow[];
  height: number;
  metric?: LocalMetric;
}) {
  const tickSize = height >= 280 ? 12 : 11;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} accessibilityLayer={false}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(110, 95, 70, 0.12)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: tickSize, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          dy={6}
        />
        <YAxis
          tick={{ fontSize: tickSize, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v: number) =>
            metric === "tokens" ? formatCompact(v) : `$${formatCompact(v)}`
          }
        />
        <Tooltip
          cursor={{ fill: "rgba(110, 95, 70, 0.06)" }}
          content={<LocalUsageTooltip metric={metric} />}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {LOCAL_SOURCES.map((s, i) => (
          <Bar
            key={s.value}
            dataKey={s.value}
            name={s.label}
            stackId="a"
            fill={LOCAL_SOURCE_COLORS[i % LOCAL_SOURCE_COLORS.length]}
            radius={[3, 3, 0, 0]}
            activeBar={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
