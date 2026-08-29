import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('ui', 'routes/ui.tsx'),
] satisfies RouteConfig
