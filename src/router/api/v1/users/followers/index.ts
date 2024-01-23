import type { Hono } from 'hono'
import { env } from 'hono/adapter'
import type { Services } from '#/service'
import type { Address, Environment } from '#/types'

export function followers(users: Hono<{ Bindings: Environment }>, services: Services) {
  users.get('/:ensOrAddress/followers', async context => {
    const { ensOrAddress } = context.req.param()

    const address: Address = await services.ens().getAddress(ensOrAddress)
    const followers = await services.efp(env(context)).getFollowers(address)
    return context.json(
      {
        followers: followers.map(({ follower, tags, isFollowing, isBlocked, isMuted }) => ({
          follower,
          tags,
          is_following: isFollowing,
          is_blocked: isBlocked,
          is_muted: isMuted
        }))
      },
      200
    )
  })
}
