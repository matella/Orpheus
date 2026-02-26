import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  spotify: z.object({
    clientId: z.string().min(1, 'SPOTIFY_CLIENT_ID is required'),
    clientSecret: z.string().min(1, 'SPOTIFY_CLIENT_SECRET is required'),
    redirectUri: z.string().url('SPOTIFY_REDIRECT_URI must be a valid URL'),
  }),
  server: z.object({
    port: z.number().int().positive(),
    host: z.string().min(1),
  }),
  database: z.object({
    path: z.string().min(1),
  }),
  logging: z.object({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
  }),
  ai: z.object({
    enabled: z.boolean(),
    ollamaHost: z.string(),
    ollamaModel: z.string(),
  }),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const raw = {
    spotify: {
      clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
      redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:3000/api/auth/callback',
    },
    server: {
      port: parseInt(process.env.PORT ?? '3000', 10),
      host: process.env.HOST ?? '0.0.0.0',
    },
    database: {
      path: process.env.DB_PATH ?? './data/orpheus.db',
    },
    logging: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    ai: {
      enabled: process.env.AI_ENABLED !== 'false',
      ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
      ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.2',
    },
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

export const config = loadConfig();
