import { safeStorage } from "electron";

/** 系统加密是否可用（Windows DPAPI / macOS Keychain / Linux libsecret） */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** 加密明文，返回密文 Buffer */
export function encrypt(text: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统加密不可用，无法安全存储密钥");
  }
  return safeStorage.encryptString(text);
}

/** 解密密文 Buffer，返回明文 */
export function decrypt(buffer: Buffer): string {
  return safeStorage.decryptString(buffer);
}
