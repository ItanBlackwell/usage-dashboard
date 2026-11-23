/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// Serial, latest-wins account activation queue. One request is in flight per
// provider; while it runs, only the last *not yet started* request survives.
// Every replaced request settles explicitly so callers cannot hang forever.
function createLatestWinsQueue(execute, {onIdle = () => {}} = {}) {
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  const slots = new Map();
  const busy = provider => {
    if (provider === undefined) return slots.size > 0;
    return slots.has(provider);
  };
  const drain = async (provider, slot) => {
    if (slot.running) return;
    slot.running = true;
    try {
      while (slot.pending) {
        const work = slot.pending;
        slot.pending = null;
        try {
          const value = await execute(provider, work.id);
          work.resolve({status: 'applied', id: work.id, value});
        } catch (error) {
          work.reject(error);
        }
      }
    } finally {
      slot.running = false;
      if (slot.pending) {
        void drain(provider, slot);
      } else {
        slots.delete(provider);
        try { onIdle(provider); } catch { /* never invalidate a completed switch */ }
      }
    }
  };
  const enqueue = (provider, id) => new Promise((resolve, reject) => {
    if (typeof provider !== 'string' || !provider || typeof id !== 'string' || !id) {
      reject(new Error('invalid_switch_request'));
      return;
    }
    let slot = slots.get(provider);
    if (!slot) {
      slot = {running: false, pending: null};
      slots.set(provider, slot);
    }
    if (slot.pending) slot.pending.resolve({status: 'superseded', id: slot.pending.id});
    slot.pending = {id, resolve, reject};
    if (!slot.running) void drain(provider, slot);
  });
  return {enqueue, busy};
}

module.exports = {createLatestWinsQueue};
