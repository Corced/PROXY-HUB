import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction, MessageComponentInteraction } from 'discord.js';
import { sidecarClient } from '../services/sidecarClient';
import { hasModPermission, noPermissionReply } from './index';

export const data = new SlashCommandBuilder()
  .setName('revokeaccess')
  .setDescription('Revoke a user\'s DiscordGate access (sessions + API keys)')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to revoke access for')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Reason for revocation')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? 'Manual revocation by moderator';

  // First, show confirmation
  const confirmEmbed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Access Revocation')
    .setDescription(
      `Are you sure you want to revoke **${targetUser.tag}**'s access?\n\n` +
      `This will:\n` +
      `• Revoke all active sessions\n` +
      `• Revoke all New API API keys\n` +
      `• Disable their New API account\n` +
      `• Mark them as REVOKED in DiscordGate\n\n` +
      `**Reason:** ${reason}`
    )
    .setColor(0xED4245)
    .setFooter({ text: 'This action cannot be easily undone.' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('revoke_confirm')
      .setLabel('Yes, Revoke Access')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('revoke_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });

  // Wait for button interaction using a collector
  try {
    const filter = (i: MessageComponentInteraction) => i.user.id === interaction.user.id;
    const collector = interaction.channel?.createMessageComponentCollector({ filter, time: 30000, max: 1 });

    if (!collector) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Error')
            .setDescription('Could not create button collector.')
            .setColor(0xED4245)
        ],
        components: [],
      });
      return;
    }

    const confirmation = await new Promise<MessageComponentInteraction | null>((resolve) => {
      collector.on('collect', resolve);
      collector.on('end', () => resolve(null));
    });

    if (!confirmation) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Timed Out')
            .setDescription('Confirmation timed out.')
            .setColor(0xFAA61A)
        ],
        components: [],
      });
      return;
    }

    if (confirmation.customId === 'revoke_cancel') {
      await confirmation.update({
        embeds: [
          new EmbedBuilder()
            .setTitle('Cancelled')
            .setDescription('Access revocation cancelled.')
            .setColor(0x5865F2)
        ],
        components: [],
      });
      return;
    }

    // User confirmed - proceed with revocation
    await confirmation.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('Revoking Access...')
          .setDescription(`Revoking access for ${targetUser.tag}...`)
          .setColor(0xFAA61A)
      ],
      components: [],
    });

    const result = await sidecarClient.revokeMember({
      discordId: targetUser.id,
      reason: 'manual',
    });

    if (!result) {
      await confirmation.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Revocation Failed')
            .setDescription('Sidecar returned no result. Check logs for details.')
            .setColor(0xED4245)
        ],
      });
      return;
    }

    // Success - show results
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Access Revoked')
      .setDescription(`Successfully revoked access for **${targetUser.tag}**.`)
      .setColor(0x57F287)
      .addFields(
        { name: 'Sessions Revoked', value: result.sessionsRevoked.toString(), inline: true },
        { name: 'API Keys Revoked', value: result.keysRevoked.toString(), inline: true },
        { name: 'Reason', value: 'manual', inline: false }
      )
      .setFooter({ text: 'DiscordGate • PROXY-HUB' })
      .setTimestamp();

    await confirmation.editReply({ embeds: [successEmbed] });
  } catch (error) {
    console.error('revokeaccess error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Error')
          .setDescription('Failed to complete revocation. Check logs.')
          .setColor(0xED4245)
      ],
      components: [],
    });
  }
}