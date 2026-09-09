const AppError = require("../utils/AppError");
const errorTracker = require("../services/errorTracker");
const { resolveRoutePattern } = require("../middleware/auditLog");

const handleCastErrorDB = (err) => {
    const message = `Некорректное значение поля ${err.path}`;
    return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
    const fields = Object.keys(err.errors || {}).join(", ");
    const message = fields
        ? `Ошибка валидации: ${fields}`
        : "Ошибка валидации данных";
    return new AppError(message, 400);
};

const handleDuplicateKeyDB = (err) => {
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : "поле";
    return new AppError(`Дубликат значения: ${field} уже существует`, 409);
};

const handleJwtError = () => new AppError("Недействительный токен", 401);
const handleJwtExpired = () => new AppError("Срок действия токена истёк", 401);

const handleMulterError = (err) => {
    if (err.code === "LIMIT_FILE_SIZE") {
        return new AppError("Файл слишком большой (максимум 5 МБ)", 400);
    }
    return new AppError(err.message || "Ошибка загрузки файла", 400);
};

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack,
    });
};

const sendErrorProd = (err, res) => {
    if (err.isOperational) {
        res.status(err.statusCode).json({
            status: err.status,
            message: err.message,
        });
    } else {
        console.error("ERROR 💥", err);
        res.status(500).json({
            status: "error",
            message: "Что-то пошло не так",
        });
    }
};

/**
 * 5xx уходит в трекер ошибок, 4xx — НЕТ.
 *
 * 4xx это в подавляющем большинстве нормальная работа приложения (не нашёл,
 * не авторизован, не прошёл валидацию) — они уже лежат в аудит-логе, и заводить
 * по ним issue значит утопить разбор в шуме. 5xx — всегда наша вина.
 *
 * Операционные ошибки (AppError) с кодом 5xx тоже пишем: 503 «сервис недоступен»
 * это ровно то, о чём надо знать.
 */
const trackServerError = (err, req) => {
    try {
        if (!err.statusCode || err.statusCode < 500) return;
        errorTracker.track({
            app: "server",
            kind: "http-5xx",
            message: err.message || "Unknown server error",
            stack: err.stack,
            routePattern: resolveRoutePattern(req),
            url: req.originalUrl,
            userAgent: req.headers && req.headers["user-agent"],
            ip: req.ip,
            actor: req.user
                ? {
                    id: String(req.user.id),
                    kind: req.user.role === "intern" ? "intern" : "mentor",
                    role: req.user.role || null,
                    isAdmin: req.user.isAdmin === true || req.user.role === "admin",
                    name: [req.user.name, req.user.lastName].filter(Boolean).join(" ") || null,
                    identifier: null,
                }
                : undefined,
            context: { method: req.method, statusCode: err.statusCode },
        });
    } catch (e) {
        // Обработчик ошибок не имеет права падать сам.
        console.error("[errors] не удалось записать 5xx:", e.message);
    }
};

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    trackServerError(err, req);

    if (process.env.NODE_ENV === "development") {
        sendErrorDev(err, res);
        return;
    }

    let error = err;

    if (err.name === "CastError") error = handleCastErrorDB(err);
    else if (err.name === "ValidationError") error = handleValidationErrorDB(err);
    else if (err.code === 11000) error = handleDuplicateKeyDB(err);
    else if (err.name === "JsonWebTokenError") error = handleJwtError();
    else if (err.name === "TokenExpiredError") error = handleJwtExpired();
    else if (err.name === "MulterError") error = handleMulterError(err);

    sendErrorProd(error, res);
};
