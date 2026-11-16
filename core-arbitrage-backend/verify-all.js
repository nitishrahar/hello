import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'csv-parse/sync';
import {crawl,checkDomain} from './01-dead-link-hunter/index.js';
import {extract,inspectWebsite} from './02-apify-rentable-actor/src/main.js';
import {leadsFrom} from './03-b2b-trigger-sniper/index.js';
import {safeUrl} from './shared/common.js';
const dir=await mkdtemp(join(tmpdir(),'arbitrage-test-')); const failures=[]; const skipped=[];
async function test(name,fn) {try {await fn(); console.log(`PASS ${name}`);} catch(e) {failures.push(name); console.error(`FAIL ${name}: ${e.stack}`);} }
try {
 await test('reject private network URL',async()=>{await assert.rejects(safeUrl('http://127.0.0.1/'));});
 try { const output=join(dir,'domains.csv'); const result=await crawl({seeds:['https://github.com/robots.txt'],depth:0,maxPages:1,concurrency:1,output}); assert.equal(result.pages,1); const csv=parse(await readFile(output,'utf8'),{columns:true,skip_empty_lines:true}); assert(Array.isArray(csv)); console.log('PASS hunter live CSV'); } catch(e) { if(e.message==='All seed pages failed to fetch') skipped.push('hunter live seed could not be fetched'); else { failures.push('hunter live CSV'); console.error(e); } }
 await test('hunter CSV provenance and quoting',async()=>{ const output=join(dir,'fixture.csv'); await crawl({seeds:['https://example.com/'],depth:0,output,fetchPage:async url=>({status:200,url,text:'<a href="https://external.example.net/">Helpful, resource</a>'}),verifyDomain:async()=>({available:true,http:'404',dns:'nxdomain',rdap:'not_found'})}); const rows=parse(await readFile(output,'utf8'),{columns:true}); assert.equal(rows[0].domain,'example.net'); assert.equal(rows[0].source_url,'https://example.com/'); assert.equal(rows[0].anchor_text,'Helpful, resource'); });
 await test('RDAP failures cannot mark a domain available',async()=>{const r=await checkDomain('github.com'); assert.equal(r.available,false);});
 await test('actor contact and tag extraction',async()=>{const x=extract('<a href="/contact">Contact</a><a href="https://instagram.com/test">Social</a><p>info@company.com</p><script>fbq("init");</script>','https://example.com/'); assert(x.emails.includes('info@company.com')); assert(x.tracking.metaPixel); assert(x.links.includes('https://example.com/contact')); assert.equal(x.tracking.googleTagManager,false);});
 {const result=await inspectWebsite('https://github.com/robots.txt',1); if(!result.pages.length) skipped.push(`live actor fetch: ${result.errors[0]?.error}`); else {assert.equal(result.pages.length,1); console.log('PASS actor live website');}}
 await test('trigger filters, missing pixel unknown, and CSV CLI output',async()=>{const now=new Date().toISOString(); const data=[{name:'Acme',city:'Berlin',reviews:[{rating:1,date:now,text:'Slow repair'}]},{name:'Other',city:'London',reviewCount:21,website:'https://example.com'},{name:'Third',city:'Boston',reviewCount:21,metaPixel:false,website:'https://example.com'}]; const out=leadsFrom(data); assert.equal(out.length,2); assert(out[0].emailDraft.body.includes('Slow repair')); assert.equal(out[1].trigger.type,'digital_presence'); const input=join(dir,'business.csv'),output=join(dir,'leads.json'); await writeFile(input,'name,city,review_count,website,meta_pixel\nThird,Boston,21,https://example.com,false\n'); const r=spawnSync(process.execPath,['03-b2b-trigger-sniper/index.js','--input',input,'--output',output],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr); assert.equal(JSON.parse(await readFile(output,'utf8')).length,1); });
} finally {await rm(dir,{recursive:true,force:true});}
if(skipped.length) console.warn('LIVE CHECKS UNAVAILABLE: '+skipped.join('; '));
if(skipped.length && process.argv.includes('--require-live')) failures.push('required live checks unavailable');
if(failures.length) {console.error(`${failures.length} verification(s) failed`); process.exitCode=1;} else console.log('Verification complete'+(skipped.length?' (some live checks unavailable)':''));
