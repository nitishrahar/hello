import dns from 'node:dns/promises';
import net from 'node:net';
import { getDomain } from 'tldts';
export const rootDomain = host => getDomain(host, { allowPrivateDomains: true });
const agents = ['Mozilla/5.0 (compatible; ResearchCrawler/1.0; +https://example.com/bot)', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'];
export const log = (level, event, data = {}) => console.error(JSON.stringify({ time: new Date().toISOString(), level, event, ...data }));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function pool(items, limit, fn) {
  let i = 0; const results = new Array(items.length);
  await Promise.allSettled(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (i < items.length) { const n = i++; try { results[n] = {status:'fulfilled', value:await fn(items[n], n)}; } catch (reason) { results[n] = {status:'rejected', reason}; } }
  })); return results;
}
function publicIP(ip) {
  if (net.isIP(ip) === 4) { const a = ip.split('.').map(Number); return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 || (a[0] === 169 && a[1] === 254) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 100 && a[1] >= 64 && a[1] <= 127)); }
  if (net.isIP(ip) === 6) { const v = ip.toLowerCase(); return !(v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('::ffff:')); } return false;
}
export async function safeUrl(input) {
  const u = new URL(input); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Unsafe URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Private hostname');
  const addresses = net.isIP(host) ? [{address:host}] : await dns.lookup(host, {all:true});
  if (!addresses.length || addresses.some(x => !publicIP(x.address))) throw new Error('Private or invalid address'); return u;
}
// Resolve and reject private destinations for each redirect. Network-level egress controls are still required against DNS rebinding.
export async function request(input, {method='GET', timeout=8000, retries=1, maxBytes=2_000_000} = {}) {
  let last;
  for (let attempt=0; attempt<=retries; attempt++) {
    try {
      let url = input;
      for (let redirects=0; redirects<=5; redirects++) {
        await safeUrl(url);
        const response = await fetch(url, {method, redirect:'manual', signal:AbortSignal.timeout(timeout), headers:{'user-agent':agents[Math.floor(Math.random()*agents.length)], 'accept':'text/html,application/json;q=0.9,*/*;q=0.5'}});
        if ([301,302,303,307,308].includes(response.status) && response.headers.get('location')) { await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue; }
        if ([429,500,502,503,504].includes(response.status) && attempt < retries) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
        let text = ''; if (method !== 'HEAD' && response.body) { const reader=response.body.getReader(); let size=0; const chunks=[]; try { while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>maxBytes) throw new Error('Response too large'); chunks.push(value); } } finally { reader.releaseLock(); } text=Buffer.concat(chunks).toString('utf8'); }
        return {status:response.status, text, url, headers:response.headers};
      } throw new Error('Too many redirects');
    } catch (err) { last=err; if (attempt < retries) await sleep(250 * 2**attempt + Math.random()*200); }
  } throw last;
}
export function args(argv) { const out={_:[]}; for(let i=0;i<argv.length;i++) { const a=argv[i]; if(a.startsWith('--')) { const k=a.slice(2); const v=argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true; if(out[k] !== undefined) out[k]=[].concat(out[k],v); else out[k]=v; } else out._.push(a); } return out; }
export function positive(value, fallback, max=100) { const n=Number(value ?? fallback); if(!Number.isInteger(n)||n<1||n>max) throw new Error(`Expected integer between 1 and ${max}`); return n; }
export const csvCell = x => `"${String(x ?? '').replaceAll('"','""')}"`;
