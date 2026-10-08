import { Bot } from './app/Bot';

async function bootstrap() {
  const bot = new Bot();
  await bot.start();
}

bootstrap().catch((error) => {
  console.error('💥 Fatal error during VoidTune startup:', error);
  process.exit(1);
});
