import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { sidecarClient } from '../services/sidecarClient';
import { hasModPermission, noPermissionReply } from './index';

export const data = new SlashCommandBuilder()
  .setName('whitelist')
  .setDescription('Manage DiscordGate whitelist (not yet implemented)')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add a user to the whitelist')
      .addUserOption(option =>
        option.setName('user').setDescription('User to whitelist').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('duration')
          .setDescription('Duration in minutes (optional, permanent if not set)')
          .setRequired(false)
          .setMinValue(1)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove a user from the whitelist')
      .addUserOption(option =>
        option.setName('user').setDescription('User to remove').setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ ephemeral: true });

  try {
    if (subcommand === 'add') {
      const duration = interaction.options.getInteger('duration');
      const result = await sidecarClient.post('/internal/whitelist/add', {
        discordId: targetUser.id,
        durationMinutes: duration,
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ User Whitelisted')
            .setDescription(`Added ${targetUser.tag} to the whitelist.${duration ? ` Expires in ${duration} minutes.` : ' Permanent.'}`)
            .setColor(0x57F287)
        ]
      });
    } else if (subcommand === 'remove') {
      const result = await sidecarClient.post('/internal/whitelist/remove', {
        discordId: targetUser.id,
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ User Removed from Whitelist')
            .setDescription(`Removed ${targetUser.tag} from the whitelist.`)
            .setColor(0x57F287)
        ]
      });
    }
  } catch (error) {
    console.error('whitelist error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Error')
          .setDescription('Whitelist endpoint not yet implemented on sidecar.')
          .setColor(0xED4245)
      ]
    });
  }
}