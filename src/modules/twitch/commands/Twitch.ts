import { type ApplicationCommandOptionData, ApplicationCommandOptionType, type AutocompleteInteraction, ChannelType, type ChatInputCommandInteraction, type Interaction } from 'discord.js'
import { type ApplicationCommandRegistry, Command, type CommandOptions } from '@sapphire/framework'
import { ApplyOptions } from '@sapphire/decorators'
import { Colors } from '@bitomic/material-colors'
import { hyperlink } from '@discordjs/builders'
import { i18n } from '#decorators/i18n'
import { resolveKey } from '@sapphire/plugin-i18next'
import { twitchFollows } from '#drizzle/schema'
import { and, eq } from 'drizzle-orm'

@ApplyOptions<CommandOptions>( {
	enabled: true,
	name: 'twitch'
} )
export class UserCommand extends Command {
	@i18n
	public override registerApplicationCommands( registry: ApplicationCommandRegistry ): void {
		registry.registerChatInputCommand( {
			description: this.description,
			dmPermission: false,
			name: this.name,
			options: [
				{
					description: '',
					name: 'list',
					type: ApplicationCommandOptionType.Subcommand
				},
				{
					description: '',
					name: 'add',
					options: [
						{
							autocomplete: true,
							description: '',
							maxLength: 25,
							minLength: 4,
							name: 'streamer',
							required: true,
							type: ApplicationCommandOptionType.String
						},
						{
							channelTypes: [ ChannelType.GuildText ],
							description: '',
							name: 'channel',
							type: ApplicationCommandOptionType.Channel
						}
					],
					type: ApplicationCommandOptionType.Subcommand
				},
				{
					description: '',
					name: 'remove',
					options: [ {
						autocomplete: true,
						description: '',
						maxLength: 25,
						minLength: 4,
						name: 'streamer',
						required: true,
						type: ApplicationCommandOptionType.String
					} ],
					type: ApplicationCommandOptionType.Subcommand
				},
				{
					description: '',
					name: 'mention',
					options: [ {
						description: '',
						name: 'role',
						type: ApplicationCommandOptionType.Role
					} ],
					type: ApplicationCommandOptionType.Subcommand
				}
			] satisfies ApplicationCommandOptionData[]
		} )
	}

	protected async hasPermissions( interaction: Interaction<'cached'>, reply = false ) {
		const hasPermissions = interaction.memberPermissions.has( 'ManageGuild' )

		if ( reply && !hasPermissions && interaction.isCommand() ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'errors:missing-permissions'
			}, { permissions: await resolveKey( interaction, 'misc:permissions.manage-guild' ) } )
			void interaction.reply( {
				embeds: [ embed ]
			} )
		}

		return hasPermissions
	}

	public override async autocompleteRun( interaction: AutocompleteInteraction<'cached'> ) {
		if ( !await this.hasPermissions( interaction ) ) {
			void interaction.respond( [] )
			return
		}

		const subcommand = interaction.options.getSubcommand()
		const focused = interaction.options.getFocused()

		if ( subcommand === 'add' ) {
			if ( focused.length < 4 || focused.length > 25 ) {
				void interaction.respond( [] )
				return
			}
			const users = await this.container.twitch.searchStreams( focused )
			void interaction.respond( users.map( user => ( {
				name: user.display_name,
				value: user.broadcaster_login
			} ) ) )
			return
		} else if ( subcommand === 'remove' ) {
			const key = this.getRedisKey( interaction.guildId )
			const cached = ( await this.container.redis.smembers( key ) ).filter( i => i.startsWith( focused ) )
			if ( cached.length ) {
				void interaction.respond( cached.map( i => ( {
					name: i,
					value: i
				} ) ) )
				return
			}

			const stored = ( await this.container.drizzle
				.select( {
					user: twitchFollows.user
				} )
				.from( twitchFollows )
				.where( eq( twitchFollows.guild, interaction.guildId ) ) )
				.map( i => i.user )
				.filter( i => i.startsWith( focused ) )

			if ( stored.length ) {
				await this.container.redis.sadd( key, ...stored )
				void interaction.respond( stored.map( i => ( {
					name: i,
					value: i
				} ) ) )
				return
			}
		}

		void interaction.respond( [] )
	}

	public override chatInputRun( interaction: ChatInputCommandInteraction<'cached'> ): void {
		const subcommand = interaction.options.getSubcommand()

		if ( subcommand === 'add' ) {
			void this.add( interaction )
		} else if ( subcommand === 'list' ) {
			void this.list( interaction )
		} else if ( subcommand === 'remove' ) {
			void this.remove( interaction )
		} else if ( subcommand === 'mention' ) {
			void this.mention( interaction )
		}
	}

	protected async add( interaction: ChatInputCommandInteraction<'cached'> ): Promise<void> {
		if ( !await this.hasPermissions( interaction, true ) ) return

		const streamer = interaction.options.getString( 'streamer', true )
		const channel = interaction.options.getChannel( 'channel' ) ?? interaction.channel
		if ( !channel || channel.type !== ChannelType.GuildText ) {
			const embed = await this.container.utilities.embed.i18n(
				interaction,
				{
					color: Colors.amber.s800,
					description: 'errors:bad-channel'
				},
				{
					channel: channel?.id,
					type: await resolveKey( interaction, 'misc:channel-types.text' )
				}
			)
			void interaction.reply( {
				embeds: [ embed ]
			} )
			return
		}

		const [ alreadyStored ] = await this.container.drizzle.select()
			.from( twitchFollows )
			.where( and(
				eq( twitchFollows.guild, interaction.guildId ),
				eq( twitchFollows.user, streamer )
			) )
			.limit( 1 )

		if ( alreadyStored ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'errors:twitch-already-added'
			}, { user: streamer } )
			void interaction.reply( {
				embeds: [ embed ]
			} )
			return
		}

		const user = await this.container.twitch.getUser( streamer )
			.catch( () => null )
		if ( !user ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'errors:twitch-not-found'
			}, { user: streamer } )
			void interaction.reply( {
				embeds: [ embed ]
			} )
			return
		}

		const row = await this.container.drizzle.insert( twitchFollows )
			.values( {
				channel: channel.id,
				guild: interaction.guildId,
				user: user.login
			} )
			.catch( () => null )
		const key = this.getRedisKey( interaction.guildId )
		await this.container.redis.sadd( key, user.login )

		if ( !row ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'errors:twitch-db-error'
			}, { user: streamer } )
			void interaction.reply( {
				embeds: [ embed ]
			} )
			return
		}

		const embed = await this.container.utilities.embed.i18n(
			interaction,
			{
				color: Colors.deepPurple.a400,
				description: 'twitch:add-success'
			},
			{
				channel: channel.id,
				user: streamer
			}
		)
		void interaction.reply( {
			embeds: [ embed ]
		} )
	}

	protected async list( interaction: ChatInputCommandInteraction<'cached'> ): Promise<void> {
		await interaction.deferReply()

		const streams = await this.container.drizzle.select()
			.from( twitchFollows )
			.where( eq( twitchFollows.guild, interaction.guildId ) )

		if ( streams.length === 0 ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.deepPurple.a400,
				description: 'twitch:list-none'
			} )
			void interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const groups = streams.reduce( ( list, stream ) => {
			const exists = list.has( stream.channel )
			const channel = list.get( stream.channel ) ?? []
			channel.push( stream )
			if ( !exists ) list.set( stream.channel, channel )
			return list
		}, new Map<string, Array<typeof twitchFollows.$inferSelect>>() )
		const list = [ ...groups.entries() ].map( ( [ channel, streams ] ) => {
			const links = streams.map( stream => {
				const url = `https://twitch.tv/${ stream.user }`
				const link = hyperlink( stream.user, url )
				return `- ${ link }`
			} ).join( '\n' )
			return `## <#${ channel }>\n${ links }`
		} ).join( '\n' )
		const embed = await this.container.utilities.embed.i18n( interaction, {
			color: Colors.deepPurple.a400,
			description: list,
			title: 'twitch:list-title'
		} )
		void interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	protected async remove( interaction: ChatInputCommandInteraction<'cached'> ): Promise<void> {
		if ( !await this.hasPermissions( interaction, true ) ) return

		const user = interaction.options.getString( 'streamer', true )
		const [ row ] = await this.container.drizzle.select()
			.from( twitchFollows )
			.where( and(
				eq( twitchFollows.guild, interaction.guildId ),
				eq( twitchFollows.user, user )
			) )
			.limit( 1 )

		if ( !row ) {
			const embed = await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'twitch:remove-fail'
			}, { user } )
			void interaction.reply( {
				embeds: [ embed ]
			} )
			return
		}

		await this.container.drizzle.delete( twitchFollows )
			.where( and(
				eq( twitchFollows.channel, row.channel ),
				eq( twitchFollows.user, row.user )
			) )
		const key = this.getRedisKey( interaction.guildId )
		await this.container.redis.srem( key, row.user )

		const embed = await this.container.utilities.embed.i18n( interaction, {
			color: Colors.green.s800,
			description: 'twitch:remove-success'
		}, { user } )
		void interaction.reply( {
			embeds: [ embed ]
		} )
	}

	protected async mention( interaction: ChatInputCommandInteraction<'cached'> ): Promise<void> {
		const role = interaction.options.getRole( 'role' )
		const { drizzle } = this.container

		if ( !role ) {
			await drizzle.update( twitchFollows )
				.set( {
					mentions: []
				} )
				.where( eq( twitchFollows.guild, interaction.guildId ) )
			await this.container.utilities.embed.i18n( interaction, {
				color: Colors.amber.s800,
				description: 'twitch:mention-removed'
			}, null, true )
			return
		}

		await drizzle.update( twitchFollows )
			.set( {
				mentions: [ role.rawPosition === 0 ? '0' : role.id ]
			} )
			.where( eq( twitchFollows.guild, interaction.guildId ) )
		await this.container.utilities.embed.i18n( interaction, {
			color: Colors.amber.s800,
			description: 'twitch:mention-added'
		}, null, true )
	}

	protected getRedisKey( guild: string ): string {
		return `ajax:twitch-follows/${ guild }`
	}
}
