import {
  index,
  layout,
  prefix,
  type RouteConfig,
  route,
} from '@react-router/dev/routes'

export default [
  /**
   * 两份给爬虫的东西，**故意在 `:locale?` 之外**：全站只有一份 sitemap，
   * 三语互链写在每个条目内部；robots 同理。放进前缀里会得到
   * `/ja/sitemap.xml` 这种既存在又没人引用的网址。
   *
   * 静态段在 RR 的排序里压过动态段，所以它们不会被 `:locale?` 抢走。
   */
  route('sitemap.xml', 'routes/sitemap[.]xml.ts'),
  route('robots.txt', 'routes/robots[.]txt.ts'),
  ...prefix(':locale?', [
    index('routes/home.tsx'),
    route('ui', 'routes/ui.tsx'),
    route('login', 'routes/login.tsx'),
    route('register', 'routes/register.tsx'),
    route('verify', 'routes/verify.tsx'),
    route('forgot', 'routes/forgot.tsx'),
    route('kourindou', 'routes/kourindou/list.tsx'),
    route('kourindou/upload', 'routes/kourindou/upload.tsx'),
    route('kourindou/:slug', 'routes/kourindou/detail.tsx'),
    route('shrine', 'routes/shrine/index.tsx'),
    route('shrine/new', 'routes/shrine/new.tsx'),
    route('shrine/b/:board', 'routes/shrine/board.tsx'),
    route('shrine/t/:id', 'routes/shrine/topic.tsx'),
    route('u/:handle', 'routes/profile.tsx'),
    route('notifications', 'routes/notifications.tsx'),
    route('chronicle', 'routes/stub.tsx', { id: 'stub-chronicle' }),
    route('spellcard', 'routes/stub.tsx', { id: 'stub-spellcard' }),
    route('music', 'routes/stub.tsx', { id: 'stub-music' }),
    layout('routes/dash/layout.tsx', [
      route('dash', 'routes/dash/queue.tsx'),
      route('dash/reports', 'routes/dash/reports.tsx'),
      // 站长独占，loader 里各自再挡一次——布局的守卫只挡到审核员那层
      route('dash/users', 'routes/dash/users.tsx'),
      route('dash/trash', 'routes/dash/trash.tsx'),
      route('dash/site', 'routes/dash/site.tsx'),
    ]),
  ]),
] satisfies RouteConfig
