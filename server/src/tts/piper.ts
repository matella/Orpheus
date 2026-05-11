import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { config } from '../config.js';
import { AiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { TtsAdapter, Voice } from './adapter.js';

const SPEAK_TIMEOUT_MS = 10_000;
const SAMPLE_PHRASE = "And now, here's a track I think you'll love.";

export class PiperAdapter implements TtsAdapter {
  isAvailable(): boolean {
    const bin = config.tts.piperBinaryPath;
    return !!bin && existsSync(bin);
  }

  async listVoices(): Promise<Voice[]> {
    const dir = config.tts.piperVoicesDir;
    if (!dir || !existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => ({
        id: f,
        name: basename(f, '.onnx').replace(/[_-]/g, ' '),
      }));
  }

  async speak(text: string, voiceId?: string | null): Promise<Buffer> {
    if (!this.isAvailable()) {
      throw new AiError('Piper binary not found');
    }

    const bin = config.tts.piperBinaryPath!;
    const voicesDir = config.tts.piperVoicesDir ?? '';
    const voice = voiceId ?? (await this.listVoices())[0]?.id;

    if (!voice) {
      throw new AiError('No Piper voice model found');
    }

    const modelPath = join(voicesDir, voice);

    return new Promise((resolve, reject) => {
      const proc = spawn(bin, ['--model', modelPath, '--output_file', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new AiError('Piper TTS timed out'));
      }, SPEAK_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', (data: Buffer) => {
        logger.debug({ msg: data.toString() }, 'Piper stderr');
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(new AiError(`Piper exited with code ${code}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new AiError(`Failed to spawn Piper: ${err.message}`));
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  async preview(voiceId: string): Promise<Buffer> {
    return this.speak(SAMPLE_PHRASE, voiceId);
  }
}

export const piperAdapter = new PiperAdapter();
