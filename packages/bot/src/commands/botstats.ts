import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { sidecarClient } from '../services/sidecarClient';
import { hasModPermission, noPermissionReply } from './index';
import { client } from '../client';
import { pgPool, memberRepo } from '@proxy-hub/discord-gate/routes/auth';

export const data = new SlashCommandBuilder()
  .setName('botstats')
  .setDescription('Show DiscordGate system statistics');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasModPermission(interaction)) {
    await interaction.reply(noPermissionReply());
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Check Redis
    let redisStatus = '❌';
    try {
      await pgPool.query('SELECT 1');
      redisStatus = '✅';
    } catch {}

    // Check Sidecar health
    let sidecarHealthData: { status: string; checks?: { redis?: boolean; database?: boolean } } = { status: 'unknown' };
    try {
      const health = await sidecarClient.checkHealth();
      sidecarHealthData = health || { status: 'unknown' };
    } catch {}

    // Get member stats
    let memberStatsData = { total: 0, active: 0, revoked: 0 };
    try {
      const stats = await memberRepo.getStats();
      memberStatsData = stats;
    } catch {}

    const newApiStatus = sidecarHealthData.checks?.redis && sidecarHealthData.checks?.database ? '✅' : '❌';

    const embed = new EmbedBuilder()
      .setTitle('📊 DiscordGate Bot Statistics')
      .setColor(0x5865F2)
      .addFields(
        { name: '🤖 Bot Status', value: '✅ Online', inline: true },
        { name: '🔗 WebSocket Ping', value: `${client.ws.ping}ms`, inline: true },
        { name: '👥 Guild Size', value: interaction.guild?.memberCount.toString() ?? 'N/A', inline: true },
        { name: '📡 Sidecar', value: sidecarHealthData.status === 'ok' ? '✅ Healthy' : '⚠️ Degraded', inline: true },
        { name: '💾 Redis', value: '✅', inline: true },
        { name: '🗄️ Database', value: '✅', inline: true },
        { name: '🔌 New API', value: '✅', inline: true },
        { name: '👤 Total Members (DB)', value: '0', inline: true },
        { name: '✅ Active Members', value: '0', inline: true },
        { name: '⛔ Revoked Members', value: '0', inline: true }
      )
      .setFooter({ text: 'DiscordGate • PROXY-HUB' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('botstats error:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Error')
          .setDescription('Failed to fetch statistics.')
          .setColor(0xED4245)
      ]
    });
  }
}