import { parseWebEnv } from './env-schema';

export const env = parseWebEnv(import.meta.env);
