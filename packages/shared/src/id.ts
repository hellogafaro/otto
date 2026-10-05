import { customAlphabet } from 'nanoid'

/**
 * The one id for every row: 12 lowercase letters and digits (about 62 bits).
 * No case, symbols or lookalike tricks, so it is safe in URLs, file names and SQL.
 */
export const createId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
