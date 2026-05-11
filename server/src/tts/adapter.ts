export interface Voice {
  id: string;
  name: string;
}

export interface TtsAdapter {
  speak(text: string, voiceId?: string | null): Promise<Buffer>;
  listVoices(): Promise<Voice[]>;
  isAvailable(): boolean;
}
