import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * 请求签名工具。
 *
 * - `signSigV4`：AWS SigV4 家族（火山引擎 Signature V4）。含 credential scope
 *   与 date→region→service→requestType 的派生密钥链。
 * - `signAcs3`：阿里云 V3 的 ACS3-HMAC-SHA256。**与 SigV4 结构不同，不可套用
 *   `signSigV4`**，差异见该函数注释。
 */

/** SHA256 十六进制摘要 */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** HMAC-SHA256，返回 Buffer */
function hmacSha256(key: string | Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** RFC3986 严格编码（encodeURIComponent 不编码 !'()*，签名要求编码） */
function strictEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** 规范化查询字符串：按 key 字典序，严格编码 */
function canonicalQueryString(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${strictEncode(k)}=${strictEncode(query[k])}`)
    .join("&");
}

/** 规范化 header：小写 key + trim value，按 key 字典序；unsignable 中的不参与签名 */
function canonicalHeaders(
  headers: Record<string, string>,
  unsignable?: Set<string>,
): { canonical: string; signed: string } {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase().trim();
    if (unsignable?.has(lk)) continue;
    lower[lk] = String(v).trim();
  }
  const keys = Object.keys(lower).sort();
  return {
    canonical: keys.map((k) => `${k}:${lower[k]}\n`).join(""),
    signed: keys.join(";"),
  };
}

export interface SigV4Params {
  method: string;
  /** 请求路径，如 "/" */
  uri: string;
  query: Record<string, string>;
  /** 主机名，如 open.volcengineapi.com */
  host: string;
  /** 业务 header（如 x-acs-action、x-acs-signature-nonce）；host/date/content-sha256 由内部补充 */
  headers: Record<string, string>;
  payload: string;
  ak: string;
  sk: string;
  /** YYYYMMDD，如 20240101 */
  dateYYYYMMDD: string;
  /** ISO 基本时间，如 20240101T000000Z */
  dateTimeISO: string;
  region: string;
  service: string;
  /** scope 末段：火山 "request"，阿里云 "acs3_request" */
  requestType: string;
  /** Authorization 前缀：火山 "HMAC-SHA256"，阿里云 "ACS3-HMAC-SHA256" */
  algorithm: string;
  /** 携带时间戳的 header 名：火山 "x-date"，阿里云 "x-acs-date" */
  dateHeader: string;
  /** 携带 payload 摘要的 header 名：火山 "x-content-sha256"，阿里云 "x-acs-content-sha256"；GET 空体可传 undefined */
  contentSha256Header?: string;
  /** 不参与签名的 header 名（小写），如火山引擎的 host、content-type */
  unsignable?: string[];
}

export interface SignedRequest {
  authorization: string;
  /** 发送 fetch 时应使用的完整 header（含 host/date/content-sha256/authorization） */
  headers: Record<string, string>;
}

/** 计算 SigV4 签名，返回 Authorization 头与完整请求头 */
export function signSigV4(p: SigV4Params): SignedRequest {
  const payloadHash = sha256Hex(p.payload);
  const headers: Record<string, string> = {
    host: p.host,
    ...p.headers,
    [p.dateHeader]: p.dateTimeISO,
  };
  if (p.contentSha256Header) {
    headers[p.contentSha256Header] = payloadHash;
  }

  const unsignable = new Set(p.unsignable?.map((s) => s.toLowerCase()));
  const { canonical, signed } = canonicalHeaders(headers, unsignable);
  const canonicalRequest = [
    p.method,
    p.uri,
    canonicalQueryString(p.query),
    canonical,
    signed,
    payloadHash,
  ].join("\n");

  const credentialScope = `${p.dateYYYYMMDD}/${p.region}/${p.service}/${p.requestType}`;
  const stringToSign = [
    p.algorithm,
    p.dateTimeISO,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // 派生签名密钥：SK -> date -> region -> service -> requestType
  const kDate = hmacSha256(p.sk, p.dateYYYYMMDD);
  const kRegion = hmacSha256(kDate, p.region);
  const kService = hmacSha256(kRegion, p.service);
  const kSigning = hmacSha256(kService, p.requestType);
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const authorization = `${p.algorithm} Credential=${p.ak}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`;
  // 发送时去掉 host：fetch 会根据 URL 自动设置，手动传入可能被 undici 拒绝
  const sendHeaders: Record<string, string> = {
    ...headers,
    Authorization: authorization,
  };
  delete sendHeaders.host;
  return { authorization, headers: sendHeaders };
}

/** 生成 YYYYMMDDTHHMMSSZ 格式时间戳（传入 Date） */
export function formatSigV4DateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** 生成 YYYYMMDD 日期（传入 Date） */
export function formatSigV4Date(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** 生成随机签名 nonce（使用 crypto.randomUUID，避免 Math.random） */
export function randomNonce(): string {
  return randomUUID().replace(/-/g, "");
}

// ---- 阿里云 V3：ACS3-HMAC-SHA256 ----

const ACS3_ALGORITHM = "ACS3-HMAC-SHA256";

/** ACS3 要求的 ISO8601 扩展格式时间：2023-10-26T10:22:32Z（须在服务端时间 ±15 分钟内） */
export function formatAcs3DateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

export interface Acs3Params {
  method: string;
  /** 请求路径：RPC 风格接口固定 "/" */
  uri: string;
  query: Record<string, string>;
  /** 主机名，如 business.aliyuncs.com */
  host: string;
  /** 业务 header（x-acs-action / x-acs-version 等）；host、x-acs-date、x-acs-content-sha256、nonce 由内部补齐 */
  headers: Record<string, string>;
  payload: string;
  ak: string;
  sk: string;
  /** 时间戳，省略取当前时间。仅测试需要固定值时传入 */
  dateTimeISO?: string;
  /** 签名 nonce，省略则随机生成。仅测试需要固定值时传入 */
  nonce?: string;
}

/**
 * 阿里云 V3（ACS3-HMAC-SHA256）签名。与 SigV4 有四处结构性差异，勿套用 signSigV4：
 *   1. StringToSign 只有两行：算法名 + CanonicalRequest 的 SHA256，无时间戳/无 scope
 *   2. 签名密钥直接用 AccessKeySecret 单次 HMAC，无 date→region→service 派生链
 *   3. Authorization 的 Credential 只放 AccessKeyId（无 scope），逗号分隔且无空格
 *   4. 仅 x-acs-* + host + content-type 参与签名，其余 header（如 accept）必须排除
 * region 与 service 不参与签名，由 host 与 x-acs-version 隐式决定。
 */
export function signAcs3(p: Acs3Params): SignedRequest {
  const payloadHash = sha256Hex(p.payload);
  const headers: Record<string, string> = {
    host: p.host,
    ...p.headers,
    "x-acs-date": p.dateTimeISO ?? formatAcs3DateTime(new Date()),
    "x-acs-signature-nonce": p.nonce ?? randomNonce(),
    "x-acs-content-sha256": payloadHash,
  };

  // 仅 x-acs-*、host、content-type 参与签名（accept 等一律排除）
  const signable: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase().trim();
    if (lk === "host" || lk === "content-type" || lk.startsWith("x-acs-")) {
      signable[lk] = v;
    }
  }

  const { canonical, signed } = canonicalHeaders(signable);
  const canonicalRequest = [
    p.method,
    p.uri,
    canonicalQueryString(p.query),
    canonical,
    signed,
    payloadHash,
  ].join("\n");

  const stringToSign = `${ACS3_ALGORITHM}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256(p.sk, stringToSign).toString("hex");
  const authorization =
    `${ACS3_ALGORITHM} Credential=${p.ak},SignedHeaders=${signed},Signature=${signature}`;

  // 发送时去掉 host：fetch 依 URL 自动设置，手动传入会被 undici 拒绝
  const sendHeaders: Record<string, string> = { ...headers, Authorization: authorization };
  delete sendHeaders.host;
  return { authorization, headers: sendHeaders };
}
