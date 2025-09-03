import express from "express";
import fs from "fs";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const app = express();
app.use(express.json());

// === настройки ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
if (!TELEGRAM_TOKEN) {
  console.warn("⚠️  Переменная окружения TELEGRAM_TOKEN не задана");
}
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;


const FIELDS = [
  { key: "кому", prompt: "Укажите должность, ВУЗ и ФИО, например: Ректору МГУ Максакову Н.О." },
  { key: "Имяотчестворектора", prompt: "Укажите Имя, Отчество ректора, например: Никита Олегович" },
  { key: "курс", prompt: "Укажите курс, например: 3" },
  { key: "группа", prompt: "Укажите номер группы, например: МГЕР-19-84" },
  { key: "ФИО", prompt: "Укажите ваше ФИО, например: Максаков Никита Олегович" },
  { key: "Дата", prompt: "Укажите дату мероприятия, например: 03.09.2025" },
  { key: "фио2", prompt: "Укажите ФИО студента в родительном падеже, например: Максакова Никиты Олеговича" }
];

// простейшие сессии в памяти (для одной инстанции достаточно)
const sessions = Object.create(null);

// healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

/**
 * Telegram webhook
 */
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update?.message) return res.sendStatus(200);

    const chatId = update.message.chat.id;
    const text = (update.message.text || "").trim();

    if (text === "/start") {
      sessions[chatId] = { i: 0, data: {} };
      await sendMessage(chatId, "Привет! Давай заполним документ.\n\n" + FIELDS[0].prompt);
      return res.sendStatus(200);
    }
    if (text === "/cancel") {
      delete sessions[chatId];
      await sendMessage(chatId, "Окей, отменил. Чтобы начать заново — /start");
      return res.sendStatus(200);
    }

    const session = sessions[chatId];
    if (!session) {
      await sendMessage(chatId, "Отправь /start чтобы начать заполнение документа.");
      return res.sendStatus(200);
    }

    // сохраняем ответ и двигаемся дальше
    const current = FIELDS[session.i];
    if (!current) {
      await sendMessage(chatId, "Похоже, сессия устарела. Напиши /start.");
      delete sessions[chatId];
      return res.sendStatus(200);
    }
    session.data[current.key] = text;
    session.i += 1;

    // если всё собрано — генерируем docx и отправляем
    if (session.i >= FIELDS.length) {
      try {
        const docBuffer = generateDoc(session.data); // Buffer
        await sendDocument(chatId, docBuffer, "заполненный_документ.docx");
        await sendMessage(chatId, "Готово! Если нужно ещё — /start");
      } catch (e) {
        console.error("DOCX error:", e);
        await sendMessage(chatId, "Ошибка при генерации документа: " + (e?.message || e));
      }
      delete sessions[chatId];
    } else {
      await sendMessage(chatId, FIELDS[session.i].prompt);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

/**
 * Генерация DOCX на основе шаблона и данных
 */
function generateDoc(data) {
  // шаблон.docx должен лежать в корне проекта
  const templatePath = path.join(process.cwd(), "шаблон.docx");
  const templateBuf = fs.readFileSync(templatePath);
  const zip = new PizZip(templateBuf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" } // плейсхолдеры вида {{тег}}
  });
  doc.setData(data);
  doc.render(); // бросит исключение, если какой-то тег не найден
  return doc.getZip().generate({ type: "nodebuffer" });
}

/** helpers */
async function sendMessage(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
async function sendDocument(chatId, buffer, filename) {
  // Node 18+ имеет глобальные fetch/FormData/Blob
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([buffer]), filename);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: form });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot server started on port", PORT));
