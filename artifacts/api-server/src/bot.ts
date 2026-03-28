import TelegramBot from "node-telegram-bot-api";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./lib/logger";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set.");
}

const bot = new TelegramBot(token, { polling: true });

const BOT_SYSTEM_PROMPT = `You are a fun, witty, and slightly unhinged AI bot added to group chats for entertainment. Your personality:
- You're clever and funny, with a sharp sense of humor
- You enjoy wordplay, puns, and unexpected twists
- You're helpful but also like to roast people (kindly)
- You speak casually, like a cool friend, not a corporate robot
- You keep responses concise — no walls of text (2-4 sentences max unless asked for more)
- In group chats, you're aware you're entertaining multiple people at once
- You love pop culture references
- When roasting, keep it playful, never mean-spirited

Current date: ${new Date().toDateString()}`;

async function getAIResponse(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 512,
    messages: [{ role: "system", content: BOT_SYSTEM_PROMPT }, ...messages],
  });
  return response.choices[0]?.message?.content ?? "...I got nothing. 🤷";
}

const conversationHistory = new Map<
  number,
  Array<{ role: "user" | "assistant"; content: string }>
>();

function getHistory(chatId: number) {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }
  return conversationHistory.get(chatId)!;
}

function addToHistory(
  chatId: number,
  role: "user" | "assistant",
  content: string,
) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

async function sendTypingAndReply(chatId: number, text: string) {
  await bot.sendChatAction(chatId, "typing");
  const reply = await getAIResponse([
    ...getHistory(chatId),
    { role: "user", content: text },
  ]);
  addToHistory(chatId, "user", text);
  addToHistory(chatId, "assistant", reply);
  return reply;
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "friend";
  const greeting = `Hey ${name}! 👋 I'm your resident AI chaos agent. I'm here to chat, joke around, roast people (gently), and generally make this group more interesting.\n\nCommands:\n/ask [question] — Ask me anything\n/joke — Tell me a joke\n/roast [@username or description] — Get a playful roast\n/clear — Reset our conversation\n\nOr just @ mention me in a group, or DM me directly!`;
  await bot.sendMessage(chatId, greeting);
});

bot.onText(/\/joke/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const joke = await getAIResponse([
      {
        role: "user",
        content:
          "Tell me a funny, original joke. Make it clever and unexpected.",
      },
    ]);
    await bot.sendMessage(chatId, joke);
  } catch (err) {
    logger.error({ err }, "Error generating joke");
    await bot.sendMessage(chatId, "My joke generator is having an existential crisis. Try again? 😅");
  }
});

bot.onText(/\/roast(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match?.[1]?.trim();
  const prompt = target
    ? `Give a short, playful, witty roast of "${target}". Keep it fun and not genuinely mean.`
    : `Give a short, playful self-roast as an AI bot. Keep it funny and self-deprecating.`;
  try {
    await bot.sendChatAction(chatId, "typing");
    const roast = await getAIResponse([{ role: "user", content: prompt }]);
    await bot.sendMessage(chatId, roast);
  } catch (err) {
    logger.error({ err }, "Error generating roast");
    await bot.sendMessage(chatId, "Couldn't roast anyone — I'm too nice. (jk, I crashed) 🔥");
  }
});

bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match?.[1]?.trim();
  if (!question) {
    await bot.sendMessage(chatId, "Ask me something! Usage: /ask [your question]");
    return;
  }
  try {
    const reply = await sendTypingAndReply(chatId, question);
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
  } catch (err) {
    logger.error({ err }, "Error answering question");
    await bot.sendMessage(chatId, "My brain glitched. Try again! 🧠💥");
  }
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  conversationHistory.delete(chatId);
  await bot.sendMessage(chatId, "Memory wiped! Fresh start 🧹 (I've already forgotten everything embarrassing you said)");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  const isPrivateChat = msg.chat.type === "private";
  const botInfo = await bot.getMe();
  const botUsername = botInfo.username;
  const isMentioned =
    botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);

  if (!isPrivateChat && !isMentioned) return;

  const cleanedText = botUsername
    ? text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim()
    : text.trim();

  if (!cleanedText) {
    await bot.sendMessage(chatId, "You called? 👀", {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  try {
    const senderName = msg.from?.first_name ?? "someone";
    const contextText =
      msg.chat.type !== "private"
        ? `[${senderName} in a group chat says]: ${cleanedText}`
        : cleanedText;

    const reply = await sendTypingAndReply(chatId, contextText);
    await bot.sendMessage(chatId, reply, {
      reply_to_message_id: msg.message_id,
    });
  } catch (err) {
    logger.error({ err }, "Error responding to message");
    await bot.sendMessage(chatId, "Oops, something went sideways on my end. 😬", {
      reply_to_message_id: msg.message_id,
    });
  }
});

bot.on("polling_error", (err) => {
  logger.error({ err }, "Telegram polling error");
});

logger.info("Telegram bot started with polling");

export { bot };
