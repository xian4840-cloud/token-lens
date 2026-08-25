// 生成 build/icon.ico：纯 Node 内置模块，手写 PNG + ICO 编码，无外部依赖。
// 图形：深色底 + 青色环形进度仪表盘 + 中心亮点，契合 Token 余额查看主题。
// 用法：node scripts/generate-icon.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- CRC32（PNG chunk 校验） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG 编码（RGBA 8bit） ----------
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const typeData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function pngEncode(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 图标绘制（4x 超采样抗锯齿） ----------
const BG = [11, 11, 18, 255]; // #0b0b12 与窗口底色一致
const TRACK = [30, 41, 59, 255]; // #1e293b 环底
const ARC = [34, 211, 238, 255]; // #22d3ee 进度青
const CENTER = [235, 245, 255, 255]; // 中心亮点
const PROGRESS = 0.72;

function renderIcon(size) {
  const SS = 4;
  const w = size * SS;
  const cx = (w - 1) / 2;
  const cy = (w - 1) / 2;
  const ROUT = w * 0.4;
  const RIN = w * 0.28;
  const RCENTER = w * 0.085;
  const ssBuf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let px = BG;
      if (d < RCENTER) {
        px = CENTER;
      } else if (RIN < d && d < ROUT) {
        // 屏幕坐标 y 向下：atan2(dy,dx) 0=右、π/2=下；顶部=-π/2，顺时针=角度增大
        let t = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI);
        if (t < 0) t += 1;
        if (t >= 1) t -= 1;
        px = t < PROGRESS ? ARC : TRACK;
      }
      const i = (y * w + x) * 4;
      ssBuf[i] = px[0];
      ssBuf[i + 1] = px[1];
      ssBuf[i + 2] = px[2];
      ssBuf[i + 3] = px[3];
    }
  }
  // 降采样：SS×SS 平均
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * w + (x * SS + sx)) * 4;
          r += ssBuf[i];
          g += ssBuf[i + 1];
          b += ssBuf[i + 2];
          a += ssBuf[i + 3];
        }
      }
      const n = SS * SS;
      const oi = (y * size + x) * 4;
      out[oi] = Math.round(r / n);
      out[oi + 1] = Math.round(g / n);
      out[oi + 2] = Math.round(b / n);
      out[oi + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---------- ICO 编码（PNG 嵌入式，Vista+） ----------
function icoEncode(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ico
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  const datas = [];
  for (const { width, png } of pngs) {
    const e = Buffer.alloc(16);
    const dim = width === 256 ? 0 : width; // 256 在 ICO 中存为 0
    e[0] = dim;
    e[1] = dim;
    e[2] = 0; // 调色板色数（0=无）
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(png.length, 8); // image size
    e.writeUInt32LE(offset, 12); // data offset
    entries.push(e);
    datas.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

// ---------- 主流程 ----------
const SIZES = [256, 128, 64, 48, 32, 16];
const pngs = SIZES.map((s) => ({ width: s, png: pngEncode(renderIcon(s), s, s) }));
const ico = icoEncode(pngs);
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.ico");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, ico);
console.log(`generated ${outPath} (${ico.length} bytes, sizes: ${SIZES.join(", ")})`);

// 预览 PNG（便于肉眼核对效果，不参与打包）
const preview = pngEncode(renderIcon(256), 256, 256);
writeFileSync(resolve(dirname(outPath), "icon-preview.png"), preview);
console.log("preview: build/icon-preview.png");
