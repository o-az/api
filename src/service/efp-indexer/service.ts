import type { Address } from '#/types'
import { sql, type Kysely, type QueryResult } from 'kysely'

import { database } from '#/database'
import type { DB } from '#/types'
import type { ListRecord, TaggedListRecord } from '#/types/list-record'

export interface IEFPIndexerService {
  getFollowersCount(address: Address): Promise<number>
  getFollowers(address: Address): Promise<Address[]>
  getFollowingCount(address: Address): Promise<number>
  getFollowing(address: Address): Promise<TaggedListRecord[]>
  getLeaderboardFollowers(limit: number): Promise<{ address: Address; followers_count: number }[]>
  getLeaderboardFollowing(limit: number): Promise<{ address: Address; following_count: number }[]>
  getListStorageLocation(tokenId: bigint): Promise<`0x${string}` | undefined>
  getListRecordCount(tokenId: bigint): Promise<number>
  getListRecords(tokenId: bigint): Promise<ListRecord[]>
  getListRecordsWithTags(tokenId: bigint): Promise<TaggedListRecord[]>
  getPrimaryList(address: Address): Promise<bigint | undefined>
  // incoming relationship means another list has the given address tagged with the given tag
  getIncomingRelationships(
    address: Address,
    tag: string
  ): Promise<{ token_id: bigint; list_user: Address; tags: string[] }[]>
  // outgoing relationship means the given address has the given tag on another list
  getOutgoingRelationships(address: Address, tag: string): Promise<TaggedListRecord[]>
}

function bufferize(data: Uint8Array | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data.replace('0x', ''), 'hex') : Buffer.from(data)
}

export class EFPIndexerService implements IEFPIndexerService {
  readonly #db: Kysely<DB>

  constructor(env: Env) {
    this.#db = database(env)
  }

  /////////////////////////////////////////////////////////////////////////////
  // Followers
  /////////////////////////////////////////////////////////////////////////////

  async getFollowersCount(address: Address): Promise<number> {
    return new Set(await this.getFollowers(address)).size
  }

  async getFollowers(address: Address): Promise<Address[]> {
    const query = sql`SELECT * FROM query.get_unique_followers__record_type_001(${address})`
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    return result.rows.map((row: any) => row.efp_list_user)
  }

  /////////////////////////////////////////////////////////////////////////////
  // Following
  /////////////////////////////////////////////////////////////////////////////

  async getFollowingCount(address: Address): Promise<number> {
    return new Set(await this.getFollowing(address)).size
  }

  async getFollowing(address: Address): Promise<TaggedListRecord[]> {
    const query = sql`SELECT * FROM query.get_following__record_type_001(${address})`
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    type Row = {
      efp_list_nft_token_id: bigint
      record_version: number
      record_type: number
      following_address: `0x${string}`
      tags: string[]
    }
    const rows: Row[] = result.rows as {
      efp_list_nft_token_id: bigint
      record_version: number
      record_type: number
      following_address: `0x${string}`
      tags: string[]
    }[]

    return rows.map((row: Row) => ({
      version: row.record_version,
      recordType: row.record_type,
      data: bufferize(row.following_address),
      tags: row.tags.sort()
    }))
  }

  /////////////////////////////////////////////////////////////////////////////
  // Leaderboard
  /////////////////////////////////////////////////////////////////////////////

  async getLeaderboardFollowers(limit: number): Promise<{ address: Address; followers_count: number }[]> {
    console.log('limit', limit)
    console.log('typeof limit', typeof limit)
    const query = sql`SELECT * FROM query.get_leaderboard_followers(${limit})`
    console.log(query.compile(this.#db))
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    return result.rows.map((row: any) => ({
      address: row.address,
      followers_count: row.followers_count
    }))
  }

  async getLeaderboardFollowing(limit: number): Promise<{ address: Address; following_count: number }[]> {
    console.log('limit', limit)
    console.log('typeof limit', typeof limit)
    const query = sql`SELECT * FROM query.get_leaderboard_following(${limit})`
    console.log(query.compile(this.#db))
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    return result.rows.map((row: any) => ({
      address: row.address,
      following_count: row.following_count
    }))
  }

  /////////////////////////////////////////////////////////////////////////////
  // List Storage Location
  /////////////////////////////////////////////////////////////////////////////

  async getListStorageLocation(tokenId: bigint): Promise<`0x${string}` | undefined> {
    const result = await this.#db
      .selectFrom('list_nfts')
      .select('list_storage_location')
      .where('token_id', '=', tokenId.toString())
      .executeTakeFirst()
    return (result?.list_storage_location as Address) || undefined
  }

  /////////////////////////////////////////////////////////////////////////////
  // List Records
  /////////////////////////////////////////////////////////////////////////////

  async getListRecords(tokenId: bigint): Promise<ListRecord[]> {
    const query = sql`SELECT * FROM query.get_list_records(${tokenId})`
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }
    console.warn('getListRecords result', result)

    type Row = {
      record_version: number
      record_type: number
      record_data: `0x${string}`
    }

    return (result.rows as Row[]).map((row: Row) => ({
      version: row.record_version,
      recordType: row.record_type,
      data: bufferize(row.record_data)
    }))
  }

  async getListRecordCount(tokenId: bigint): Promise<number> {
    return (await this.getListRecords(tokenId)).length
  }

  async getListRecordsWithTags(tokenId: bigint): Promise<TaggedListRecord[]> {
    const query = sql`SELECT * FROM query.get_list_record_tags(${tokenId})`
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    type Row = {
      record_version: number
      record_type: number
      record_data: `0x${string}` | Uint8Array
      tags: string[]
    }

    return (result.rows as Row[]).map((row: Row) => ({
      version: row.record_version,
      recordType: row.record_type,
      data: bufferize(row.record_data),
      tags: row.tags.sort()
    }))
  }

  async getListRecordsFilterByTags(tokenId: bigint, tag: string): Promise<ListRecord[]> {
    const all: TaggedListRecord[] = await this.getListRecordsWithTags(tokenId)
    return all.filter(record => record.tags.includes(tag))
  }

  /////////////////////////////////////////////////////////////////////////////
  // Relationships
  /////////////////////////////////////////////////////////////////////////////

  async getIncomingRelationships(
    address: `0x${string}`,
    tag: string
  ): Promise<{ token_id: bigint; list_user: `0x${string}`; tags: string[] }[]> {
    const query = sql`
      SELECT * FROM query.get_incoming_relationships(${address}, ${tag})
    `
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    type Row = {
      token_id: bigint
      list_user: Address
      tags: string[]
    }
    const rows: Row[] = result.rows as Row[]

    return rows.map((row: Row) => ({
      token_id: row.token_id,
      list_user: row.list_user,
      tags: row.tags.sort()
    }))
  }

  async getOutgoingRelationships(address: `0x${string}`, tag: string): Promise<TaggedListRecord[]> {
    const query = sql`
      SELECT * FROM query.get_outgoing_relationships(${address}, ${tag})
    `
    const result: QueryResult<unknown> = await query.execute(this.#db)

    if (!result || result.rows.length === 0) {
      return []
    }

    type Row = {
      token_id: bigint
      list_user: Address
      version: number
      record_type: number
      data: `0x${string}`
      tags: string[]
    }
    const rows: Row[] = result.rows as Row[]

    return rows.map((row: Row) => ({
      version: row.version,
      recordType: row.record_type,
      data: bufferize(row.data),
      tags: row.tags.sort()
    }))
  }

  /////////////////////////////////////////////////////////////////////////////
  // Primary List
  /////////////////////////////////////////////////////////////////////////////

  async getPrimaryList(address: Address): Promise<bigint | undefined> {
    // Call the enhanced PostgreSQL function
    const query = sql`SELECT query.get_primary_list(${address}) AS primary_list`
    const result: QueryResult<unknown> = await query.execute(this.#db)
    if (!result || result.rows.length === 0) {
      return undefined
    }

    return (result.rows[0] as { primary_list: bigint }).primary_list
  }
}
