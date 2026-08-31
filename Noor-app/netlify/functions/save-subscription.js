// Receives the browser's push subscription (created by PushManager.subscribe
// on the client) and stores it in Netlify Blobs so the scheduled function
// can send real push messages to it later, even while the app is closed.
//
// This app has exactly one intended user, so we keep this deliberately
// simple: one fixed key holding one subscription. If it's ever opened from
// a second device, that subscription just replaces the stored one.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const store = getStore('push-subscriptions');

  if (event.httpMethod === 'DELETE') {
    try {
      await store.delete('subscription');
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let subscription;
  try {
    subscription = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!subscription || !subscription.endpoint) {
    return { statusCode: 400, body: 'Missing subscription endpoint' };
  }

  try {
    await store.setJSON('subscription', subscription);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
