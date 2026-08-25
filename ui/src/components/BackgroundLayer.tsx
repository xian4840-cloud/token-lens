import bgHero from "@/assets/bg-hero.jpg";

/**
 * 全局背景层：水彩插画铺底 + 轻奶白罩（拉开文字与插画的明度差）。
 * pointer-events-none + 内容区 z-10，不拦截任何交互。
 */
export function BackgroundLayer() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 select-none" aria-hidden="true">
      <img src={bgHero} alt="" draggable={false} className="size-full object-cover" />
      <div className="absolute inset-0 bg-background/25" />
      {/* 纸张颗粒层，水彩纸质感 */}
      <div className="grain absolute inset-0" />
    </div>
  );
}
