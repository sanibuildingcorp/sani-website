// netlify/functions/lib/thread.test.js
//
// Run:  node netlify/functions/lib/thread.test.js
//
// The thread is the record of what was agreed. These assert the four things that
// make it worth calling a record: nothing is lost when an old single-string
// question is migrated, a re-synced Gmail message is not a duplicate, two
// messages with identical wording are still two messages, and the order never
// changes. Pure - no network, no Blobs, no DOM.

"use strict";
const thread=require('./thread');
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(d?'   ('+d+')':''))};
const M=(id,from,text,at,via)=>({id,from,text,at:at||'2026-08-09T12:00:00.000Z',via:via||'quote'});

console.log('=== 1 · lib/thread.js ===');
ok('empty record -> empty thread',thread.normalizeThread({}).length===0);
{const t=thread.normalizeThread({customerQuestion:'Can you start in September?',questionAskedAt:'2026-08-01T10:00:00.000Z'});
 ok('legacy customerQuestion becomes message zero',t.length===1&&t[0].from==='customer'&&/September/.test(t[0].text),JSON.stringify(t[0]&&t[0].text));
 ok('legacy message keeps its original date',t[0].at==='2026-08-01T10:00:00.000Z',t[0].at);}
{const r={thread:[M('a','customer','first','2026-08-02T10:00:00.000Z')],customerQuestion:'first'};
 ok('legacy field NOT duplicated when already in the thread',thread.normalizeThread(r).length===1,thread.normalizeThread(r).length+' messages');}
{const r={thread:[M('b','contractor','second','2026-08-03T10:00:00.000Z'),M('a','customer','first','2026-08-01T10:00:00.000Z')]};
 const t=thread.normalizeThread(r);
 ok('oldest first',t[0].id==='a'&&t[1].id==='b',t.map(x=>x.id).join(','));}
{const r={thread:[M('x','customer','same words','2026-08-01T10:00:00.000Z')]};
 const a=thread.appendMessage(r,{id:'y',from:'customer',text:'same words'});
 ok('identical WORDING is a new message (not deduped)',a.added===true,a.reason);
 const b=thread.appendMessage(r,{id:'x',from:'customer',text:'totally different'});
 ok('identical ID is a duplicate (deduped)',b.added===false&&b.reason==='duplicate',b.reason);}
{const r={};let cur=r;
 for(let i=0;i<thread.MAX_MESSAGES;i++){const a=thread.appendMessage(cur,{id:'m'+i,from:'customer',text:'x'+i});cur={thread:a.thread}}
 const over=thread.appendMessage(cur,{id:'over',from:'customer',text:'one too many'});
 ok('thread is capped at '+thread.MAX_MESSAGES,over.added===false&&over.reason==='thread_full',over.reason);}
{const long='x'.repeat(9000);
 const a=thread.appendMessage({},{id:'l',from:'customer',text:long});
 ok('message truncated to '+thread.MAX_MESSAGE_CHARS+' chars',a.message.text.length===thread.MAX_MESSAGE_CHARS,a.message.text.length+'');}
{let rec={};let allowed=0;
 for(let i=0;i<20;i++){const c=thread.checkRate(rec,1000000);rec.threadRate=c.state;if(c.allowed)allowed++}
 ok('rate limit stops at '+thread.RATE_MAX_IN_WINDOW+' in the window',allowed===thread.RATE_MAX_IN_WINDOW,allowed+' allowed');
 const later=thread.checkRate(rec,1000000+thread.RATE_WINDOW_MS+1);
 ok('window reopens afterwards',later.allowed===true);}
console.log('\n  refFromText (the whole Gmail bridge):');
[['Re: SBC-260809-VUUI — Three Interior Staircases','SBC-260809-VUUI'],
 ['Re: your question','' ],
 ['Fwd: quote','...on Aug 9 you wrote: Estimate sbc-260809-vuui ...','SBC-260809-VUUI'],
 ['no ref anywhere','plain reply','']].forEach(a=>{
 const want=a[a.length-1],got=thread.refFromText.apply(null,a.slice(0,-1));
 ok('    '+JSON.stringify(a[0]).slice(0,46).padEnd(48)+'-> '+(got||'(none)'),got===want,got);});
{const r={thread:[M('a','customer','hi'),M('b','contractor','hello')]};
 ok('needsReply false when he spoke last',thread.needsReply(r)===false);
 r.thread.push(M('c','customer','one more'));
 ok('needsReply true when they spoke last',thread.needsReply(r)===true);}
console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
