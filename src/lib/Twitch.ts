import { container } from '@sapphire/pieces'
import { env } from './environment.js'
import { request } from 'undici'

export interface Broadcaster {
	broadcaster_language: string
	broadcaster_login: string
	display_name: string
	game_id: string
	game_name: string
	id: string
	is_live: boolean
	tags: string[]
	thumbnail_url: string
	title: string
	started_at: string
}

export interface Game {
	box_art_url: string
	id: string
	igdb_id: string
	name: string
}

export interface Stream {
	id: string
	game_id: string
	game_name: string
	is_mature: boolean
	language: string
	started_at: string
	tags: string[]
	thumbnail_url: string
	title: string
	user_id: string
	user_login: string
	user_name: string
	viewer_count: number
}

export interface User {
	broadcaster_type: 'affiliate' | 'partner' | ''
	created_at: string
	description: string
	display_name: string
	id: string
	login: string
	offline_image_url: string
	profile_image_url: string
	type: 'admin' | 'global_mod' | 'staff' | ''
}

export class Twitch {
	private accessToken = ''
	private tokenExpiry = 0

	public async init(): Promise<void> {
		const { redis } = container
		const token = await redis.get( 'twitch:access-token' )
		const expiry = await redis.get( 'twitch:token-expiry' )
		if ( !token || !expiry ) {
			await this.refreshToken()
			return
		}

		this.accessToken = token
		this.tokenExpiry = parseInt( expiry, 10 )
	}

	private async availableToken(): Promise<void> {
		if ( Date.now() <= this.tokenExpiry ) return
		await this.refreshToken()
	}

	private async refreshToken(): Promise<void> {
		const now = Date.now()
		const { body } = await request( 'https://id.twitch.tv/oauth2/token', {
			body: `client_id=${ env.TWITCH_CLIENT }&client_secret=${ env.TWITCH_SECRET }&grant_type=client_credentials`,
			headers: {
				'content-type': 'application/x-www-form-urlencoded'
			},
			method: 'POST'
		} )
		const res = await body.json() as {
			access_token: string
			expires_in: number
			token_type: string
		}

		this.accessToken = res.access_token
		this.tokenExpiry = now + res.expires_in * 1000

		const { redis } = container
		await redis.set( 'twitch:access-token', this.accessToken )
		await redis.set( 'twitch:token-expiry', this.tokenExpiry )
	}

	public async get( url: string, query: Record<string, string | number | string[] | number[]> ): Promise<unknown> {
		await this.availableToken()

		const params = Object.entries( query ).map( ( [ key, value ] ) => {
			if ( typeof value === 'string' || typeof value === 'number' ) return `${ key }=${ value }`
			return value.map( v => `${ key }=${ v }` ).join( '&' )
		} )
			.join( '&' )
		const { body } = await request( `https://api.twitch.tv/helix/${ url }?${ params }`, {
			headers: {
				'Client-Id': env.TWITCH_CLIENT,
				authorization: `Bearer ${ this.accessToken }`,
				'content-type': 'application/x-www-form-urlencoded'
			}
		} )
		return body.json()
	}

	public async getGame( gameId: string ): Promise<Game | null> {
		const req = await this.get( 'games', {
			id: gameId
		} ) as { data: Game[] }
		return req.data.at( 0 ) ?? null
	}

	public async getStreams( users: string[] ): Promise<Stream[]> {
		const req = await this.get( 'streams', {
			first: 100,
			user_login: users
		} ) as { data: Stream[] }
		return req.data
	}

	public async getUser( user: string ): Promise<User | null> {
		const req = await this.get( 'users', {
			login: user
		} ) as { data: User[] }
		return req.data.at( 0 ) ?? null
	}

	public async getUserStream( user: string ): Promise<Stream | null> {
		const req = await this.getStreams( [ user ] )
		return req.at( 0 ) ?? null
	}

	public async searchStreams( input: string ): Promise<Broadcaster[]> {
		const req = await this.get( 'search/channels', {
			query: input
		} ) as { data: Broadcaster[] }
		return req.data
	}
}
