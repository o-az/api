import type { Hono } from 'hono'
import { env } from 'hono/adapter'

import type { Services } from '#/service'
import type { Environment } from '#/types'
import type { IncludeValidator, LimitValidator } from '../validators'

export function mutes(
  leaderboard: Hono<{ Bindings: Environment }>,
  services: Services,
  limitValidator: LimitValidator,
  includeValidator: IncludeValidator
) {
  /**
   * Same as /followers, but for following.
   */
  leaderboard.get('/mutes/:ensOrAddress?', limitValidator, includeValidator, async context => {
    const { ensOrAddress } = context.req.param()
    const { include, limit } = context.req.valid('query')
    const parsedLimit = Number.parseInt(limit as string, 10)
    const mostMutes: { address: string; mutes_count: number }[] = await services
      .efp(env(context))
      .getLeaderboardMutes(parsedLimit)
    return context.json(mostMutes, 200)
  })
}
