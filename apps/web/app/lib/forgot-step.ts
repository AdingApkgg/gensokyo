export type ForgotStep = 'email' | 'reset' | 'done'

/**
 * 找回密码走到哪一步了。抽成纯函数是因为 web 的测试**进 CI**。
 *
 * `reset` 为真时一律返回 done，即使 `requested` 为假——那是个自相矛盾的
 * 状态，但把用户打回第一步重来比接受它更糟。
 */
export function forgotStep(state: {
  requested: boolean
  reset: boolean
}): ForgotStep {
  if (state.reset) return 'done'
  return state.requested ? 'reset' : 'email'
}
