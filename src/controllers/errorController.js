const AppError = require("../utils/AppError");

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

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

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
