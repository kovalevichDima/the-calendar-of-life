require("dotenv").config();

const { Telegraf, session } = require("telegraf");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const moment = require("moment");

// Создание базы данных SQLite
const db = new sqlite3.Database("users.db", (err) => {
    if (err) return console.error(err.message);
    console.log("Connected to the users database.");
});

db.serialize(() => {
    db.run(
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, date_of_birth TEXT, region TEXT)",
    );
});

// Средняя продолжительность жизни по регионам (в годах)
const AVERAGE_LIFE_EXPECTANCY = {
    Россия: 72,
    США: 79,
    Германия: 81,
    Япония: 84,
    Франция: 83,
};

// Функция для расчета количества недель
function calculateWeeks(dateOfBirth, averageLifeExpectancy) {
    const today = moment();
    const dob = moment(dateOfBirth, "YYYY-MM-DD");
    const weeksLived = today.diff(dob, "weeks");
    const expectedLifeSpan = averageLifeExpectancy * 52; // Годы в недели
    const weeksLeft = expectedLifeSpan - weeksLived;
    return { weeksLived, weeksLeft };
}

// Функция для capitalize
String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase();
};

// Инициализация бота
const bot = new Telegraf(process.env.API_KEY_BOT); // Замените на ваш токен

// Middleware для сессии
bot.use(
    session({
        defaultSession: () => ({
            state: null,
            dateOfBirth: null,
        }),
    }),
);

// Обработка команды /start
bot.command("start", (ctx) => {
    ctx.session.state = "DATE_OF_BIRTH"; // Устанавливаем состояние
    ctx.reply(
        "Привет! Я бот 'Календарь жизни'. Давайте начнем!\n" +
            "Пожалуйста, введите вашу дату рождения в формате YYYY-MM-DD.",
    );
});

// Обработка даты рождения
bot.on("text", (ctx) => {
    const userId = ctx.from.id;
    const state = ctx.session.state;

    if (state === "DATE_OF_BIRTH") {
        const dateOfBirth = ctx.message.text;
        if (moment(dateOfBirth, "YYYY-MM-DD", true).isValid()) {
            ctx.session.state = "REGION"; // Переходим к следующему состоянию
            ctx.session.dateOfBirth = dateOfBirth; // Сохраняем дату рождения
            ctx.reply(
                "Отлично! Теперь укажите ваш регион проживания (например, Россия, США, Германия).",
            );
        } else {
            ctx.reply(
                "Неверный формат даты. Пожалуйста, введите дату в формате YYYY-MM-DD.",
            );
        }
    } else if (state === "REGION") {
        const region = ctx.message.text.capitalize(); // Используем нашу функцию capitalize
        if (AVERAGE_LIFE_EXPECTANCY[region]) {
            const dateOfBirth = ctx.session.dateOfBirth;

            // Сохранение данных пользователя в базу
            db.run(
                "INSERT OR REPLACE INTO users (user_id, date_of_birth, region) VALUES (?, ?, ?)",
                [userId, dateOfBirth, region],
                function (err) {
                    if (err) return console.error(err.message);
                    ctx.reply(
                        `Спасибо! Ваша дата рождения: ${dateOfBirth}, регион: ${region}.\n` +
                            "Вы будете получать уведомления каждую неделю.",
                    );
                    ctx.session.state = null; // Очищаем состояние после завершения регистрации
                },
            );
        } else {
            ctx.reply(
                "Неизвестный регион. Пожалуйста, выберите из списка: " +
                    `${Object.keys(AVERAGE_LIFE_EXPECTANCY).join(", ")}.`,
            );
        }
    }
});

// Отправка уведомлений о статистике
function sendNotifications() {
    db.all(
        "SELECT user_id, date_of_birth, region FROM users",
        [],
        (err, rows) => {
            if (err) return console.error(err.message);

            rows.forEach((row) => {
                const { user_id, date_of_birth, region } = row;
                const averageLifeExpectancy =
                    AVERAGE_LIFE_EXPECTANCY[region] || 72; // Значение по умолчанию
                const { weeksLived, weeksLeft } = calculateWeeks(
                    date_of_birth,
                    averageLifeExpectancy,
                );

                const message =
                    `📊 Ваша статистика:\n` +
                    `• Недель прожито: ${weeksLived}\n` +
                    `• Примерно осталось: ${weeksLeft} недель\n` +
                    `• Ожидаемая продолжительность жизни: ${averageLifeExpectancy} лет`;
                bot.telegram.sendMessage(user_id, message);
            });
        },
    );
}

// Отправка утреннего приветствия
function sendMorningGreeting() {
    db.all("SELECT user_id FROM users", [], (err, rows) => {
        if (err) return console.error(err.message);

        rows.forEach((row) => {
            const user_id = row.user_id;
            const message =
                "☀️ Доброе утро! Желаю вам хорошего дня и продуктивного начала!";
            bot.telegram.sendMessage(user_id, message);
        });
    });
}

// Запуск еженедельных уведомлений
cron.schedule("0 9 * * 0", () => {
    // Каждое воскресенье в 09:00
    console.log("Отправка уведомлений...");
    sendNotifications();
});

// Запуск утреннего приветствия
cron.schedule("0 9 * * *", () => {
    // Каждый день в 09:00
    console.log("Отправка утреннего приветствия...");
    sendMorningGreeting();
});

// Запуск бота
bot.launch();

// Завершение работы
process.once("SIGINT", () => {
    bot.stop();
    db.close();
});
process.once("SIGTERM", () => {
    bot.stop();
    db.close();
});
