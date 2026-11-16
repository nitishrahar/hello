import {load} from 'cheerio';
import dns from 'node:dns/promises';
import {writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {args, positive, request, rootDomain, pool, csvCell, log} from '../shared/common.js';

export async function checkDomain(domain) {
  let http='unknown', dnsState='unknown', rdap='unknown';
  try { let r=await request(`https://${domain}`,{method:'HEAD',retries:0}); if([405,501].includes(r.status)) r=await request(`https://${domain}`,{retries:0}); http=String(r.status); } catch(e) { http=e.cause?.code || e.code || e.message; }
  const [ns, a] = await Promise.allSettled([dns.resolveNs(domain),dns.resolve4(domain)]);
  const codes=[ns,a].filter(x=>x.status==='rejected').map(x=>x.reason.code);
  if (ns.status==='fulfilled' || a.status==='fulfilled') dnsState='configured'; else if(codes.length===2 && codes.every(x=>x==='ENOTFOUND')) dnsState='nxdomain'; else dnsState='inconclusive';
  try { const r=await request(`https://rdap.org/domain/${encodeURIComponent(domain)}`,{retries:1}); if(r.status===404) rdap='not_found'; else if(r.status===200) rdap='registered'; else rdap=`http_${r.status}`; } catch(e) { rdap=`error:${e.message}`; }
  // RDAP 404 is an indicator, not a registry purchase guarantee. DNS must corroborate it.
  return {http,dns:dnsState,rdap,available:rdap==='not_found' && dnsState==='nxdomain'};
}
export async function crawl({seeds,depth=1,maxPages=30,concurrency=4,output='output/available_expired_domains.csv', fetchPage=request, verifyDomain=checkDomain}) {
  if(!seeds.length) throw new Error('At least one --seed URL is required');
  const origins=new Set(seeds.map(s=>new URL(s).origin)); const seen=new Set(); let successfulPages=0; let frontier=seeds.map(url=>({url,depth:0})); const domains=new Map();
  while(frontier.length && seen.size<maxPages) {
    const batch=[]; for(const item of frontier) { if(!seen.has(item.url) && seen.size<maxPages) { seen.add(item.url); batch.push(item); } } frontier=[];
    const results=await pool(batch,concurrency,async item=>{ const res=await fetchPage(item.url); if(res.status!==200) throw Error(`HTTP ${res.status}`); const $=load(res.text); const links=[]; $('a[href]').each((_,a)=>{ try { const url=new URL($(a).attr('href'),res.url); if(!['http:','https:'].includes(url.protocol)) return; url.hash=''; const domain=rootDomain(url.hostname); if(!domain) return; const sourceDomain=rootDomain(new URL(res.url).hostname); if(domain!==sourceDomain) { if(!domains.has(domain)) domains.set(domain,{domain,source_url:res.url,anchor_text:$(a).text().replace(/\s+/g,' ').trim()}); } else if(item.depth<depth && origins.has(url.origin)) links.push({url:url.href,depth:item.depth+1}); } catch {} }); return links; });
    for(const r of results) if(r.status==='fulfilled') { successfulPages++; frontier.push(...r.value); } else log('warn','crawl_failed',{error:r.reason.message});
  }
  if (!successfulPages) throw new Error('All seed pages failed to fetch');
  const checked=await pool([...domains.values()],concurrency,async d=>({...d,...await verifyDomain(d.domain)}));
  const rows=checked.filter(r=>r.status==='fulfilled' && r.value.available).map(r=>r.value); const headers=['domain','source_url','anchor_text','http','dns','rdap'];
  await mkdir(dirname(resolve(output)),{recursive:true}); await writeFile(output,[headers.join(','),...rows.map(row=>headers.map(h=>csvCell(row[h])).join(','))].join('\n')+'\n');
  log('info','hunter_complete',{pages:seen.size,domains:domains.size,available:rows.length,output}); return {pages:successfulPages,domains:domains.size,rows};
}
if(import.meta.url===`file://${process.argv[1]}`) { try { const a=args(process.argv.slice(2)); await crawl({seeds:[].concat(a.seed||[]),depth:Number(a.depth??1),maxPages:positive(a['max-pages'],30,10000),concurrency:positive(a.concurrency,4,30),output:a.output}); } catch(e) { log('error','hunter_failed',{error:e.message}); process.exitCode=1; } }
