import { apiLogger } from '#/logger'
import { arrayToChunks, isAddress, raise } from '#/utilities.ts'
import type { ENSProfile } from './types'

import { type Kysely, type QueryResult, sql } from 'kysely'

import { database } from '#/database'

import type { Address, DB } from '#/types'
import type { Environment } from '#/types/index'
import { S3Cache } from './s3-cache'
// import { truncate } from 'fs'

export type ENSProfileResponse = ENSProfile & { type: 'error' | 'success' }

export interface IENSMetadataService {
  getAddress(ensNameOrAddress: Address | string): Promise<Address>
  getENSProfile(ensNameOrAddress?: Address | string): Promise<ENSProfile>
  batchGetENSProfiles(ensNameOrAddressArray: Array<Address | string>): Promise<ENSProfileResponse[]>
  getENSAvatar(ensNameOrAddress: Address | string): Promise<string>
  batchGetENSAvatars(ensNameOrAddressArray: Array<Address | string>): Promise<{ [ensNameOrAddress: string]: string }>
}

type Row = {
  name: string
  address: `0x${string}`
  avatar: string
}

export class ENSMetadataService implements IENSMetadataService {
  readonly #db: Kysely<DB>
  readonly #env: Environment

  // biome-ignore lint/correctness/noUndeclaredVariables: <explanation>
  constructor(env: Env) {
    this.#db = database(env)
    this.#env = env
  }

  url = 'https://ens.efp.workers.dev'
  async getAddress(ensNameOrAddress: Address | string): Promise<Address> {
    // check if it already is a valid type
    if (isAddress(ensNameOrAddress)) {
      return ensNameOrAddress.toLowerCase() as Address
    }

    return (await this.getENSProfile(ensNameOrAddress)).address.toLowerCase() as Address
  }

  async checkCache(ensNameOrAddress: Address | string): Promise<ENSProfile | boolean> {
    const nameQuery = sql<Row>`SELECT * FROM query.get_ens_metadata_by_name(${ensNameOrAddress.toLowerCase()})`
    const nameResult = await nameQuery.execute(this.#db)
    if (nameResult.rows.length > 0) {
      return nameResult.rows[0] as ENSProfile
    }
    const query = sql<Row>`SELECT * FROM query.get_ens_metadata_by_address(${ensNameOrAddress.toLowerCase()})`
    const result = await query.execute(this.#db)
    if (result.rows.length > 0) {
      return result.rows[0] as ENSProfile
    }
    return false
  }

  async cacheRecord(profile: ENSProfile): Promise<boolean> {
    //if profile.records.avatar then set profile.avatar to value
    const cacheService = new S3Cache(this.#env)
    let newAvatar = '' as string
    if (profile.avatar) {
      newAvatar = await cacheService.cacheImage(profile.avatar, profile.address)
      if (newAvatar !== '') profile.avatar = newAvatar
    }
    const nameData = ENSMetadataService.#toTableRow(profile)
    const result = await this.#db.insertInto('ens_metadata').values(nameData).executeTakeFirst()
    if (result.numInsertedOrUpdatedRows === BigInt(0)) {
      return false
    }
    return true
  }

  /**
   * TODO:
   * currently our ENS metadata service can return a non-200 response with a JSON body
   * We should read that body and throw an error with the message
   */
  async getENSProfile(ensNameOrAddress: Address | string): Promise<ENSProfile> {
    if (ensNameOrAddress === undefined) {
      raise('ENS name or address is required')
    }

    const cachedProfile = await this.checkCache(ensNameOrAddress)
    if (!cachedProfile) {
      //silently cache fetched profile without waiting ->
      const response = await fetch(`${this.url}/u/${ensNameOrAddress}`)
      if (response.ok) {
        // raise(`invalid ENS name: ${ensNameOrAddress}`)
        const ensProfileData = (await response.json()) as ENSProfile
        await this.cacheRecord(ensProfileData)
        return ensProfileData as ENSProfile
      }
      return {
        name: '',
        address: ensNameOrAddress,
        avatar: null
      } as unknown as ENSProfile
    }
    return cachedProfile as ENSProfile
  }

  /**
   * TODO: break into batches of 10
   * path should be /u/batch
   */
  async batchGetENSProfiles(ensNameOrAddressArray: Array<Address | string>): Promise<ENSProfileResponse[]> {
    if (ensNameOrAddressArray.length > 10) {
      // apiLogger.warn('more than 10 ids provided, this will be broken into batches of 10')
    }

    const addressArrayWithCache = await ensNameOrAddressArray.reduce(async (accumulator, address) => {
      const cacheRecord = await this.checkCache(address)
      if (!cacheRecord) {
        return { ...(await accumulator), [address]: null }
      }
      return { ...(await accumulator), [address]: cacheRecord }
    }, {})

    const cacheArray = Object.values(addressArrayWithCache) as ENSProfileResponse[]
    const filteredCache = cacheArray.filter(address => address !== null)

    if (ensNameOrAddressArray.length === filteredCache.length) return cacheArray

    // Splits the input array into chunks of 10 for batch processing.
    // Each batch is then formatted into a string query parameter.
    const formattedBatches = arrayToChunks(ensNameOrAddressArray, 10).map(batch =>
      batch
        .map(id => {
          if (!Object.values(addressArrayWithCache).includes(id)) {
            return `queries[]=${id}`
          }
          return ''
        })
        .join('&')
    )

    // Performs parallel fetch requests for each batch and waits for all to complete.
    const response = await Promise.all(
      formattedBatches.map(batch => {
        return fetch(`${this.url}/bulk/u?${batch}`)
      })
    )

    // Checks if any response is not OK (indicating a fetch failure), and if so, raises an exception.
    if (response.some(response => !response.ok)) {
      raise(`contains invalid ENS name: ${JSON.stringify(ensNameOrAddressArray)}`)
    }

    // Processes each response as JSON and flattens the result into a single array.
    const data = (await Promise.all(response.map(response => response.json()))) as {
      response_length: number
      response: ENSProfileResponse
    }[]

    // Returns the combined results from all batches.
    const fetchedRecords = data.flatMap(datum => datum.response)
    for (const record of fetchedRecords) {
      await this.cacheRecord(record)
    }

    return [...fetchedRecords, ...filteredCache]
  }

  async getENSAvatar(ensNameOrAddress: Address | string): Promise<string> {
    if (ensNameOrAddress === undefined) raise('ENS name or address is required')
    const response = await fetch(`${this.url}/i/${ensNameOrAddress}`, {
      redirect: 'follow'
    })
    if (!response.ok) raise(`invalid ENS name: ${ensNameOrAddress}`)
    return response.url
  }

  /**
   * TODO: implement this in the ENS metadata service worker
   * path should be /i/batch
   */
  async batchGetENSAvatars(
    ensNameOrAddressArray: Array<Address | string>
  ): Promise<{ [ensNameOrAddress: string]: string }> {
    const responses = await Promise.all(
      ensNameOrAddressArray.map(ensNameOrAddress => fetch(`${this.url}/i/${ensNameOrAddress}`, { redirect: 'follow' }))
    )
    return responses.reduce((accumulator, response, index) => {
      const id = `${ensNameOrAddressArray[index]}`
      if (!response.ok) {
        apiLogger.error(`invalid ENS name: ${ensNameOrAddressArray[index]}`)
        return {
          ...accumulator,
          [id]: 'https://app.ethfollow.xyz/assets/gradient-circle.svg'
        }
      }
      return { ...accumulator, [id]: response.url }
    }, {})
  }

  static #toTableRow(namedata: ENSProfile): {
    name: string
    address: string
    avatar: string | undefined
  } {
    return {
      name: namedata.name,
      address: namedata.address.toLowerCase(),
      avatar: namedata?.avatar
    }
  }
}
