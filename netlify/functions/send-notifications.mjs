// Scheduled function (see netlify.toml for the cron schedule) — runs on its
// own every few minutes, independent of whether the app is open anywhere.
// Computes Bradford prayer times with a self-contained solar calculation
// (no external API) and sends a real push notification the moment each one
// arrives. This mirrors the exact same calculation used in index.html and
// fajr-widget.html, so all three always agree.
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

function addMinutes(d, mins){ return new Date(d.getTime() + mins*60000); }

// Converts a local London decimal-hours value into the correct UTC Date,
// using the already-known offset (pure arithmetic, no timezone lookups —
// Date.UTC normalizes out-of-range hour values correctly on its own).
function hoursToDate(baseDate, decimalLocalHours, tzOffsetHours){
  const utcDecimalHours = decimalLocalHours - tzOffsetHours;
  const h = Math.floor(utcDecimalHours);
  const m = Math.round((utcDecimalHours - h) * 60);
  const y = baseDate.getFullYear(), mo = baseDate.getMonth(), da = baseDate.getDate();
  return new Date(Date.UTC(y, mo, da, h, m));
}

function julianDay(y, m, d, hour){
  if (m <= 2){ y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + hour / 24;
}
function solarPosition(jd){
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) * Math.PI / 180;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = ((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360) * Math.PI / 180;
  const e = (23.439 - 0.00000036 * D) * Math.PI / 180;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const RA = (Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * 180 / Math.PI + 360) % 360;
  let EqT = (q / 15.0 - RA / 15.0) * 60;
  if (EqT > 720) EqT -= 1440;
  if (EqT < -720) EqT += 1440;
  return { dec: dec * 180 / Math.PI, EqT };
}
function angleHours(latR, decR, angle, beforeNoon){
  const cosH = (-Math.sin(angle * Math.PI / 180) - Math.sin(latR) * Math.sin(decR)) / (Math.cos(latR) * Math.cos(decR));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
  return beforeNoon ? -H / 15.0 : H / 15.0;
}

// Returns the correct UTC offset (in hours) for Europe/London on the given
// calendar date — computed from the timezone database itself, not the
// server's own system clock. Netlify's functions run in UTC, so relying on
// the server's local timezone would silently make every prayer time an
// hour off during BST, which is exactly the bug this replaces.
// Returns the correct UTC offset (in hours) for Europe/London on the given
// calendar date — using pure date arithmetic, not the runtime's timezone
// database. Netlify's servers appear not to fully support IANA timezone
// lookups (toLocaleString with timeZone silently fell back to UTC there),
// which is exactly what caused every prayer time to be an hour early during
// BST. UK clocks go forward on the last Sunday in March at 01:00 UTC, and
// back on the last Sunday in October at 01:00 UTC — this needs no timezone
// data at all, so it can't fail the same way on any server.
function londonOffsetHours(y, m, d){
  function lastSunday(year, monthIndex){
    const last = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0));
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    return last;
  }
  const check = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const bstStart = lastSunday(y, 2);  // March
  const bstEnd = lastSunday(y, 9);    // October
  return (check >= bstStart && check < bstEnd) ? 1 : 0;
}

function computePrayerTimes(forDate){
  const tzOffsetHours = londonOffsetHours(forDate.getFullYear(), forDate.getMonth() + 1, forDate.getDate());
  const jd = julianDay(forDate.getFullYear(), forDate.getMonth() + 1, forDate.getDate(), 12);
  const { dec, EqT } = solarPosition(jd);
  const noonLocal = 12 - LON / 15.0 - EqT / 60.0 + tzOffsetHours;
  const latR = LAT * Math.PI / 180, decR = dec * Math.PI / 180;

  const fajr = noonLocal + angleHours(latR, decR, 18, true) + 20/60.0;
  const dhuhr = noonLocal;

  const factor = 1; // Hanbali / standard shadow-length factor
  const t = factor + Math.tan(Math.abs(latR - decR));
  const altAsr = Math.atan(1.0 / t) * 180 / Math.PI;
  const cosHAsr = (Math.sin(altAsr * Math.PI/180) - Math.sin(latR)*Math.sin(decR)) / (Math.cos(latR)*Math.cos(decR));
  const HAsr = Math.acos(Math.max(-1,Math.min(1,cosHAsr))) * 180 / Math.PI;
  const asr = noonLocal + HAsr/15.0 + 56/60.0;

  const maghrib = noonLocal + angleHours(latR, decR, 0.833, false) + 4/60.0;
  const isha = noonLocal + angleHours(latR, decR, 12, false) - 16/60.0;

  return {
    Fajr: hoursToDate(forDate, fajr, tzOffsetHours),
    Dhuhr: hoursToDate(forDate, dhuhr, tzOffsetHours),
    Asr: hoursToDate(forDate, asr, tzOffsetHours),
    Maghrib: hoursToDate(forDate, maghrib, tzOffsetHours),
    Isha: hoursToDate(forDate, isha, tzOffsetHours)
  };
}

export default async () => {
  if(!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY){
    console.log('VAPID keys not configured');
    return new Response('VAPID keys not configured', { status: 500 });
  }

  const subStore = getStore('push-subscriptions');
  const subscription = await subStore.get('subscription', { type: 'json' });
  if(!subscription){
    console.log('No subscription yet');
    return new Response('No subscription yet', { status: 200 });
  }

  const now = new Date();
  const today = new Date();
  const prayerTimes = computePrayerTimes(today);

  const dayKey = fmtDateISO(today);
  console.log('Now:', now.toISOString(), '| Times:', Object.fromEntries(Object.entries(prayerTimes).map(([k,v])=>[k,v.toISOString()])));
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

  const summary = results.join('; ') || 'Nothing due';
  console.log(summary);
  return new Response(summary, { status: 200 });
};

export const config = {
  schedule: '*/5 * * * *'
};
