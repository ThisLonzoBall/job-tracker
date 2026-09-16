import type { Migration } from '../db'
import init from './001_init.sql?raw'

/**
 * Every migration, inlined into the bundle at build time via `?raw`.
 * Add new files here in order; never edit or rename one that has shipped.
 */
export const MIGRATIONS: readonly Migration[] = [{ name: '001_init', sql: init }]
