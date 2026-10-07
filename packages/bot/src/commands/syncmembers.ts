import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { redisClient } from '@proxy-hub/discord-gate/db/redis';
import { syncScheduler } from '@proxy-hub/discord-gate/services/syncScheduler';
import { hasModPermission, noPermissionReply } from './index';

export const data = new SlashCommandBuilder()
  .setName('syncmembers')
  .setDescription('Manually trigger Discord guild member sync (reconciliation)');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  // Rate limit: once per 10 minutes per user
  const rateLimitKey = `syncmembers:ratelimit:${interaction.user.id}`;
  const lastRun = await redisClient.get(rateLimitKey);

  if (lastRun) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Rate Limited')
          .setDescription('You can only run syncmembers once every 10 minutes.')
          .setColor(0xFAA61A)
      ],
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Set rate limit
  await redisClient.setex(rateLimitKey, 600, Date.now().toString());

  const embed = new EmbedBuilder()
    .setTitle('🔄 Syncing Members...')
    .setDescription('Fetching guild members and comparing with database...')
    .setColor(0xFAA61A);

  await interaction.editReply({ embeds: [embed] });

  try {
    const result = await syncScheduler.runSync();

    const statusColor = result.revoked > 0 ? 0xFAA61A : 0x57F287;
    const statusText = result.revoked > 0 ? 'Sync Complete (Revoked)' : 'Sync Complete (No Changes)';

    const embed = new EmbedBuilder()
      .setTitle(statusText)
      .setColor(statusText === 'Sync Complete (Revoked)' ? 0xFAA61A : 0x57F287)
      .addFields(
        { name: 'Guild Members', value: result.guildSize.toString(), inline: true },
        { name: 'DB Active Members', value: result.dbSize.toString(), inline: true },
        { name: 'Revoked This Sync', value: result.revoked.toString(), inline: true }
      )
      .setFooter({ text: 'DiscordGate • PROXY-HUB' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('syncmembers error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Sync Failed')
          .setDescription('Failed to complete member synchronization.')
          .setColor(0xED4245)
      ]
    });
  }
}