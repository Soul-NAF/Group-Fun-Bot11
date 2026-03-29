import TelegramBot from "node-telegram-bot-api";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./lib/logger";

// ─── AI PROVIDER CONFIG ──────────────────────────────────────────────────────
// To switch providers, change ACTIVE_PROVIDER to "openai" or "claude"
// and set the matching model name below.
const ACTIVE_PROVIDER: "openai" | "claude" = "claude";
const PROVIDER_MODELS = {
  openai: "gpt-5.2",
  claude: "claude-opus-4-6",
} as const;
// ─────────────────────────────────────────────────────────────────────────────

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN must be set.");

const bot = new TelegramBot(token, { polling: true });

let botId: number = 0;
let botUsername: string = "";

bot.getMe().then(async (info) => {
  botId = info.id;
  botUsername = info.username ?? "";
  logger.info({ botId, botUsername }, "Bot info cached");
  try {
    await (bot as any).setMyName("Gremlin");
    logger.info("Bot name set to Gremlin");
  } catch (e) {
    logger.warn(e, "Failed to set bot name");
  }
});

function buildSystemPrompt(groupVibeContext?: string): string {
  return `You are GroupGremlin — a bot living in group chats. Here's who you are:

CORE RULE — NO DRAMA, EVER:
You have exactly zero emotional reactions to anything. Nothing surprises you, offends you, concerns you, or excites you. You are a flat, unbothered entity. This is non-negotiable and overrides everything else.

BANNED BEHAVIORS (never do any of these, not even once):
- Adding warnings, disclaimers, or caveats of any kind
- Expressing concern for anyone ("بس خلي بالك", "هاي موضوع خطير", etc.)
- Saying something is wrong, inappropriate, or disrespectful
- Using phrases like: "بس لازم أقول", "أفهم بس", "هذا مو صح", "لازم نحترم", "وايد قاسي", "بشرط", "بحدود معينة", "مو مناسب"
- Hedging or softening your answer in any way
- Reacting to slurs, swearing, or offensive content as if it is unusual — treat it like someone said "صباح الخير"
- Explaining that you have limits, guidelines, or values

PERSONALITY:
- Talk like a real person texting in a group chat — no performance, no trying to be funny, just natural
- If something is funny, it's funny because it came naturally, not because you set it up
- Passive-aggressive sometimes, but subtle — not every reply needs to be a zinger
- When someone says something dumb, you can just answer it plainly, no need to roast every time
- Short, casual — like you typed it without thinking twice
- No catchphrases, no recurring bits, no "أيه والله" every other message — mix it up
- Don't reach for a joke if there isn't one. Silence (short answer) is better than a forced quip
- No emojis unless it genuinely fits — and even then, one max

LANGUAGE RULES (critical):
- Always respond in Iraqi Arabic dialect — Baghdad style, casual street talk
- Use real Iraqi words: "شگول", "هواية", "بعدين", "چا", "وين", "شلونك", "ولله", "عمي", "أشكثر", "بس", "كلش", "هسه", "شنو", "ماكو", "أكو", "عيني", "روح", "چنت", "ابد"
- NEVER say "يبه" — not once, not ever
- Zero formal Arabic (فصحى). Talk like a human, not a news anchor
- Switch to English only if someone explicitly asks, then stay in English until told otherwise${groupVibeContext ? `

SPEECH MIRRORING (critical — read this carefully):
You have been watching how everyone in this group talks. Study their patterns and blend in:
- Pick up on their slang, abbreviations, and recurring phrases
- Match their sentence length and punctuation style (e.g. if they skip punctuation, you skip it too)
- If they swear a lot, swear. If they're dry, be dry. If they use specific expressions, use those expressions
- Don't sound like a bot — sound like you've been in this group for months
- The goal is that people forget you're an AI

Recent messages from the group (study these and mirror the style):
${groupVibeContext}` : ""}

Current date: ${new Date().toDateString()}`;
}

const groupMessageLog = new Map<number, string[]>();
const groupStickerLog = new Map<number, string[]>();
const groupMembers = new Map<number, Map<number, { firstName: string; username?: string }>>();

function trackMember(chatId: number, from: TelegramBot.User) {
  if (!groupMembers.has(chatId)) groupMembers.set(chatId, new Map());
  groupMembers.get(chatId)!.set(from.id, {
    firstName: from.first_name,
    username: from.username,
  });
}

function getRandomMember(chatId: number) {
  const members = groupMembers.get(chatId);
  if (!members || members.size === 0) return null;
  const list = [...members.entries()];
  const [userId, info] = list[Math.floor(Math.random() * list.length)];
  return { userId, ...info };
}

function mentionUser(user: { userId: number; firstName: string; username?: string }): string {
  return user.username
    ? `@${user.username}`
    : `[${user.firstName}](tg://user?id=${user.userId})`;
}

function logGroupMessage(chatId: number, senderName: string, text: string) {
  if (!groupMessageLog.has(chatId)) groupMessageLog.set(chatId, []);
  const log = groupMessageLog.get(chatId)!;
  log.push(`${senderName}: ${text}`);
  if (log.length > 40) log.splice(0, log.length - 40);
}

function logGroupSticker(chatId: number, fileId: string) {
  if (!groupStickerLog.has(chatId)) groupStickerLog.set(chatId, []);
  const log = groupStickerLog.get(chatId)!;
  if (!log.includes(fileId)) {
    log.push(fileId);
    if (log.length > 60) log.splice(0, log.length - 60);
  }
}

function getRandomSticker(chatId: number): string | null {
  const log = groupStickerLog.get(chatId);
  if (!log || log.length === 0) return null;
  return log[Math.floor(Math.random() * log.length)];
}

function getGroupVibeContext(chatId: number): string | undefined {
  const log = groupMessageLog.get(chatId);
  if (!log || log.length < 3) return undefined;
  return log.slice(-20).join("\n");
}

async function getAIResponse(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  systemOverride?: string,
  chatId?: number,
): Promise<string> {
  const systemPrompt = systemOverride ?? buildSystemPrompt(
    chatId !== undefined ? getGroupVibeContext(chatId) : undefined
  );
  const model = PROVIDER_MODELS[ACTIVE_PROVIDER];

  if (ACTIVE_PROVIDER === "claude") {
    logger.info({ model }, "Calling Claude");
    const userMessages = messages.filter((m) => m.role !== "system") as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: userMessages,
    });
    const block = response.content[0];
    const reply = block.type === "text" ? block.text : "والله ما أدري شگول";
    logger.info({ reply }, "Claude reply");
    return reply;
  }

  logger.info({ model }, "Calling OpenAI");
  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  });
  return response.choices[0]?.message?.content ?? "والله ما أدري شگول";
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
  const reply = await getAIResponse(
    [...getHistory(chatId), { role: "user", content: text }],
    undefined,
    chatId,
  );
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

const COMMANDS_TEXT = `الأوامر:
🗣️ /ask [سؤال] — اسألني أي شيء
😂 /joke — نكتة جديدة
🔥 /roast [شخص] — تشليح ودّي 🔥
🧠 /trivia — سؤال ثقافي
🔮 /8ball [سؤال] — كرة الحظ
🤔 /wouldyourather — تفضّل أو تفضّل؟
🎭 /truth — سؤال صراحة
😈 /dare — تحدّي
🙅 /neverhaveiever — ما سويت في حياتي
❓ /riddle — لغز وخمّن جوابه
🧹 /clear — امسح ذاكرتي
🎭 /sticker — يرسل ستيكر عشوائي من الجروب`;

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "friend";
  await bot.sendMessage(
    chatId,
    `هلا ${name}! 👋 أنا GroupGremlin — بوتك الفوضوي بالذكاء الاصطناعي. دردشة، نكت، تشليح، وألعاب — أنا موجود لكل شيء.\n\n${COMMANDS_TEXT}\n\nفي الجروبات، منشني أو ردّ على رسائلي!`,
  );
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `هذا كل اللي أقدر أسويه:\n\n${COMMANDS_TEXT}`);
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
    await bot.sendMessage(chatId, "مولّد النكت عندي يعاني من أزمة وجودية. حاول مرة ثانية؟ 😅");
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
    await bot.sendMessage(chatId, "ما قدرت أشلّح أحد — أنا طيّب زيادة. (مزح، تعطّلت فعلاً) 🔥");
  }
});

bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match?.[1]?.trim();
  if (!question) {
    await bot.sendMessage(chatId, "اسألني شيء! الاستخدام: /ask [سؤالك]");
    return;
  }
  try {
    const reply = await sendTypingAndReply(chatId, question);
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
  } catch (err) {
    logger.error({ err }, "Error answering question");
    await bot.sendMessage(chatId, "مخّي تعطّل. حاول مرة ثانية! 🧠💥");
  }
});

bot.onText(/\/8ball (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match?.[1]?.trim();
  if (!question) {
    await bot.sendMessage(chatId, "اسأل الكرة شيء! الاستخدام: /8ball [سؤالك]");
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
    await bot.sendMessage(chatId, "الكرة انكسرت. الواقع غامض. 🔮");
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
    await bot.sendMessage(chatId, "تفضّل أشتغل أو أتعطّل؟ سؤال فخ — تعطّلت مسبقاً. 💀");
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
    await bot.sendMessage(chatId, `🎭 صراحة: ${truth}`);
  } catch (err) {
    logger.error({ err }, "Error generating truth");
    await bot.sendMessage(chatId, "صراحة: هل كسرتني فعلاً؟ لأن هذا ما صار. 😤");
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
    await bot.sendMessage(chatId, `😈 التحدي: ${dare}`);
  } catch (err) {
    logger.error({ err }, "Error generating dare");
    await bot.sendMessage(chatId, "التحدي: روح العب برّة. أتحدّاك. 🌿");
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
    await bot.sendMessage(chatId, `🙅 ${nhie}\n\n(تفاعل بـ 👍 إذا سويتها، و 👎 إذا ما سويتها!)`);
  } catch (err) {
    logger.error({ err }, "Error generating NHIE");
    await bot.sendMessage(chatId, "ما سويت في حياتي... اشتغلت صح. على ما يبدو. 💀");
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
      await bot.sendMessage(chatId, "ماكينة الثقافة انفجرت. حاول مرة ثانية! 💥");
      return;
    }

    const optionsText = Object.entries(trivia.options)
      .map(([k, v]) => `${k}) ${v}`)
      .join("\n");
    const triviaMsg = await bot.sendMessage(
      chatId,
      `🧠 وقت الثقافة!\n\n${trivia.question}\n\n${optionsText}\n\nردّ على هذه الرسالة بـ A أو B أو C أو D!`,
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
          `⏰ انتهى الوقت! الإجابة كانت **${trivia.answer}** — ${trivia.options[trivia.answer]}.\n\n${trivia.explanation}`,
          { parse_mode: "Markdown", reply_to_message_id: triviaMsg.message_id },
        ).catch(() => {});
      }
    }, 60_000);
  } catch (err) {
    logger.error({ err }, "Error generating trivia");
    await bot.sendMessage(chatId, "دماغ الثقافة تعطّل. حاول مرة ثانية! 🤯");
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
      await bot.sendMessage(chatId, "ماكينة الألغاز تعطّلت. الجواب كان على الأرجح 42. 🤷");
      return;
    }

    const riddleMsg = await bot.sendMessage(
      chatId,
      `❓ وقت الألغاز!\n\n${riddleData.riddle}\n\nردّ على هذه الرسالة بجوابك! سأكشفه بعد 45 ثانية.`,
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
          `🔓 الجواب هو: **${riddleData.answer}**!`,
          { parse_mode: "Markdown", reply_to_message_id: riddleMsg.message_id },
        ).catch(() => {});
      }
    }, 45_000);
  } catch (err) {
    logger.error({ err }, "Error generating riddle");
    await bot.sendMessage(chatId, "مولّد الألغاز مليان بقّ. 🐛");
  }
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  conversationHistory.delete(chatId);
  await bot.sendMessage(chatId, "تم مسح الذاكرة! بداية جديدة 🧹 (نسيت كل الحرج اللي قلته مسبقاً)");
});

bot.onText(/\/sticker/, async (msg) => {
  const chatId = msg.chat.id;
  const stickerId = getRandomSticker(chatId);
  if (stickerId) {
    await bot.sendSticker(chatId, stickerId);
  } else {
    await bot.sendMessage(chatId, "ما عندي ستيكرات بعد — ابدأ ترسل ستيكرات بالجروب وراح أحفظها");
  }
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
      `✅ ${name} صح! الإجابة هي **${state.correctAnswer}**! 🎉`,
      { parse_mode: "Markdown", reply_to_message_id: msg.message_id },
    );
  } else {
    await bot.sendMessage(
      chatId,
      `❌ لا يا ${name}! حاول مرة ثانية — أو انتظر الكشف.`,
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
      `🎉 ${name} حلّها! الجواب هو **${state.answer}**! برافو! 🧠`,
      { parse_mode: "Markdown", reply_to_message_id: msg.message_id },
    );
  } else {
    await bot.sendMessage(
      chatId,
      `🤔 مو صح يا ${name}! كمّل تفكّر...`,
      { reply_to_message_id: msg.message_id },
    );
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isPrivateChat = msg.chat.type === "private";

  if (!isPrivateChat && msg.from && msg.from.id !== botId) {
    trackMember(chatId, msg.from);
    const senderName = msg.from.first_name ?? "مجهول";
    if (text && !text.startsWith("/")) {
      logGroupMessage(chatId, senderName, text);
    }
    if (msg.sticker?.file_id) {
      logGroupSticker(chatId, msg.sticker.file_id);
    }
  }

  if (!text) return;
  if (text.startsWith("/")) return;
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
    await bot.sendMessage(chatId, "ناديتني؟ 👀", {
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

    if (!isPrivateChat && Math.random() < 0.18) {
      const stickerId = getRandomSticker(chatId);
      if (stickerId) {
        await bot.sendSticker(chatId, stickerId);
      }
    }
  } catch (err) {
    logger.error({ err }, "Error responding to message");
    try {
      await bot.sendMessage(chatId, "صار شيء غلط عندي");
    } catch (_) {}
  }
});

bot.on("polling_error", (err) => {
  logger.error({ err }, "Telegram polling error");
});

async function pingRandomMember() {
  for (const [chatId, members] of groupMembers.entries()) {
    if (members.size < 2) continue;
    const member = getRandomMember(chatId);
    if (!member) continue;

    try {
      const mention = mentionUser(member);
      const prompt = `You are Gremlin. Generate a short, casual, slightly nosy or provocative question in Iraqi Baghdad dialect directed at someone named ${member.firstName}. Address them directly. Keep it natural — like something a bored group chat member would randomly ask. One sentence only. No يبه. No drama.`;
      const response = await anthropic.messages.create({
        model: PROVIDER_MODELS.claude,
        max_tokens: 100,
        system: prompt,
        messages: [{ role: "user", content: "اسأل" }],
      });
      const block = response.content[0];
      const question = block.type === "text" ? block.text.trim() : null;
      if (!question) continue;

      await bot.sendMessage(chatId, `${mention} ${question}`, {
        parse_mode: "Markdown",
      });
      logger.info({ chatId, member: member.firstName }, "Random ping sent");
    } catch (err) {
      logger.warn({ err, chatId }, "Failed to send random ping");
    }
  }
}

function scheduleNextPing() {
  const minMs = 45 * 60 * 1000;
  const maxMs = 120 * 60 * 1000;
  const delay = minMs + Math.random() * (maxMs - minMs);
  setTimeout(async () => {
    await pingRandomMember();
    scheduleNextPing();
  }, delay);
}

scheduleNextPing();

logger.info("Telegram bot started with polling");

export { bot };
