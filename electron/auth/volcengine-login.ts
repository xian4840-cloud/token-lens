import {
  openLoginWindow,
  type ExtractedCredentials,
} from "./login-window";
import { validateVolcenginePlanCredentials } from "../adapters/volcengine_plan";

export interface VolcengineCredentials {
  cookie: string;
  xWebId: string;
}

const LOGIN_URL = "https://console.volcengine.com/ark";
// persist: 前缀让 partition 持久化到磁盘，配合 validate 实现跨重启免重登：
// cookie 有效则复用，过期则 validate 失败、继续等用户重登
const PARTITION = "persist:volcengine-auth";
// 伪装为正常 Chrome UA，避免火山方舟风控识别 Electron 而拒绝登录
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * 打开火山方舟登录窗口。用户在窗口内登录控制台后，自动拦截请求提取
 * Cookie 与 x-web-id。独立 partition 持久化，下次可能免重登。
 * 返回 null 表示用户关闭窗口未完成。
 *
 * 凭证提取委托给通用 openLoginWindow，此处仅声明火山方舟专属参数：
 * 控制台 URL、允许域、要提取的 header、有效凭证判定（cookie 含 csrfToken）。
 */
export function openVolcengineLogin(): Promise<VolcengineCredentials | null> {
  return openLoginWindow({
    partition: PARTITION,
    loginUrl: LOGIN_URL,
    title: "登录火山方舟 - 登录成功后自动获取凭证",
    allowedDomains: ["volcengine.com"],
    extractHeaders: ["cookie", "x-web-id"],
    isValid: (h) =>
      !!h.cookie && !!h["x-web-id"] && h.cookie.includes("csrfToken"),
    // 候选凭证须通过真实接口验证，避免残留过期 cookie 被秒返回
    validate: (h) =>
      validateVolcenginePlanCredentials(h.cookie ?? "", h["x-web-id"] ?? ""),
    userAgent: USER_AGENT,
  }).then(toVolcengineCredentials);
}

function toVolcengineCredentials(
  cred: ExtractedCredentials | null,
): VolcengineCredentials | null {
  if (!cred) return null;
  return {
    cookie: cred.cookie ?? "",
    xWebId: cred["x-web-id"] ?? "",
  };
}
