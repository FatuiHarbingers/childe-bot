import type { GuildMember, User } from 'discord.js'
import { container } from '@sapphire/pieces'
import { env } from './environment.js'
import imgur from 'imgur'
import { type Game, type User as TwitchUser } from './Twitch.js'

const ImgurClient = imgur.default

export class ImageManager {
	protected imgur = new ImgurClient( {
		clientId: env.IMGUR_CLIENT_ID,
		clientSecret: env.IMGUR_CLIENT_SECRET
	} )

	protected async findHashedImage( options?: { hashPrefix: string, identifier: string, imagePrefix: string, url: string } ): Promise<string> {
		if ( !options ) return ''
		// Remove {width}x{height} from twitch image urls
		options.url = options.url.replace( '-{width}x{height}', '' )
		const [ hash ] = options.url.split( /\//g ).pop()
			?.match( /^[0-9a-f-]+/ ) ?? []
		if ( !hash ) return options.url

		const { redis } = container
		const storedHash = await redis.get( `${ options.hashPrefix }/${ options.identifier }` )
		if ( storedHash === hash ) {
			const storedImage = await redis.get( `${ options.imagePrefix }/${ storedHash }` )
			if ( storedImage ) return storedImage
		} else if ( storedHash ) {
			await redis.del( `${ options.imagePrefix }/${ storedHash }` )
		}

		const image = await this.imgur.upload( { image: options.url } )

		void container.redis.set( `${ options.hashPrefix }/${ options.identifier }`, hash )
		void container.redis.set( `${ options.imagePrefix }/${ hash }`, image.data.link )

		return image.data.link
	}

	public getTwitchGameImage( game: Game | null ): string | Promise<string> {
		if ( !game ) return ''
		return this.findHashedImage( {
			hashPrefix: 'twitch:game',
			identifier: game.name,
			imagePrefix: 'twitch:game-image',
			url: game.box_art_url
		} )
	}

	public getTwitchUserAvatar( user: TwitchUser | null ): string | Promise<string> {
		if ( !user ) return ''
		return this.findHashedImage( {
			hashPrefix: 'twitch:user',
			identifier: user.login,
			imagePrefix: 'twitch:user-avatar',
			url: user.profile_image_url
		} )
	}

	public getUserAvatar( user: GuildMember | User | null ): string | Promise<string> {
		if ( !user ) return ''
		return this.findHashedImage( {
			hashPrefix: 'discord:user-avatar-hash',
			identifier: user.id,
			imagePrefix: 'discord:user-avatar',
			url: user.displayAvatarURL( { forceStatic: false, size: 256 } )
		} )
	}
}
