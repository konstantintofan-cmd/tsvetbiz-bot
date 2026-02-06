const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "tsvetbiz";

if (!BOT_TOKEN || !WEBAPP_URL || !GROUP_CHAT_ID) {
  throw new Error("Missing environment variables");
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const hookPath = `/telegraf/${WEBHOOK_SECRET}`;

bot.start((ctx) => {
  ctx.reply(
    "ЦветБизнес 🌿\nОткрой мини-приложение и рассчитай налоги или оставь заявку.",
    Markup.inlineKeyboard([
      Markup.button.webApp("Открыть ЦветБизнес", WEBAPP_URL),
    ])
  );
});

bot.on("message", async (ctx) => {
  const wad = ctx.message?.web_app_data;
  if (!wad?.data) return;

  let data;
  try {
    data = JSON.parse(wad.data);
  } catch {
    data = { raw: wad.data };
  }

  let text = `🌸 Заявка · ЦветБизнес\n`;

  if (data.type === "consult") {
    text +=
      `\n🧑‍💼 Консультация\n` +
      `Имя: ${data.name || "—"}\n` +
      `Телефон: ${data.phone || "—"}\n` +
      `Вопрос: ${data.question || "—"}`;
  } else if (data.type === "calc") {
    text +=
      `\n🧾 Расчёт\n` +
      `Доход: ${data.income} ₽\n` +
      `Расходы: ${data.costs} ₽\n` +
      `Прибыль: ${data.profit} ₽\n` +
      `Налог: ${data.tax} ₽\n` +
      `Режим: ${data.modeName}`;
  } else {
    text += `\nДанные:\n${JSON.stringify(data, null, 2)}`;
  }

  await ctx.telegram.sendMessage(GROUP_CHAT_ID, text);
  await ctx.reply("✅ Готово! Заявка отправлена.");
});

app.post(hookPath, (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) {
    await bot.telegram.setWebhook(`${url}${hookPath}`);
  }
  console.log("Bot running");
});
