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
  ]),
] satisfies RouteConfig
