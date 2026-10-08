const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
      res.on('error', reject);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers] });

client.login(process.env.DISCORD_TOKEN).then(async () => {
  await client.guilds.fetch();
  const gSource = client.guilds.cache.get('1450489519068418131');
  const gTarget = client.guilds.cache.get('1544275485096284213');

  if (!gSource || !gTarget) {
    console.error('Could not find both guilds!');
    process.exit(1);
  }

  const sourceEmojis = await gSource.emojis.fetch();
  const targetEmojis = await gTarget.emojis.fetch();
  const vtEmojis = sourceEmojis.filter(e => e.name && e.name.startsWith('vt_'));

  console.log(`Found ${vtEmojis.size} vt_ emojis in source guild (${gSource.name}). Target currently has ${targetEmojis.size} emojis.`);

  const newEmojiMap = {};

  for (const [id, emoji] of vtEmojis) {
    // Check if target already has an emoji with this name
    const existing = targetEmojis.find(e => e.name === emoji.name);
    if (existing) {
      console.log(`[EXISTS] ${emoji.name} already in target as ${existing.id}`);
      newEmojiMap[emoji.name] = existing.id;
      continue;
    }

    try {
      console.log(`[MIGRATING] Downloading ${emoji.name} from ${emoji.url}...`);
      const imgBuffer = await download(emoji.url);
      console.log(`[CREATING] Creating ${emoji.name} in target guild...`);
      const created = await gTarget.emojis.create({ attachment: imgBuffer, name: emoji.name });
      console.log(`[SUCCESS] Created ${emoji.name} with ID ${created.id}`);
      newEmojiMap[emoji.name] = created.id;
      await sleep(1000); // 1s delay
    } catch (err) {
      console.error(`[ERROR] Failed to migrate ${emoji.name}:`, err.message);
    }
  }

  console.log('Migration to target complete. Summary of new emoji IDs:');
  console.log(JSON.stringify(newEmojiMap, null, 2));

  // Now delete from source guild
  console.log('Deleting migrated vt_ emojis from source guild...');
  for (const [id, emoji] of vtEmojis) {
    if (newEmojiMap[emoji.name]) {
      try {
        await emoji.delete('Migrated to target guild 1544275485096284213');
        console.log(`[DELETED] Deleted ${emoji.name} (${id}) from source guild.`);
        await sleep(500);
      } catch (err) {
        console.error(`[DELETE ERROR] Failed to delete ${emoji.name}:`, err.message);
      }
    }
  }

  const outDir = path.resolve('scratch');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'migrated_emojis.json'), JSON.stringify(newEmojiMap, null, 2));
  console.log('Finished! Saved to scratch/migrated_emojis.json');
  process.exit(0);
});
