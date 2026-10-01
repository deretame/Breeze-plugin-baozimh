/**
 * baozimh.org 章节图片解码器（纯 TS，无浏览器依赖）。
 *
 * 输入：`GET https://v2.apikk.top/api/v2/chapter/getinfo?m=<mid>&c=<cid>`
 * 返回的 `data.info.images.images` 字符串。
 * 输出：有序图片路径（不含主机）；调用方按 `images.line` 拼接线路主机得到完整 URL。
 *
 * 算法（来自站内 `/assets/runtime/chapter-decoder.js` 逆向，已对线上样本逐字节验证）：
 * enc（`J7r…nQ`）→ 去前后缀 → 按 `kD`/`W4s` 哨兵拆成三段并重排
 * → 7 字符分块、奇数块反转 → 自定义字母表映射回标准 base64url
 * → base64 解码 → UTF-8 JSON `[{order, url}]`。
 * 站内 `x0` 域名锁（检查 `window.location.hostname`）在插件侧跳过；
 * `x1`–`x4` 为真实数据完整性校验，保留为抛错。
 */

export type DecodedChapterImage = {
  order: number;
  url: string;
};

const STD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CUSTOM_ALPHABET =
  "_-9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PREFIX = "J7r";
const TAG1 = "kD";
const TAG2 = "W4s";
const SUFFIX = "nQ";
const CHUNK = 7;

export function decodeChapterImages(enc: string): DecodedChapterImage[] {
  if (typeof enc !== "string" || !enc.startsWith(PREFIX) || !enc.endsWith(SUFFIX)) {
    throw new Error("x2");
  }
  const s1 = enc.slice(PREFIX.length, -SUFFIX.length);
  const v55 = s1.length - TAG1.length - TAG2.length;
  if (v55 < 0) throw new Error("x3");
  const v70 = Math.floor(v55 / 3);
  const a0 = Math.floor((v55 - v70) / 2);
  const r = v55 - v70 - a0;
  const fb = s1.slice(0, a0);
  const tag1 = s1.slice(a0, a0 + TAG1.length);
  const mid = s1.slice(a0 + TAG1.length, a0 + TAG1.length + r);
  const t2 = a0 + TAG1.length + r;
  const tag2 = s1.slice(t2, t2 + TAG2.length);
  const payload = s1.slice(t2 + TAG2.length);
  if (tag1 !== TAG1 || tag2 !== TAG2 || payload.length !== v70) {
    throw new Error("x4");
  }
  const combined = payload + fb + mid;
  let u = "";
  for (let i = 0, j = 0; i < combined.length; i += CHUNK, j++) {
    const chunk = combined.slice(i, i + CHUNK);
    u += j % 2 === 1 ? chunk.split("").reverse().join("") : chunk;
  }
  let std = "";
  for (let i = 0; i < u.length; i++) {
    const k = CUSTOM_ALPHABET.indexOf(u[i]);
    if (k < 0) throw new Error("x1");
    std += STD_ALPHABET[k];
  }
  const pad = std.length % 4 === 0 ? "" : "=".repeat(4 - (std.length % 4));
  const bin = atob(std.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as DecodedChapterImage[];
}
