// Scheduled function (see netlify.toml for the cron schedule) — runs on its
// own every few minutes, independent of whether the app is open anywhere.
// It fetches today's Bradford prayer times using the exact same formula as
// the app itself (matched to Tawakkulia Jamia Masjid's own timetable), and
// sends a real push notification through the browser's push service the
// moment each one arrives.
//
// Written as a Netlify v2 function (export default) — this is the format
// Netlify's current docs require for scheduled functions.

import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

const LAT = 53.7960, LON = -1.7594, TZ = 'Europe/London';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:noor-app@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function fmtDateISO(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
  return `${da}-${m}-${y}`;
}

// Mirrors the client's timeOnDate() in index.html exactly, so server-computed
// times always agree with what's displayed in the app.
function timeOnDate(baseDate, hhmm, tz){
  const clean = hhmm.split(' ')[0];
  const [h, m] = clean.split(':').map(Number);
  const y = baseDate.getFullYear(), mo = baseDate.getMonth(), da = baseDate.getDate();
  const guess = new Date(Date.UTC(y, mo, da, h, m));
  const londonStr = guess.toLocaleString('en-US', { timeZone: tz, hour12:false, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' });
  const [dpart, tpart] = londonStr.split(', ');
  const [lh, lmin] = tpart.split(':').map(Number);
  const diffMinutes = (lh*60+lmin) - (h*60+m);
  return new Date(guess.getTime() - diffMinutes*60000);
}

function addMinutes(d, mins){ return new Date(d.getTime() + mins*60000); }

async function fetchTimings(date){
  const iso = fmtDateISO(date);
  const url = `https://api.aladhan.com/v1/timings/${iso}?latitude=${LAT}&longitude=${LON}&method=2&school=1&latitudeAdjustmentMethod=1&timezonestring=${encodeURIComponent(TZ)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Prayer time service unavailable');
  const data = await res.json();
  return data.data.timings;
}

export default async () => {
  if(!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY){
    return new Response('VAPID keys not configured', { status: 500 });
  }

  const subStore = getStore('push-subscriptions');
  const subscription = await subStore.get('subscription', { type: 'json' });
  if(!subscription){
    return new Response('No subscription yet', { status: 200 });
  }

  const now = new Date();
  const today = new Date();

  let timings;
  try{
    timings = await fetchTimings(today);
  }catch(err){
    return new Response('Could not fetch prayer times: ' + err.message, { status: 502 });
  }

  const maghrib = timeOnDate(today, timings.Maghrib, TZ);
  const prayerTimes = {
    Fajr: timeOnDate(today, timings.Fajr, TZ),
    Dhuhr: timeOnDate(today, timings.Dhuhr, TZ),
    Asr: timeOnDate(today, timings.Asr, TZ),
    Maghrib: maghrib,
    Isha: addMinutes(maghrib, 60)
  };

  const dayKey = fmtDateISO(today);
  const stateStore = getStore('notify-state');
  let sentToday = (await stateStore.get(dayKey, { type: 'json' })) || {};

  const results = [];

  for(const [name, time] of Object.entries(prayerTimes)){
    const alreadySent = !!sentToday[name];
    const timeHasArrived = now.getTime() >= time.getTime();
    // Only fire within a reasonable window after the time (30 min) so a long
    // outage doesn't cause a very late, confusing notification.
    const withinWindow = (now.getTime() - time.getTime()) < 30*60000;

    if(timeHasArrived && withinWindow && !alreadySent){
      try{
        await webpush.sendNotification(subscription, JSON.stringify({
          title: `Time for ${name}`,
          body: "It's time to pray.",
          tag: 'noor-' + name
        }));
        sentToday[name] = true;
        results.push(name + ': sent');
      }catch(err){
        // 410/404 means the subscription is no longer valid (e.g. user
        // uninstalled or cleared site data) — clean it up so we stop trying.
        if(err.statusCode === 410 || err.statusCode === 404){
          await subStore.delete('subscription');
          results.push(name + ': subscription gone, removed');
          break;
        }
        results.push(name + ': failed - ' + err.message);
      }
    }
  }

  await stateStore.setJSON(dayKey, sentToday);

  return new Response(results.join('; ') || 'Nothing due', { status: 200 });
};

export const config = {
  schedule: '*/5 * * * *'
};
