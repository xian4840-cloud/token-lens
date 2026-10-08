/*
 * 桌宠窗口首帧透明。
 *
 * 必须是同源外链脚本，不能写成 index.html 里的内联 <script>：生产环境 CSP 是
 * script-src 'self'，内联脚本会被直接拦掉，pet-window 类要等 React 懒加载完
 * Pet 页才加上，期间无边框透明窗口先铺出一块奶油色底。
 * 放在 <head> 里同步执行，早于 <body> 解析与首帧绘制。
 */
if (location.hash === "#/pet") {
  document.documentElement.classList.add("pet-window");
}
