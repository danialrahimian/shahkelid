import config from "../../config";

/**
 * The few Telegram Bot API calls the store makes: who the bot is, who wrote
 * to it (to find the chats to alert), and sending a message.
 *
 * Calls go from the server, which is abroad: Telegram is filtered in Iran,
 * and staff testing a bot from there still get a real answer.
 */

type TelegramReply<T> = { ok: boolean; result?: T; description?: string };

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

const call = async <T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${config.alerts.telegramApiUrl}/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TelegramError(`Telegram could not be reached: ${(error as Error).message}`);
  }
  const reply = (await response.json().catch(() => ({ ok: false }))) as TelegramReply<T>;
  if (!reply.ok || reply.result === undefined) {
    throw new TelegramError(reply.description ?? `Telegram answered HTTP ${response.status}`);
  }
  return reply.result;
};

/** The bot's own @username: proof the token is right. */
export const botUsername = async (token: string) =>
  (await call<{ username: string }>(token, "getMe")).username;

type Update = {
  message?: { chat: Chat };
  channel_post?: { chat: Chat };
  my_chat_member?: { chat: Chat };
};
type Chat = { id: number; title?: string; first_name?: string; last_name?: string; username?: string };

/** Everyone who has written to the bot lately, or added it to a group: the chats it can reach. */
export const recentChats = async (token: string) => {
  const updates = await call<Update[]>(token, "getUpdates");
  const chats = new Map<string, string>();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
    if (!chat) continue;
    const title =
      chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : String(chat.id)));
    chats.set(String(chat.id), title);
  }
  return [...chats].map(([id, title]) => ({ id, title }));
};

export const sendTelegramMessage = (token: string, chatId: string, text: string) =>
  call<unknown>(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
