export type VerifyStep = 'anonymous' | 'otp' | 'handle' | 'done'

/**
 * `/verify` 该显示哪一段。
 *
 * 这一页同时服务两类人：邮箱密码注册的（要走 otp → handle 两段）与
 * Google 注册的（邮箱天生已验证，只剩 handle）。抽成纯函数是因为
 * web 的测试**进 CI**，而 api 的不进。
 *
 * 顺序不能反：先证明邮箱是你的，再让你占一个公开的、不可逆的标识符。
 */
export function verifyStep(
  user: { emailVerified: boolean; handleSetAt: string | null } | null,
): VerifyStep {
  if (!user) return 'anonymous'
  if (!user.emailVerified) return 'otp'
  if (user.handleSetAt === null) return 'handle'
  return 'done'
}
