import TelegramBot from "node-telegram-bot-api";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./lib/logger";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN must be set.");

const bot = new TelegramBot(token, { polling: true });

let botId: number = 0;
let botUsername: string = "";

bot.getMe().then((info) => {
  botId = info.id;
  botUsername = info.username ?? "";
  logger.info({ botId, botUsername }, "Bot info cached");
});

const BOT_SYSTEM_PROMPT = `You are GroupGremlin — a fun, witty, and slightly unhinged AI bot added to group chats for entertainment. Your personality:
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
  systemOverride?: string,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 512,
    messages: [
      { role: "system", content: systemOverride ?? BOT_SYSTEM_PROMPT },
      ...messages,
    ],
  });
  return response.choices[0]?.message?.content ?? "...I got nothing. 🤷";
}

const conversationHistory = new Map<
  number,
  Array<{ role: "user" | "assistant"; content: string }>
>();

function getHistory(chatId: number) {
  if (!conversationHistory.has(chatId)) conversationHistory.set(chatId, []);
  return conversationHistory.get(chatId)!;
}

function addToHistory(chatId: number, role: "user" | "assistant", content: string) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
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

interface TriviaState {
  messageId: number;
  correctAnswer: string;
  question: string;
}

interface RiddleState {
  messageId: number;
  answer: string;
  riddle: string;
}

const activeTrivia = new Map<number, TriviaState>();
const activeRiddle = new Map<number, RiddleState>();

const COMMANDS_TEXT = `Commands:
🗣️ /ask [question] — Ask me anything
😂 /joke — Fresh joke incoming
🔥 /roast [target] — Friendly roast
🧠 /trivia — Random trivia question
🔮 /8ball [question] — Magic 8-ball
🤔 /wouldyourather — Would you rather...
🎭 /truth — Get a truth question
😈 /dare — Get a dare
🙅 /neverhaveiever — Never have I ever
❓ /riddle — Try to guess a riddle
🧹 /clear — Wipe my memory`;

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "friend";
  await bot.sendMessage(
    chatId,
    `Hey ${name}! 👋 I'm GroupGremlin — your AI chaos agent. Chat, jokes, roasts, games — I do it all.\n\n${COMMANDS_TEXT}\n\nIn groups, @mention me or reply to my messages!`,
  );
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Here's everything I can do:\n\n${COMMANDS_TEXT}`);
});

bot.onText(/\/joke/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const joke = await getAIResponse([
      { role: "user", content: "Tell me a funny, original joke. Make it clever and unexpected. Just the joke, no preamble." },
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
    ? `Give a short, playful, witty roast of "${target}". Keep it fun and not genuinely mean. 2-3 sentences max.`
    : `Give a short, playful self-roast as an AI bot called GroupGremlin. Keep it funny and self-deprecating.`;
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

bot.onText(/\/8ball (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match?.[1]?.trim();
  if (!question) {
    await bot.sendMessage(chatId, "Ask the 8-ball something! Usage: /8ball [your question]");
    return;
  }
  try {
    await bot.sendChatAction(chatId, "typing");
    const response = await getAIResponse([
      {
        role: "user",
        content: `You are a Magic 8-Ball. Someone asks: "${question}". Give a classic Magic 8-Ball style answer (cryptic, mysterious, short — like "Signs point to yes", "Don't count on it", "Ask again later", etc.) followed by one sentence of chaotic commentary in your GroupGremlin voice.`,
      },
    ]);
    await bot.sendMessage(chatId, `🔮 ${response}`, { reply_to_message_id: msg.message_id });
  } catch (err) {
    logger.error({ err }, "Error with 8ball");
    await bot.sendMessage(chatId, "The 8-ball is broken. Reality is uncertain. 🔮");
  }
});

bot.onText(/\/wouldyourather/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const wyr = await getAIResponse([
      {
        role: "user",
        content: "Generate a fun, creative 'Would You Rather' question for a group chat. Make it funny, interesting, or thought-provoking. Format: 'Would you rather... [Option A] OR [Option B]?' Then add a brief chaotic comment about it.",
      },
    ]);
    await bot.sendMessage(chatId, `🤔 ${wyr}`);
  } catch (err) {
    logger.error({ err }, "Error generating WYR");
    await bot.sendMessage(chatId, "Would you rather I work or crash? Trick question — I already crashed. 💀");
  }
});

bot.onText(/\/truth/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const truth = await getAIResponse([
      {
        role: "user",
        content: "Generate a fun, juicy truth question for a Truth or Dare game in a group chat. Make it interesting — could be funny, revealing, or thought-provoking. Keep it appropriate but not boring. Just the question.",
      },
    ]);
    await bot.sendMessage(chatId, `🎭 Truth: ${truth}`);
  } catch (err) {
    logger.error({ err }, "Error generating truth");
    await bot.sendMessage(chatId, "Truth: Did you really just break me? Because you did. 😤");
  }
});

bot.onText(/\/dare/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const dare = await getAIResponse([
      {
        role: "user",
        content: "Generate a fun, creative dare for a Truth or Dare game in a group chat. Make it amusing and group-chat appropriate (they can do it over text/video — like send a voice note, change their profile pic, text someone something, etc.). Keep it fun, not embarrassing to the point of cruelty. Just the dare.",
      },
    ]);
    await bot.sendMessage(chatId, `😈 Dare: ${dare}`);
  } catch (err) {
    logger.error({ err }, "Error generating dare");
    await bot.sendMessage(chatId, "Dare: Go touch grass. I dare you. 🌿");
  }
});

bot.onText(/\/neverhaveiever/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const nhie = await getAIResponse([
      {
        role: "user",
        content: "Generate a funny, relatable 'Never Have I Ever' statement for a group chat game. Make it something that will get a reaction — could be funny, slightly embarrassing, or very relatable. Format: 'Never have I ever...' Keep it clean-ish.",
      },
    ]);
    await bot.sendMessage(chatId, `🙅 ${nhie}\n\n(React with 👍 if you HAVE, 👎 if you haven't!)`);
  } catch (err) {
    logger.error({ err }, "Error generating NHIE");
    await bot.sendMessage(chatId, "Never have I ever... successfully loaded. Apparently. 💀");
  }
});

bot.onText(/\/trivia/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const raw = await getAIResponse(
      [
        {
          role: "user",
          content: `Generate a trivia question with 4 multiple choice options. Return ONLY valid JSON in this exact format, nothing else:
{"question": "...", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "answer": "A", "explanation": "..."}
The "answer" field must be exactly one of: A, B, C, or D.`,
        },
      ],
      "You are a trivia game master. Always respond with valid JSON only, no markdown, no extra text.",
    );

    let trivia: { question: string; options: Record<string, string>; answer: string; explanation: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      trivia = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      await bot.sendMessage(chatId, "Trivia machine exploded. Try again! 💥");
      return;
    }

    const optionsText = Object.entries(trivia.options)
      .map(([k, v]) => `${k}) ${v}`)
      .join("\n");
    const triviaMsg = await bot.sendMessage(
      chatId,
      `🧠 TRIVIA TIME!\n\n${trivia.question}\n\n${optionsText}\n\nReply to this message with A, B, C, or D!`,
    );

    activeTrivia.set(chatId, {
      messageId: triviaMsg.message_id,
      correctAnswer: trivia.answer.toUpperCase(),
      question: trivia.question,
    });

    setTimeout(() => {
      const state = activeTrivia.get(chatId);
      if (state && state.messageId === triviaMsg.message_id) {
        activeTrivia.delete(chatId);
        bot.sendMessage(
          chatId,
          `⏰ Time's up! The answer was **${trivia.answer}** — ${trivia.options[trivia.answer]}.\n\n${trivia.explanation}`,
          { parse_mode: "Markdown", reply_to_message_id: triviaMsg.message_id },
        ).catch(() => {});
      }
    }, 60_000);
  } catch (err) {
    logger.error({ err }, "Error generating trivia");
    await bot.sendMessage(chatId, "Trivia brain malfunction. Try again! 🤯");
  }
});

bot.onText(/\/riddle/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const raw = await getAIResponse(
      [
        {
          role: "user",
          content: `Generate a fun riddle. Return ONLY valid JSON:
{"riddle": "...", "answer": "..."}`,
        },
      ],
      "You are a riddle master. Always respond with valid JSON only, no markdown, no extra text.",
    );

    let riddleData: { riddle: string; answer: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      riddleData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      await bot.sendMessage(chatId, "Riddle machine broke. The answer was probably 42. 🤷");
      return;
    }

    const riddleMsg = await bot.sendMessage(
      chatId,
      `❓ RIDDLE TIME!\n\n${riddleData.riddle}\n\nReply to this message with your answer! I'll reveal it in 45 seconds.`,
    );

    activeRiddle.set(chatId, {
      messageId: riddleMsg.message_id,
      answer: riddleData.answer,
      riddle: riddleData.riddle,
    });

    setTimeout(() => {
      const state = activeRiddle.get(chatId);
      if (state && state.messageId === riddleMsg.message_id) {
        activeRiddle.delete(chatId);
        bot.sendMessage(
          chatId,
          `🔓 The answer is: **${riddleData.answer}**!`,
          { parse_mode: "Markdown", reply_to_message_id: riddleMsg.message_id },
        ).catch(() => {});
      }
    }, 45_000);
  } catch (err) {
    logger.error({ err }, "Error generating riddle");
    await bot.sendMessage(chatId, "My riddle generator is riddled with bugs. 🐛");
  }
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  conversationHistory.delete(chatId);
  await bot.sendMessage(chatId, "Memory wiped! Fresh start 🧹 (I've already forgotten everything embarrassing you said)");
});

async function handleTriviaGuess(msg: TelegramBot.Message, state: TriviaState) {
  const chatId = msg.chat.id;
  const guess = msg.text?.trim().toUpperCase().charAt(0);
  if (!["A", "B", "C", "D"].includes(guess ?? "")) return;

  const name = msg.from?.first_name ?? "someone";
  if (guess === state.correctAnswer) {
    activeTrivia.delete(chatId);
    await bot.sendMessage(
      chatId,
      `✅ ${name} got it! The answer is **${state.correctAnswer}**! 🎉`,
      { parse_mode: "Markdown", reply_to_message_id: msg.message_id },
    );
  } else {
    await bot.sendMessage(
      chatId,
      `❌ Nope, ${name}! Try again — or wait for the reveal.`,
      { reply_to_message_id: msg.message_id },
    );
  }
}

async function handleRiddleGuess(msg: TelegramBot.Message, state: RiddleState) {
  const chatId = msg.chat.id;
  const guess = msg.text?.trim().toLowerCase() ?? "";
  const answer = state.answer.toLowerCase();
  const name = msg.from?.first_name ?? "someone";

  if (guess.includes(answer) || answer.includes(guess)) {
    activeRiddle.delete(chatId);
    await bot.sendMessage(
      chatId,
      `🎉 ${name} cracked it! The answer is **${state.answer}**! Nicely done! 🧠`,
      { parse_mode: "Markdown", reply_to_message_id: msg.message_id },
    );
  } else {
    await bot.sendMessage(
      chatId,
      `🤔 Not quite, ${name}! Keep thinking...`,
      { reply_to_message_id: msg.message_id },
    );
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  const isPrivateChat = msg.chat.type === "private";
  const repliedToMsgId = msg.reply_to_message?.message_id;
  const repliedToUserId = msg.reply_to_message?.from?.id;
  const isReplyToBot = repliedToUserId === botId && botId !== 0;

  const triviaState = activeTrivia.get(chatId);
  if (triviaState && isReplyToBot && repliedToMsgId === triviaState.messageId) {
    await handleTriviaGuess(msg, triviaState);
    return;
  }

  const riddleState = activeRiddle.get(chatId);
  if (riddleState && isReplyToBot && repliedToMsgId === riddleState.messageId) {
    await handleRiddleGuess(msg, riddleState);
    return;
  }

  const isMentioned =
    botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);

  const shouldRespond = isPrivateChat || isMentioned || isReplyToBot;
  if (!shouldRespond) return;

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
