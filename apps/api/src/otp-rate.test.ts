import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { app } from './app'
import {
  countOtpRows,
  decideOtpRate,
  OTP_HOURLY_QUOTA,
  type OtpRateTarget,
  otpRateTarget,
} from './otp-rate'
import { cleanupTracked, trackUser } from './testing'

afterAll(cleanupTracked)

describe('decideOtpRate', () => {
  test('冷却窗内有过一次 → 拒绝，并给出等待秒数', () => {
    const r = decideOtpRate(1, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  test('冷却窗空着但小时配额用尽 → 拒绝', () => {
    const r = decideOtpRate(0, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
  })

  test('两者都没超 → 放行', () => {
    expect(decideOtpRate(0, 0).ok).toBe(true)
    expect(decideOtpRate(0, OTP_HOURLY_QUOTA - 1).ok).toBe(true)
  })

  test('冷却窗优先于配额报出来 —— 它更早触发，反馈也更直观', () => {
    const r = decideOtpRate(1, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
    // 冷却窗的等待时间远短于一小时
    if (!r.ok) expect(r.retryAfterSeconds).toBeLessThanOrEqual(60)
  })
})

describe('otpRateTarget —— 限流挂载点的路径覆盖', () => {
  /**
   * 限流改挂 `hooks.before` 之后，覆盖面变成一份**手写的路径清单**——
   * 挂在发信回调里的时候，三条发 forget-password 码的路径天然共享同一个
   * 回调，不会漏。所以这组表驱动断言是那份清单的门禁：漏一条不会报错，
   * 只会让那条路径完全不限流（自查时拿一次性脚本连打 deprecated 别名，
   * 两次都 200 且两封信都发出去过）。
   */
  const CASES: Array<[string, unknown, OtpRateTarget | null]> = [
    [
      '/email-otp/request-password-reset',
      { email: 'a@b.c' },
      { purpose: 'forget-password', email: 'a@b.c' },
    ],
    [
      '/forget-password/email-otp',
      { email: 'a@b.c' },
      { purpose: 'forget-password', email: 'a@b.c' },
    ],
    [
      '/email-otp/send-verification-otp',
      { email: 'a@b.c', type: 'forget-password' },
      { purpose: 'forget-password', email: 'a@b.c' },
    ],
    [
      '/email-otp/send-verification-otp',
      { email: 'a@b.c', type: 'email-verification' },
      { purpose: 'email-verification', email: 'a@b.c' },
    ],
    // 我们不用的类型：不限流，也发不出信（回调里第一行就 return）
    [
      '/email-otp/send-verification-otp',
      { email: 'a@b.c', type: 'sign-in' },
      null,
    ],
    // 别的端点一概不碰
    ['/sign-in/email', { email: 'a@b.c' }, null],
    [
      '/email-otp/reset-password',
      { email: 'a@b.c', otp: '1', password: 'x' },
      null,
    ],
    // 请求体不成形就交给端点自己的校验去报错
    ['/email-otp/request-password-reset', undefined, null],
    ['/email-otp/request-password-reset', { email: 42 }, null],
  ]

  for (const [path, body, want] of CASES) {
    test(`${path} ${JSON.stringify(body)} → ${want ? want.purpose : 'null'}`, () => {
      expect(otpRateTarget(path, body)).toEqual(want)
    })
  }
})

describe('发码端点的按邮箱限流', () => {
  test('连着要两次验证码，第二次被冷却窗挡住', async () => {
    const email = `rate-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    // 注册本身已经发过一次码（sendVerificationOnSignUp），所以下面这次
    // 必然落在冷却窗里
    const again = await app.request(
      '/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, type: 'email-verification' }),
      },
    )
    expect(again.status).toBe(429)
  })

  test('找回密码对不存在的邮箱也返回成功 —— 不泄露邮箱是否注册过', async () => {
    const res = await app.request(
      '/api/auth/email-otp/request-password-reset',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `ghost-${Date.now()}@example.com` }),
      },
    )
    expect(res.status).toBe(200)
  })

  /**
   * deprecated 的 `/forget-password/email-otp` 是 better-auth 默认注册的
   * 别名端点，与 `/email-otp/request-password-reset` 调用同一个
   * `resolveOTP(..., "forget-password")`、写同一种 identifier、且共享
   * 同一个 `sendVerificationOTP` 回调——如果限流判断漏挡了某条路径，这
   * 条别名会完整绕过限流（自查时用一次性诊断脚本打过两次，两次都 200，
   * 已经删掉那份脚本）。round 3 把限流挪进 `hooks.before` 之后，「共享同一个
   * 回调」这层天然保障没了，改由 `otpRateTarget()` 的路径清单负责——所以
   * 这条端到端断言比之前更重要，它是那份清单真的生效的证据。
   *
   * ⚠️ round 2（修「注册预言机」）之后，forget-password 命中限流**不再
   * 吐 429**——统一回 200、只是静默不发信（见 auth.ts 的 hooks.before
   * 注释）。所以这条测试改成断言「两次请求只真的发出一封信」，不再断言
   * 状态码差异；状态码不可区分这件事由「找回密码限流不能变成注册预言机」
   * 那组测试钉住。
   *
   * ⚠️ 邮箱必须是**已注册**的——用不存在的邮箱会踩到另一条既有行为：
   * better-auth 在 `findUserByEmail` 落空时会把刚创建的 verification 行
   * 立刻 `deleteVerificationByIdentifier` 掉，回调根本不会被调用，两次
   * 请求都不会发信，「只发一封」这条断言就失去意义（恒为 0 而不是 1）。
   */
  test('deprecated 的 /forget-password/email-otp 别名与新端点共享同一个限流桶（两次都 200，但只真的发一封信）', async () => {
    const email = `legacy-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    let firstStatus: number
    let secondStatus: number
    try {
      const first = await app.request('/api/auth/forget-password/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      firstStatus = first.status
      const second = await app.request('/api/auth/forget-password/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      secondStatus = second.status
    } finally {
      spy.mockRestore()
    }

    expect(firstStatus).toBe(200)
    expect(secondStatus).toBe(200)
    const mails = logs.filter(
      (l) => l.includes('[mail:console]') && l.includes(email),
    )
    expect(mails.length).toBe(1)
  })
})

describe('找回密码限流不能变成注册预言机', () => {
  /**
   * Review round 1 的 Important 发现：`resolveOTP` 会给已注册邮箱留下一行
   * 持久的 verification 行（第二次请求数到 ≥1 → 429），但对未注册邮箱，
   * 端点自己会把刚插入的行立刻 `deleteVerificationByIdentifier` 掉（防
   * 枚举），于是第二次请求数到的还是 0 行 → 200。连打两次就能靠状态码
   * 序列 (200,429) vs (200,200) 反推邮箱是否注册——这是限流层自己引入的
   * 新洞：identifier 格式修对之前，计数器是哑的，没有保护也没有泄露；
   * 修对之后才第一次真的开始数到已注册邮箱的行，副作用是让这个差异变得
   * 可观测。
   *
   * 修法（round 2 挪进发信回调，round 3 又挪回 `hooks.before`、但改成
   * **短路返回** `{ success: true }` 而不是 throw——回调里判断会毁掉用户
   * 手里的码，见下面那组测试）：命中限流时不发信、不抛错，响应与端点自己
   * 的防枚举 200 逐字节一致，「被限流」与「邮箱不存在」从外部彻底不可
   * 区分。email-verification 类型**不**这样改，见 auth.ts 里 hooks.before
   * 的注释与 task-12-report.md「为什么 email-verification 保持 429」一节——
   * 结论是 sign-up 端点已经用 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`
   * 直接、单次请求地泄露了同一个事实，这里关不关都不影响攻击者能拿到的
   * 信息，而 /verify 页的重发按钮需要真实的 429 反馈。
   */
  test('已注册与未注册邮箱连打两次 request-password-reset，状态码序列必须完全一致', async () => {
    const registeredEmail = `oracle-reg-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: registeredEmail,
        password: 'hakurei-reimu-514',
        name: 'x',
      }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    const unregisteredEmail = `oracle-ghost-${Date.now()}@example.com`

    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    let regStatuses: number[]
    let ghostStatuses: number[]
    let regBodies: string[]
    let ghostBodies: string[]
    let regTypes: Array<string | null>
    let ghostTypes: Array<string | null>
    try {
      const regFirst = await app.request(
        '/api/auth/email-otp/request-password-reset',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: registeredEmail }),
        },
      )
      const regSecond = await app.request(
        '/api/auth/email-otp/request-password-reset',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: registeredEmail }),
        },
      )
      regStatuses = [regFirst.status, regSecond.status]
      regBodies = [await regFirst.text(), await regSecond.text()]
      regTypes = [
        regFirst.headers.get('content-type'),
        regSecond.headers.get('content-type'),
      ]

      const ghostFirst = await app.request(
        '/api/auth/email-otp/request-password-reset',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: unregisteredEmail }),
        },
      )
      const ghostSecond = await app.request(
        '/api/auth/email-otp/request-password-reset',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: unregisteredEmail }),
        },
      )
      ghostStatuses = [ghostFirst.status, ghostSecond.status]
      ghostBodies = [await ghostFirst.text(), await ghostSecond.text()]
      ghostTypes = [
        ghostFirst.headers.get('content-type'),
        ghostSecond.headers.get('content-type'),
      ]
    } finally {
      spy.mockRestore()
    }

    // 核心属性：限流命中（已注册但被挡）与邮箱未注册，外部必须看到同一种
    // 响应序列——这条断言就是「注册预言机」是否还存在的直接检验。
    // ⚠️ 状态码一致还不够：round 3 起「被限流」走的是 hooks.before 的短路
    // 返回、而不是端点自己的 `ctx.json()`，所以响应体与 content-type 也要
    // 逐字比过，否则换个地方泄露同一个事实
    expect(regStatuses).toEqual(ghostStatuses)
    expect(regStatuses).toEqual([200, 200])
    expect(regBodies).toEqual(ghostBodies)
    expect(regBodies).toEqual(['{"success":true}', '{"success":true}'])
    expect(regTypes).toEqual(ghostTypes)

    // 轰炸防护仍然有效：已注册邮箱两次请求只真的发出一封信，
    // 第二次被限流悄悄吞掉（console 传输让「有没有发信」可观测）
    const regMails = logs.filter(
      (l) => l.includes('[mail:console]') && l.includes(registeredEmail),
    )
    expect(regMails.length).toBe(1)
  })
})

describe('限流不能毁掉用户手里的验证码', () => {
  /**
   * Review round 3 的 Critical：限流层会把用户手里那个**已经发出去的**验证码
   * 弄废。
   *
   * 机制（全部在 better-auth 1.7.2 的源码里，不是推测）：
   *
   * - `findVerificationValue`（`internal-adapter.mjs:739-761`）与
   *   `consumeVerificationValue`（`:818-860`）都按
   *   `sortBy: { createdAt, desc }, limit: 1` 取**该 identifier 最新的一行**，
   *   而且 `consumeVerificationValue` 取完之后 `deleteMany` 把该 identifier
   *   的**所有**行一起删掉。
   * - `resolveOTP`（`email-otp/routes.mjs:31`）在端点内**无条件**先插一行，
   *   然后才轮到 `findUserByEmail` 与 `sendVerificationOTP` 回调。
   *
   * 于是限流判断只要晚于 `resolveOTP`，被拒的那次请求就会留下一行
   * **从未发出去的、但更新的**验证码行。用户输入信箱里那个旧码 →
   * `atomicVerifyOTP` 消费到的是新行 → 不匹配 → `INVALID_OTP`，并且
   * `deleteMany` 把两行一起删光。用户被卡死：信箱里的码已死，冷却窗内又要
   * 不到新码，而错误信息说的是「验证码错误」——把账算在用户头上。
   *
   * 所以限流必须挡在**行被写之前**（`hooks.before` 短路），不能挡在回调里。
   * 这条测试就是那件事的直接检验：第二次请求被限流之后，第一次收到的码
   * 必须仍然能用。
   */
  test('冷却窗内再要一次码，第一次收到的那个码仍然能重置密码', async () => {
    const email = `poison-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      // ① 要一次码：这一封真的发出去了，用户手里拿着它
      await app.request('/api/auth/email-otp/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // ② 冷却窗内点了一次「重新发送」：被限流，不该发信
      await app.request('/api/auth/email-otp/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } finally {
      spy.mockRestore()
    }

    const codes = logs
      .filter((l) => l.includes('[mail:console]') && l.includes(email))
      .map((l) => l.match(/\b(\d{6})\b/)?.[1])
      .filter((v): v is string => Boolean(v))
    // 只发了一封信 —— 轰炸防护仍然有效
    expect(codes.length).toBe(1)

    // ③ 用户输入信箱里那个码。它必须仍然有效
    const reset = await app.request('/api/auth/email-otp/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        otp: codes[0],
        password: 'kirisame-marisa-514',
      }),
    })
    expect(reset.status).toBe(200)
  })
})

describe('countOtpRows 的 identifier 拼接与 better-auth 实际写库一致', () => {
  /**
   * ⚠️ 这条测试不测限流逻辑（上面那组已经测过），测的是 identifier 拼接
   * 格式本身。`toIdentifier()` 镜像的是 better-auth **未导出的内部实现**
   * `toOTPIdentifier()`（`email-otp/utils.mjs`），没有任何类型能保护这处
   * 耦合——格式拼错不会报错，只会让 `countOtpRows` 永远数到 0 行，限流
   * 表现成「永远放行」且不抛异常。
   *
   * 所以这里真实触发一次发码（走注册，会触发 sendVerificationOnSignUp），
   * 再直接断言 `countOtpRows` 对同一个邮箱数得到 ≥ 1 行。如果将来
   * better-auth 升级改了 `toOTPIdentifier` 的格式，这条测试会先红——
   * 而不是让限流在生产上静默失效、没有任何门禁能抓到。
   */
  test('真实发一次验证码后，countOtpRows 对该邮箱数得到 ≥ 1 行', async () => {
    const email = `fmt-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    const n = await countOtpRows('email-verification', email)
    expect(n).toBeGreaterThanOrEqual(1)
  })
})
