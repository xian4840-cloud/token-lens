/**
 * 阿里云 ACS3-HMAC-SHA256 签名回归校验。
 *
 * 用官方文档的「固定参数示例」自校验向量验证 signAcs3 的实现。
 * ACS3 与 SigV4 结构不同（StringToSign 两行、密钥不派生、Credential 无 scope、
 * 只有 x-acs- 前缀头与 host、content-type 参与签名），改动 signing.ts 后请跑此脚本。
 *
 *   npm run build:electron && npm run verify:signing
 */
const { signAcs3 } = require("../electron-dist/adapters/signing.js");

// 官方固定参数示例：help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
const EXPECTED_SIGNATURE =
  "06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0";

const { authorization, headers } = signAcs3({
  method: "POST",
  uri: "/",
  query: {
    ImageId: "win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd",
    RegionId: "cn-shanghai",
  },
  host: "ecs.cn-shanghai.aliyuncs.com",
  headers: {
    "x-acs-action": "RunInstances",
    "x-acs-version": "2014-05-26",
    // 故意混入不该参与签名的 header，验证过滤逻辑
    accept: "application/json",
  },
  payload: "",
  ak: "YourAccessKeyId",
  sk: "YourAccessKeySecret",
  dateTimeISO: "2023-10-26T10:22:32Z",
  nonce: "3156853299f313e23d1673dc12e1703d",
});

const matched = /Signature=([0-9a-f]+)$/.exec(authorization);
const got = matched ? matched[1] : "(未解析出签名)";

const checks = [
  ["签名值与官方向量一致", got === EXPECTED_SIGNATURE],
  [
    "SignedHeaders 正确且不含 accept",
    authorization.includes(
      "SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,",
    ),
  ],
  ["Credential 只含 AccessKeyId（无 scope）", authorization.includes("Credential=YourAccessKeyId,")],
  ["发送头保留 accept（仅签名时排除）", headers.accept === "application/json"],
  ["发送头已移除 host", headers.host === undefined],
];

console.log("expected:", EXPECTED_SIGNATURE);
console.log("got     :", got);
console.log("");

let allPass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) allPass = false;
}
console.log("");
console.log(allPass ? "RESULT: ALL PASS" : "RESULT: FAILED");
process.exit(allPass ? 0 : 1);
