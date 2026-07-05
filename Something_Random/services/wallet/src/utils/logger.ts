import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  const meta = Object.keys(metadata).length ? JSON.stringify(metadata) : '';
  return `${timestamp} [${level}]: ${message} ${meta}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'wallet-service' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? winston.format.json() : combine(colorize(), logFormat),
    }),
  ],
});
