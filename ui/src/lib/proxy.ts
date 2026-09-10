/**
 * 代理直连旁路规则的默认值（界面侧）。
 *
 * 与 electron/lib/http.ts 的 DEFAULT_BYPASS_RULES 是同一套规则的两份副本——
 * 主进程侧是实际生效的那份，界面侧用于「用户没设置过」时的展示。
 *
 * 两者不一致的后果是安静的：设置页的输入框里显示着 A，而应用实际按 B 分流，
 * 用户没有任何办法看出来，直到某次请求走了不该走的代理。http.test.ts 里有一条
 * 跨进程断言把两份钉在一起——靠注释约定同步是没用的，这个项目已经吃过亏。
 */
export const DEFAULT_BYPASS_RULES =
  "<local>,*.cn,*.aliyuncs.com,*.volcengineapi.com,*.volcengine.com,*.moonshot.cn,*.minimax.chat,*.minimaxi.com,*.xiaomimimo.com,*.scnet.cn,*.siliconflow.cn";
