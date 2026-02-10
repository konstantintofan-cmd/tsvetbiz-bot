const express = require("express");
const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "tsvetbiz";

// Для Telegram Payments (ЮKassa через BotFather -> Payments)
const YOOKASSA_PROVIDER_TOKEN = process.env.YOOKASSA_PROVIDER_TOKEN;

// Цена (разово)
const PRICE_RUB = 500;
const PRICE_KOPEKS = PRICE_RUB * 100; // Telegram принимает в "копейках" для RUB

if (!BOT_TOKEN || !WEBAPP_URL || !GROUP_CHAT_ID) {
  throw new Error("Missing environment variables: BOT_TOKEN / WEBAPP_URL / GROUP_CHAT_ID");
}
if (!YOOKASSA_PROVIDER_TOKEN) {
  throw new Error("Missing environment variable: YOOKASSA_PROVIDER_TOKEN");
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ---------- Хранилище оплат (paid_users.json) ----------
const PAID_DB_FILE = path.join(__dirname, "paid_users.json");

function loadPaidDb() {
  try {
    if (!fs.existsSync(PAID_DB_FILE)) return {};
    const raw = fs.readFileSync(PAID_DB_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("Failed to load paid db:", e);
    return {};
  }
}

function savePaidDb(db) {
  try {
    fs.writeFileSync(PAID_DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save paid db:", e);
  }
}

let paidDb = loadPaidDb();

function isPaid(userId) {
  return Boolean(paidDb[String(userId)]);
}

function setPaid(userId, payload = {}) {
  paidDb[String(userId)] = {
    paidAt: new Date().toISOString(),
    ...payload,
  };
  savePaidDb(paidDb);
}

// ---------- UI ----------
function paidKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.webApp("✅ Открыть ЦветБизнес", WEBAPP_URL),
    Markup.button.url("💬 Консультация", "https://t.me/Afina_72"),
  ]);
}

function notPaidKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback(`💳 Оплатить ${PRICE_RUB} ₽ (разово)`, "BUY_ACCESS"),
    Markup.button.url("💬 Вопросы? Написать", "https://t.me/Afina_72"),
  ]);
}

function accessText(isPaidUser) {
  if (isPaidUser) {
    return "✅ Доступ активирован.\nОткрой мини-приложение:";
  }
  return (
    "🌿 ЦветБизнес\n\n" +
    "Доступ к материалам — платный (разово).\n" +
    `Стоимость: ${PRICE_RUB} ₽\n\n` +
    "Нажми «Оплатить», затем после успешной оплаты появится кнопка входа."
  );
}

// ---------- /start ----------
bot.start(async (ctx) => {
  const paid = isPaid(ctx.from.id);
  await ctx.reply(accessText(paid), paid ? paidKeyboard() : notPaidKeyboard());
});

// ---------- /status ----------
bot.command("status", async (ctx) => {
  const paid = isPaid(ctx.from.id);
  await ctx.reply(paid ? "✅ У тебя есть доступ." : "⛔️ Доступ не оплачен. Нажми «Оплатить 500 ₽».",
    paid ? paidKeyboard() : notPaidKeyboard()
  );
});

// ---------- Покупка (invoice) ----------
async function sendInvoice(ctx) {
  const prices = [{ label: "Доступ к ЦветБизнес", amount: PRICE_KOPEKS }];

  return ctx.replyWithInvoice({
    title: "Доступ к ЦветБизнес",
    description: "Разовый доступ к материалам и калькулятору внутри мини-приложения.",
    payload: `tsvetbiz_access_${ctx.from.id}`, // уникальный payload на пользователя
    provider_token: YOOKASSA_PROVIDER_TOKEN,
    currency: "RUB",
    prices,
  });
}

// Кнопка "BUY_ACCESS"
bot.action("BUY_ACCESS", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await sendInvoice(ctx);
  } catch (e) {
    console.error(e);
    await ctx.reply("Не удалось выставить счёт. Попробуй ещё раз.");
  }
});

// Команда /buy на всякий случай
bot.command("buy", async (ctx) => {
  await sendInvoice(ctx);
});

// Telegram требует отвечать на pre_checkout_query
bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// Успешная оплата
bot.on("successful_payment", async (ctx) => {
  const sp = ctx.message.successful_payment;
  // Сохраняем доступ
  setPaid(ctx.from.id, {
    currency: sp.currency,
    totalAmount: sp.total_amount,
    telegramChargeId: sp.telegram_payment_charge_id,
    providerChargeId: sp.provider_payment_charge_id,
  });

  await ctx.reply("✅ Оплата прошла! Доступ открыт 👇", paidKeyboard());
});

// ---------- Приём данных из WebApp ----------
bot.on("message", async (ctx) => {
  // Отсекаем любые web_app_data от не оплативших
  const wad = ctx.message?.web_app_data;
  if (!wad?.data) return;

  if (!isPaid(ctx.from.id)) {
    await ctx.reply("⛔️ Доступ не оплачен. Сначала оплати 500 ₽, затем откроется вход.", notPaidKeyboard());
    return;
  }

  let data;
  try {
    data = JSON.parse(wad.data);
  } catch {
    data = { raw: wad.data };
  }

  let text = `🌸 Заявка · ЦветБизнес\n`;
  text += `\n👤 Пользователь: @${ctx.from.username || "—"} (id: ${ctx.from.id})\n`;

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

// ---------- Webhook / server ----------
const hookPath = `/telegraf/${WEBHOOK_SECRET}`;

app.post(hookPath, (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const url = process.env.RENDER_EXTERNAL_URL; // если Render
  if (url) {
    await bot.telegram.setWebhook(`${url}${hookPath}`);
  }
  console.log("Bot running");
});
