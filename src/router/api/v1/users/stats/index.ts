import type { Hono } from 'hono'
import type { Services } from '#/service'
import type { IEFPIndexerService } from '#/service/efp-indexer/service'
import type { IENSMetadataService } from '#/service/ens-metadata/service'
import type { Address, Environment } from '#/types'

export function stats(users: Hono<{ Bindings: Environment }>, services: Services) {
  users.get('/:ensOrAddress/stats', async context => {
    const { ensOrAddress } = context.req.param()

    const ens: IENSMetadataService = services.ens()
    const efp: IEFPIndexerService = services.efp(context.env)
    const address: Address = await ens.getAddress(ensOrAddress)
    const followersCount: number = await efp.getFollowersCount(address)
    const stats = {
      followers_count: followersCount,
      following_count: 0
    }

    const primaryList: bigint | undefined = await efp.getPrimaryList(address)
    if (primaryList === undefined) {
      return context.json(stats, 200)
    }

    stats.following_count = await efp.getListRecordCount(primaryList)
    return context.json(stats, 200)
  })
}