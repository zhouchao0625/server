import nodemailer from 'nodemailer';
import { env } from '../lib/config/env.js';
import { logger } from './logger.js';


type sendMailProps = {
  from: string;
  to: string;
  subject: string;
  text: string;
};


export const transport = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASS,
    },
  });


export const sendMail = async ({ from, to, subject, text }: sendMailProps) => {
  // Wrapper function for sending emails
  if (env.EMAIL_DRY_RUN == "true") {
    logger.info(`Email dry run enabled. Would have sent email to ${to} from ${from} with subject ${subject} and text ${text}`);
    return;
  }
  
  await transport.sendMail({
    from,
    to,
    subject,
    text,
  });
};
