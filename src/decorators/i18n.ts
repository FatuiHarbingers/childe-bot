import { type ApplicationCommandRegistry, container } from '@sapphire/framework'
import { type ApplicationCommandOptionData, type ChatInputApplicationCommandData, Locale } from 'discord.js'
import { env } from '#lib/environment'
import { s } from '@sapphire/shapeshift'
import type { TFunction } from 'i18next'

type i18nCollection = {
	[ key in Locale | 'es-419' ]?: TFunction
} & { 'en-US': TFunction }

const localize = ( i18n: i18nCollection, target: ChatInputApplicationCommandData | ApplicationCommandOptionData, prefix: string ) => {
	const en = i18n[ 'en-US' ]
	target.description = en( `${ prefix }.description` )
	target.name = en( `${ prefix }.name` )

	target.descriptionLocalizations ??= {} // eslint-disable-line @typescript-eslint/no-unnecessary-condition
	target.nameLocalizations ??= {} // eslint-disable-line @typescript-eslint/no-unnecessary-condition

	for ( const [ _locale, t ] of Object.entries( i18n ) ) {
		const locale = _locale as Locale
		target.descriptionLocalizations[ locale ] = t( `${ prefix }.description` )
		target.nameLocalizations[ locale ] = t( `${ prefix }.name` )
	}

	if ( !( 'options' in target ) ) return

	for ( const option of target.options ) {
		localize( i18n, option, `${ prefix }.options.${ option.name }` )
	}
}

const isCommandData = ( command: Parameters<ApplicationCommandRegistry[ 'registerChatInputCommand' ]>[ 0 ] ): command is ChatInputApplicationCommandData => !( 'toJSON' in command )

export const i18n = ( _target: unknown, methodName: string, descriptor: PropertyDescriptor ) => {
	if ( methodName !== 'registerApplicationCommands' ) {
		throw new Error( 'i18n decorator must only be used in the registerApplicationCommands method.' )
	}

	let command: Parameters<ApplicationCommandRegistry[ 'registerChatInputCommand' ]>[ 0 ] | undefined
	let options: ApplicationCommandRegistry.RegisterOptions | undefined
	const registryMock = {
		registerChatInputCommand: ( ...args: Parameters<ApplicationCommandRegistry[ 'registerChatInputCommand' ]> ) => {
			[ command, options ] = args
		}
	}

	const original = descriptor.value as ( registry: typeof registryMock ) => void
	descriptor.value = function( registry: ApplicationCommandRegistry ) {
		original.call( this, registryMock )

		if ( !command || !isCommandData( command ) ) return

		const { languages } = container.i18n
		const validateLocale = s.nativeEnum( Locale ).or( s.literal( 'es-419' as const ) )

		const i18n: i18nCollection = {
			'en-US': container.i18n.getT( 'en-US' )
		}
		for ( const [ _lang, translate ] of languages ) {
			const lang = validateLocale.parse( _lang )
			if ( lang === Locale.EnglishUS ) continue
			i18n[ lang ] = translate
		}

		localize( i18n, command, `commands:${ command.name }` )

		options ??= {}
		if ( env.NODE_ENV === 'development' ) {
			options.guildIds = [ env.DISCORD_DEVELOPMENT_SERVER ]
		}
		registry.registerChatInputCommand( command, options )
	}
}
