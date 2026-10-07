import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { sidecarClient } from '../services/sidecarClient';
import { hasModPermission, noPermissionReply } from './index';

export const data = new SlashCommandBuilder()
  .setName('checkaccess')
  .setDescription('Check a user\'s DiscordGate access status')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to check')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await sidecarClient.getMemberStatus(targetUser.id);

    if (!result) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('User Not Found')
            .setDescription(`No DiscordGate record found for ${targetUser.tag}.`)
            .setColor(0xED4245)
        ]
      });
      return;
    }

    const statusColor = result.status === 'ACTIVE' ? 0x57F287 : 0xED4245;
    const statusEmoji = result.status === 'ACTIVE' ? '✅' : '⛔';

    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji} DiscordGate Access Status`)
      .setColor(statusColor)
      .addFields(
        { name: 'Discord User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
        { name: 'DiscordGate Username', value: result.discord_username, inline: true },
        { name: 'Status', value: result.status, inline: true },
        { name: 'Role', value: result.role, inline: true },
        { name: 'Last Login', value: result.last_login ? new Date(result.last_login).toLocaleString() : 'Never', inline: true },
        { name: 'New API User ID', value: result.new_api_user_id ?? 'Not linked', inline: true },
        { name: 'Created At', value: new Date(result.created_at).toLocaleString(), inline: true },
        { name: 'Updated At', value: new Date(result.updated_at).toLocaleString(), inline: true }
      )
      .setFooter({ text: 'DiscordGate • PROXY-HUB' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('checkaccess error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Error')
          .setDescription('Failed to fetch member status from sidecar.')
          .setColor(0xED4245)
      ]
    });
  }
}