import { Component, type ReactNode } from 'react'

/**
 * lazy() 的兜底：部署之后老页面还开着、chunk 哈希已变，import() 会 404，
 * React.lazy 把它当渲染错误抛出——没有这层就直接抛到路由 ErrorBoundary，
 * 整页换成错误页。site-header.tsx 的 auth-client 动态 import 为同一失败模式包了 try/catch。
 * 出错时渲染 fallback（通常是那段动效的静态形态），不重试：下一次整页加载自然是新哈希。
 */
export class LazyBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('lazy chunk failed', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
