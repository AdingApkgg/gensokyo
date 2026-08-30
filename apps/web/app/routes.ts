import {
  index,
  layout,
  prefix,
  type RouteConfig,
  route,
} from '@react-router/dev/routes'

export default [
  ...prefix(':locale?', [
    index('routes/home.tsx'),
    route('ui', 'routes/ui.tsx'),
    route('login', 'routes/login.tsx'),
    route('register', 'routes/register.tsx'),
    route('kourindou', 'routes/kourindou/list.tsx'),
    route('kourindou/upload', 'routes/kourindou/upload.tsx'),
    route('kourindou/:slug', 'routes/kourindou/detail.tsx'),
    route('shrine', 'routes/stub.tsx', { id: 'stub-shrine' }),
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
