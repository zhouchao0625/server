export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

type LogMode = 'silent' | 'minimal' | 'normal' | 'verbose';

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, any>;
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

class Logger {
  private static instance: Logger;
  private isDevelopment: boolean;
  private mode: LogMode;
  private levelColors: Record<LogLevel, string>;
  private levelEmojis: Record<LogLevel, string>;

  private constructor() {

    // this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isDevelopment = true;

    this.mode = (process.env.LOG_MODE as LogMode) || 'normal';
    

    this.levelColors = {
      [LogLevel.INFO]: colors.blue,
      [LogLevel.WARN]: colors.yellow,
      [LogLevel.ERROR]: colors.red,
      [LogLevel.DEBUG]: colors.magenta
    };

    this.levelEmojis = {
      [LogLevel.INFO]: 'ℹ️',
      [LogLevel.WARN]: '⚠️',
      [LogLevel.ERROR]: '❌',
      [LogLevel.DEBUG]: '🔍'
    };
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setMode(mode: LogMode) {
    this.mode = mode;
  }

  private shouldLog(level: LogLevel): boolean {
    const silent = [
      LogLevel.ERROR,
    ];

    const minimal = [
      LogLevel.ERROR,
      LogLevel.WARN,
    ];

    const normal = [
      LogLevel.ERROR,
      LogLevel.WARN,
      LogLevel.INFO,
    ];

    if (this.mode === 'silent') return silent.includes(level);
    if (this.mode === 'minimal') return minimal.includes(level);
    if (this.mode === 'normal') return normal.includes(level);
    return true; // verbose mode
  }

  private formatMessage(logMessage: LogMessage): string {
    const { level, message, timestamp, context } = logMessage;
    const color = this.levelColors[level];
    const emoji = this.levelEmojis[level];
    
    const timestampStr = colors.gray + `[${timestamp}]` + colors.reset;
    const levelStr = color + `[${level.toUpperCase()}]` + colors.reset;
    const emojiStr = emoji + ' ';
    const messageStr = colors.bright + message + colors.reset;
    
    const contextStr = context 
      ? '\n' + colors.dim + 'Context: ' + JSON.stringify(context, null, 2) + colors.reset
      : '';

    return `${timestampStr} ${levelStr} ${emojiStr}${messageStr}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>) {
    if (!this.shouldLog(level)) 
      return;    

    if (level == LogLevel.WARN || level == LogLevel.ERROR) {
      if (level == LogLevel.ERROR) {
        // alert me
      }
      // store in database
    }
    
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context
    };

    const formattedMessage = this.formatMessage(logMessage);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.DEBUG:
        if (this.isDevelopment) {
          console.debug(formattedMessage);
        }
        break;
      default:
        console.log(formattedMessage);
    }
  }

  public info(message: string, context?: Record<string, any>) {
    this.log(LogLevel.INFO, message, context);
  }

  public warn(message: string, context?: Record<string, any>) {
    this.log(LogLevel.WARN, message, context);
  }

  public error(message: string, context?: Record<string, any>) {
    this.log(LogLevel.ERROR, message, context);
  }

  public debug(message: string, context?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, context);
  }
}

export const logger = Logger.getInstance(); 