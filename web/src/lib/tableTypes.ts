/**
 * ASPTR-199: the table client contract now lives in lib/protocol.ts
 * (single source of truth — wire types + this UI facade). Re-exported here
 * so component imports stay unchanged.
 */
export * from './protocol'
