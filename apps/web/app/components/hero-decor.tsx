/**
 * 首页 hero 的装饰层。
 *
 * **整层是装饰不是内容**：aria-hidden + pointer-events-none，不承载任何信息。
 * 因此它可以自由入场——内容层「首帧零入场、禁止 initial 隐藏态」的红线不适用。
 * h1 与 tagline 仍然首帧即终态，无 JS 时照常完整可读。
 *
 * 纯 CSS 动画，没有一行 JS 在运行时跑。
 */
export function HeroDecor() {
  return (
    <div className="hero-decor" aria-hidden="true">
      <span className="hero-seal" />
    </div>
  )
}
