// Receives the browser's push subscription (created by PushManager.subscribe
// on the client) and stores it in Netlify Blobs so the scheduled function
// can send real push messages to it later, even while the app is closed.
//
// This app has exactly one intended user, so we keep this deliberately
// simple: one fixed key holding one subscription. If it's ever opened from
// a second device, that subscription just replaces the stored one.
//
// Written as a Netlify v2 function (export default) — the v1 CommonJS
// format (exports.handler) doesn't reliably get automatic Netlify Blobs
// context injected, which caused MissingBlobsEnvironmentError.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const store = getStore('push-subscriptions');

  if (req.method === 'DELETE') {
    try {
      await store.delete('subscription');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (err) {
      console.log('Delete failed:', err.message);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let subscription;
  try {
    subscription = await req.json();
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!subscription || !subscription.endpoint) {
    return new Response('Missing subscription endpoint', { status: 400 });
  }

  try {
    await store.setJSON('subscription', subscription);
    console.log('Subscription saved:', subscription.endpoint);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.log('Save failed:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
