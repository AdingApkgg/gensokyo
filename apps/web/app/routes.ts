import {
  index,
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
    route('kourindou/:slug', 'routes/kourindou/detail.tsx'),
    route('shrine', 'routes/stub.tsx', { id: 'stub-shrine' }),
    route('chronicle', 'routes/stub.tsx', { id: 'stub-chronicle' }),
    route('spellcard', 'routes/stub.tsx', { id: 'stub-spellcard' }),
    route('music', 'routes/stub.tsx', { id: 'stub-music' }),
  ]),
] satisfies RouteConfig
