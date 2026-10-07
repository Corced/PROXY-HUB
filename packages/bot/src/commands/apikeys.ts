import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction } from 'discord.js';
import { sidecarClient } from '../services/sidecarClient';
import { hasModPermission, noPermissionReply } from './index';
import { getAuditRepo } from '@proxy-hub/discord-gate/db/repositories/discordAuditRepository';

export const data = new SlashCommandBuilder()
  .setName('apikeys')
  .setDescription('Check or revoke a user\'s New API API keys')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to check')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('action')
      .setDescription('Action to perform')
      .setRequired(true)
      .addChoices(
        { name: 'View Keys', value: 'view' },
        { name: 'Revoke All Keys', value: 'revoke' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const action = interaction.options.getString('action', true);

  await interaction.deferReply({ ephemeral: true });

  try {
    // First, find the New API user ID via sidecar
    const memberStatus = await sidecarClient.getMemberStatus(targetUser.id);

    if (!memberStatus || !memberStatus.new_api_user_id) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('User Not Linked')
            .setDescription(`${targetUser.tag} does not have a linked New API account.`)
            .setColor(0xFAA61A)
        ]
      });
      return;
    }

    const newApiUserId = parseInt(memberStatus.new_api_user_id, 10);

    if (action === 'view') {
      // Get the list of API keys from New API via sidecar
      const keysResponse = await sidecarClient.get<{ data: { items: any[] } | any[] }>(`/internal/member/${targetUser.id}/keys`);
      const data = keysResponse?.data;
      const tokens = Array.isArray(data) ? data : (data?.items || []);

      if (tokens.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('API Keys')
              .setDescription(`${targetUser.tag} has no API keys.`)
              .setColor(0x5865F2)
              .addFields(
                { name: 'New API User ID', value: newApiUserId.toString(), inline: true }
              )
          ]
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔑 API Keys for ${targetUser.tag}`)
        .setColor(0x5865F2)
        .addFields(
          { name: 'New API User ID', value: newApiUserId.toString(), inline: true },
          { name: 'Total Keys', value: tokens.length.toString(), inline: true }
        )
        .setFooter({ text: 'DiscordGate • PROXY-HUB' })
        .setTimestamp();

      // Add each key as a field (masked)
      for (const token of tokens) {
        const maskedKey = token.key.length > 8
          ? token.key.substring(0, 4) + '...' + token.key.substring(token.key.length - 4)
          : '****';

        const statusEmoji = token.status === 1 ? '✅' : '❌';
        const unlimited = token.unlimited_quota ? '∞' : `${token.remain_quota}`;

        embed.addFields({
          name: `${statusEmoji} ${token.name || 'Unnamed'}`,
          value: `Key: \`${maskedKey}\`\nID: ${token.id} | Quota: ${unlimited} | Used: ${token.used_quota} | Status: ${token.status === 1 ? 'Active' : 'Inactive'}`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } else if (action === 'revoke') {
      // Show confirmation
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm API Key Revocation')
        .setDescription(
          `Are you sure you want to revoke **ALL** API keys for **${targetUser.tag}**?\n\n` +
          `This will:\n` +
          `• Delete all ${targetUser.tag}'s API keys from New API\n` +
          `• Log each revocation in the audit trail\n` +
          `• Not affect their DiscordGate session (use /revokeaccess for that)`
        )
        .setColor(0xED4245)
        .setFooter({ text: 'This action cannot be undone.' });

      const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction } = await import('discord.js');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('apikeys_revoke_confirm')
          .setLabel('Yes, Revoke All Keys')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('apikeys_revoke_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      try {
        const filter = (i: any) => i.user.id === interaction.user.id;
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

        const confirmation = await new Promise<any>((resolve) => {
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

        if (confirmation.customId === 'apikeys_revoke_cancel') {
          await confirmation.update({
            embeds: [
              new EmbedBuilder()
                .setTitle('Cancelled')
                .setDescription('API key revocation cancelled.')
                .setColor(0x5865F2)
            ],
            components: [],
          });
          return;
        }

        await confirmation.update({
          embeds: [
            new EmbedBuilder()
              .setTitle('Revoking API Keys...')
              .setDescription(`Revoking all API keys for ${targetUser.tag}...`)
              .setColor(0xFAA61A)
          ],
          components: [],
        });

        // Revoke all API keys via sidecar
        const revokeResult = await sidecarClient.post<{ success: boolean; sessionsRevoked: number; keysRevoked: number }>('/internal/revoke-member', {
          discordId: targetUser.id,
          reason: 'manual_apikeys_revoke',
        });

        const keysRevoked = revokeResult?.keysRevoked || 0;

        // Log manual revoke
        const { getAuditRepo } = await import('@proxy-hub/discord-gate/db/repositories/discordAuditRepository');
        const auditRepo = getAuditRepo();
        await auditRepo.log({
          eventType: 'MANUAL_REVOKE',
          discordId: targetUser.id,
          newApiUserId: String(newApiUserId),
          metadata: { reason: 'manual_apikeys_revoke', keysRevoked },
        });

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ API Keys Revoked')
          .setDescription(`Successfully revoked **${keysRevoked}** API key(s) for **${targetUser.tag}**.`)
          .setColor(0x57F287)
          .addFields(
            { name: 'Keys Revoked', value: keysRevoked.toString(), inline: true },
            { name: 'New API User ID', value: newApiUserId.toString(), inline: true }
          )
          .setFooter({ text: 'DiscordGate • PROXY-HUB' })
          .setTimestamp();

        await confirmation.update({ embeds: [successEmbed], components: [] });
      } catch (error) {
        console.error('apikeys revoke error:', error);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ Error')
              .setDescription('Failed to revoke API keys. Check logs.')
              .setColor(0xED4245)
          ],
          components: [],
        });
      }
    }
  } catch (error) {
    console.error('apikeys error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Error')
          .setDescription('Failed to complete API keys operation.')
          .setColor(0xED4245)
      ]
    });
  }
}