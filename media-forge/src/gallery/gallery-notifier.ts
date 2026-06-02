// media-forge/src/gallery/gallery-notifier.ts
// Concrete Notifier implementations for margin alerts (F-I).
import type { Notifier } from './margin-alert.js';
import { logger } from '../core/logger.js';

/** Notifier via Telegram Bot API. Requires GALLERY_ALERT_TELEGRAM_TOKEN + GALLERY_ALERT_TELEGRAM_CHAT_ID. */
export function createTelegramNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const token = env['GALLERY_ALERT_TELEGRAM_TOKEN'];
  const chatId = env['GALLERY_ALERT_TELEGRAM_CHAT_ID'];
  if (!token || !chatId) {
    // Graceful degradation: log locally without sending.
    return {
      async send(subject: string, body: string): Promise<void> {
        logger.warn('[margin-alert] Notifier not configured (GALLERY_ALERT_TELEGRAM_TOKEN/CHAT_ID absent)', {
          subject,
          body,
        });
      },
    };
  }
  return {
    async send(subject: string, body: string): Promise<void> {
      const text = encodeURIComponent(`${subject}\n\n${body}`);
      const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${text}`;
      const res = await fetch(url);
      if (!res.ok) logger.error('[margin-alert] Telegram send failed', { status: res.status });
    },
  };
}

/** No-op notifier — for tests and self-host without alert configuration. */
export const noopNotifier: Notifier = {
  async send(): Promise<void> {},
};
