import {
  openLoginWindow,
  type ExtractedCredentials,
} from "./login-window";
import { validateScnetCredentials } from "../adapters/scnet_token_plan";

export interface ScnetCredentials {
  cookie: string;
}

const LOGIN_URL = "https://www.scnet.cn/ui/console/index.html";
// persist: 前缀让 partition 持久化到磁盘，配合 validate 实现跨重启免重登：
// cookie 有效则复用，过期则 validate 失败、继续等用户重登
const PARTITION = "persist:scnet-auth";
// 伪装为正常 Chrome UA，避免控制台风控识别 Electron 而拒绝登录
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * 打开超算互联网登录窗口。用户在窗口内登录控制台后，自动拦截请求提取
 * Cookie。独立 partition 持久化，下次可能免重登。返回 null 表示用户关闭
 * 窗口未完成登录。
 *
 * 凭证提取委托给通用 openLoginWindow，此处仅声明 SCNet 专属参数：
 * 控制台 URL、允许域 scnet.cn、提取 cookie、有效凭证判定（cookie 含登录态
 * 字段 Token=，排除游客 cookie）。
 */
export function openScnetLogin(): Promise<ScnetCredentials | null> {
  return openLoginWindow({
    partition: PARTITION,
    loginUrl: LOGIN_URL,
    title: "登录超算互联网 - 登录成功后自动获取凭证",
    allowedDomains: ["scnet.cn"],
    extractHeaders: ["cookie"],
    isValid: (h) =>
      !!h.cookie &&
      h.cookie.split(";").some((c) => c.trim().startsWith("Token=")),
    // 候选凭证须通过真实接口验证，避免残留过期 cookie 被秒返回
    validate: (h) => validateScnetCredentials(h.cookie ?? ""),
    userAgent: USER_AGENT,
  }).then(toScnetCredentials);
}

function toScnetCredentials(
  cred: ExtractedCredentials | null,
): ScnetCredentials | null {
  if (!cred) return null;
  return { cookie: cred.cookie ?? "" };
}
