import E from './engine.mjs';
import reference from './reference-catalogue.json' with {type:'json'};
const referenceMovies=new Map(reference.movies.map(m=>[m.id,m]));
const referenceResult=()=>({movies:reference.movies,updated:reference.fetchedAt,sourceRegion:reference.sourceRegion,reference:true,stale:true,warning:'Live chart unavailable. Showing a saved US movie catalogue; your ratings and recommendations still work.'});
const regions=['us','gb','in','ca','au'];
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const cleanText=(x,max)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():fail(400,`Enter text between 1 and ${max} characters.`);
const validGenres=g=>Array.isArray(g)&&g.length<=E.genres.length&&new Set(g).size===g.length&&g.every(x=>E.genres.includes(x));
async function account(db,identity){
 let a=await one(db,'SELECT * FROM accounts WHERE id=?',identity.userId);
 if(!a){const data={name:(identity.fullName||'Movie lover').slice(0,35),preferences:[],ratings:{},watchlist:[],customMovies:[],region:'us',share:false};
 await run(db,'INSERT OR IGNORE INTO accounts(id,code,data,revision) VALUES(?,?,?,0)',identity.userId,crypto.randomUUID().replaceAll('-','').slice(0,16),JSON.stringify(data));a=await one(db,'SELECT * FROM accounts WHERE id=?',identity.userId);}
 return {...a,data:JSON.parse(a.data)};
}
async function mutate(db,id,fn){for(let n=0;n<5;n++){const a=await one(db,'SELECT * FROM accounts WHERE id=?',id);const data=JSON.parse(a.data);fn(data);if(JSON.stringify(data).length>180000)fail(400,'Your account has reached its storage limit. Remove unused custom movies or ratings.');const result=await run(db,'UPDATE accounts SET data=?,revision=revision+1 WHERE id=? AND revision=?',JSON.stringify(data),id,a.revision);if(result.meta.changes)return;}fail(409,'Another change arrived at the same time. Please try again.');}
async function rateLimit(db,key,max,now){const expires=Math.floor(now/60000)*60000+60000;const r=await one(db,'INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires<=? THEN 1 ELSE limits.count+1 END, expires=? RETURNING count',key,expires,now,expires);if(r.count>max)fail(429,'Too many requests. Please wait one minute and try again.');}
export function parseFeed(payload){
 const entries=payload?.feed?.entry;if(!Array.isArray(entries))throw Error('The movie provider returned an empty or unexpected feed.');
 const result=[];for(const e of entries){const id=e.id?.attributes?.['im:id'];if(!/^\d+$/.test(id||''))continue;
 const category=e.category?.attributes?.label||'Other';const gs=E.genres.filter(g=>category.toLowerCase().includes(g.toLowerCase()));if(/anime/i.test(category))gs.push('Animation');if(/kids/i.test(category))gs.push('Family');
 const rawImage=e['im:image']?.at(-1)?.label;const image=safeUrl(rawImage,'mzstatic.com');
 const links=Array.isArray(e.link)?e.link:[e.link];const href=links.find(l=>l?.attributes?.rel==='alternate')?.attributes?.href||e.id?.label;
 const title=e['im:name']?.label;const year=Number(String(e['im:releaseDate']?.label).slice(0,4));if(!title||!Number.isInteger(year)||year<1888)continue;
 result.push({id:'apple-'+id,title:String(title).slice(0,180),year,genres:[...new Set(gs.length?gs:['Other'])],minutes:null,description:String(e.summary?.label||'No synopsis supplied.').slice(0,1800),image,url:safeUrl(href,'apple.com'),source:'Apple movie chart',color:'#ada0d1',symbol:'✦'});
 }if(!result.length)throw Error('No films were available from this storefront.');return result;
}
function safeUrl(value,host){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname===host||u.hostname.endsWith('.'+host))?u.href:null}catch{return null}}
async function catalogue(db,region,force,identity,fetcher,now){
 const cached=await one(db,'SELECT * FROM cache WHERE key=?',region);
 if(cached&&now-cached.updated<(force?60000:1800000))return {...JSON.parse(cached.data),updated:cached.updated,cached:true};
 await rateLimit(db,'catalogue:'+identity.userId,8,now);await rateLimit(db,'provider',18,now);
 try{const response=await fetcher(`https://itunes.apple.com/${region}/rss/topmovies/limit=100/json`,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw Error('Movie provider HTTP '+response.status);const movies=parseFeed(await response.json());
 await db.batch([db.prepare("INSERT INTO movies(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(movies)),db.prepare('INSERT INTO cache(key,data,updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(region,JSON.stringify({movies}),now)]);
 return {movies,updated:now,cached:false};
 }catch(error){console.warn('CineGraph chart refresh failed',JSON.stringify({region,reason:String(error.message).slice(0,250)}));if(cached)return {...JSON.parse(cached.data),updated:cached.updated,cached:true,stale:true,warning:'Live provider unavailable. Showing the last saved chart.'};return referenceResult();}
}
async function stateFor(db,a){
 const relationships=await rows(db,'SELECT * FROM connections WHERE a=? OR b=?',a.code,a.code);
 const direct=relationships.filter(x=>x.status==='accepted').map(x=>x.a===a.code?x.b:x.a);
 let ids=new Set(direct),secondEdges=[];
 if(a.data.share&&direct.length){const qs=direct.map(()=>'?').join(',');const sharing=await rows(db,`SELECT code FROM accounts WHERE code IN (${qs}) AND json_extract(data,'$.share')=1`,...direct);const codes=sharing.map(x=>x.code);if(codes.length){const marks=codes.map(()=>'?').join(',');secondEdges=await rows(db,`SELECT * FROM connections WHERE status='accepted' AND (a IN (${marks}) OR b IN (${marks})) LIMIT 300`,...codes,...codes);secondEdges.forEach(e=>{ids.add(e.a);ids.add(e.b)});}}
 ids.delete(a.code);const codes=[...ids].slice(0,100);const peers=codes.length?await rows(db,`SELECT code,data FROM accounts WHERE code IN (${codes.map(()=>'?').join(',')})`,...codes):[];
 const visible=peers.map(p=>({code:p.code,data:JSON.parse(p.data)})).filter(p=>direct.includes(p.code)||a.data.share&&p.data.share);
 const me={id:a.code,...a.data};delete me.customMovies;
 const profiles=[me,...visible.map(p=>({id:p.code,name:p.data.name,preferences:[],ratings:a.data.share&&p.data.share?Object.fromEntries(Object.entries(p.data.ratings).filter(([id])=>id.startsWith('apple-'))):{},watchlist:[],sharing:p.data.share,canUse:a.data.share&&p.data.share}))];
 const allowed=new Set(profiles.map(p=>p.id));const seen=new Set();const edges=[...relationships.filter(e=>e.status==='accepted'),...secondEdges].filter(e=>{if(!allowed.has(e.a)||!allowed.has(e.b)||seen.has(e.key))return false;seen.add(e.key);return true}).map(e=>[e.a,e.b]);
 const cached=await one(db,'SELECT * FROM cache WHERE key=?',a.data.region);const movies=new Map(reference.movies.map(m=>[m.id,m]));if(cached)JSON.parse(cached.data).movies.forEach(m=>movies.set(m.id,m));
 const refs=[...new Set(profiles.flatMap(p=>[...Object.keys(p.ratings),...p.watchlist]))].filter(id=>id.startsWith('apple-')&&!movies.has(id)).slice(0,500);
 if(refs.length){for(let i=0;i<refs.length;i+=80){const part=refs.slice(i,i+80);const saved=await rows(db,`SELECT data FROM movies WHERE id IN (${part.map(()=>'?').join(',')})`,...part);saved.forEach(x=>{const m=JSON.parse(x.data);movies.set(m.id,m)});}}
 a.data.customMovies.forEach(m=>movies.set(m.id,m));
 const pending=relationships.filter(e=>e.status==='pending').map(e=>({code:e.a===a.code?e.b:e.a,incoming:e.sender!==a.code}));
 return {version:2,active:a.code,movies:[...movies.values()],profiles,edges,pending,revision:a.revision,catalogueUpdated:cached?.updated||reference.fetchedAt,catalogueSource:cached?'live':'reference',catalogueRegion:cached?a.data.region:reference.sourceRegion,syncedAt:Date.now()};
}
export async function handleApi(request,db,identity,fetcher=fetch,now=Date.now()){
 try{const publicUrl=new URL(request.url);if(request.method==='GET'&&publicUrl.pathname==='/api/catalogue'){if(!db)fail(503,'Database is not configured.');const region=publicUrl.searchParams.get('region')||'us';if(!regions.includes(region))fail(400,'Choose a supported storefront.');return json(await catalogue(db,region,publicUrl.searchParams.get('refresh')==='1',identity||{userId:'public-catalogue'},fetcher,now));}
 if(!identity?.userId)return json({error:'Sign in to save your own ratings and watchlist.'},401);if(!db)fail(503,'Database is not configured.');
 const url=new URL(request.url),path=url.pathname.replace('/api/','');
 if(!['GET','POST'].includes(request.method))fail(405,'Method not allowed.');
 if(request.method==='POST'){if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail(403,'Request origin is not allowed.');if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'Use JSON input.');await rateLimit(db,'writes:'+identity.userId,100,now);}
 const a=await account(db,identity);
 if(request.method==='GET'){
 if(path==='state')return json(await stateFor(db,a));
 if(path==='recommendations'){const s=await stateFor(db,a);const mode=['blend','genre','friends'].includes(url.searchParams.get('mode'))?url.searchParams.get('mode'):'blend';return json(E.recommend(s,mode,url.searchParams.get('depth')==='1'?1:2));}
 if(path==='export')return json({version:2,profile:a.data,friendCode:a.code});
 if(path==='catalogue'){const region=url.searchParams.get('region')||a.data.region;if(!regions.includes(region))fail(400,'Choose a supported storefront.');return json(await catalogue(db,region,url.searchParams.get('refresh')==='1',identity,fetcher,now));}
 fail(404,'Endpoint not found.');}
 const bodyText=await request.text();if(bodyText.length>20000)fail(413,'Input is too large.');let b;try{b=JSON.parse(bodyText)}catch{fail(400,'Invalid JSON input.')}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Invalid input.');
 if(path==='profile'){const patch={};if(b.name!==undefined)patch.name=cleanText(b.name,35);if(b.preferences!==undefined){if(!validGenres(b.preferences))fail(400,'Select valid genres.');patch.preferences=b.preferences;}if(b.region!==undefined){if(!regions.includes(b.region))fail(400,'Choose a supported storefront.');patch.region=b.region;}if(b.share!==undefined){if(typeof b.share!=='boolean')fail(400,'Sharing must be on or off.');patch.share=b.share;}await mutate(db,a.id,d=>Object.assign(d,patch));}
 else if(path==='movies'){const movie={id:'custom-'+crypto.randomUUID(),title:cleanText(b.title,90),year:b.year,minutes:b.minutes,genres:b.genres,description:typeof b.description==='string'?b.description.trim():'',color:'#ada0d1',symbol:'✦',source:'Your custom movie'};if(!Number.isInteger(movie.year)||movie.year<1888||movie.year>2100||!Number.isInteger(movie.minutes)||movie.minutes<1||movie.minutes>1000||!validGenres(movie.genres)||!movie.genres.length||movie.description.length>500)fail(400,'Check year, runtime, description and genres.');await mutate(db,a.id,d=>{if(d.customMovies.length>=150)fail(400,'Maximum 150 custom movies per account.');d.customMovies.push(movie)});return json({ok:true,id:movie.id});}
 else if(path==='delete-movie'){await mutate(db,a.id,d=>{if(!d.customMovies.some(m=>m.id===b.movieId))fail(404,'Custom movie not found.');d.customMovies=d.customMovies.filter(m=>m.id!==b.movieId);delete d.ratings[b.movieId];d.watchlist=d.watchlist.filter(id=>id!==b.movieId)});}
 else if(path==='rating'||path==='watchlist'){
 if(typeof b.movieId!=='string'||!(/^(apple-\d+|custom-[a-f0-9-]{36})$/).test(b.movieId))fail(400,'Invalid movie ID.');
 const exists=referenceMovies.has(b.movieId)||a.data.customMovies.some(m=>m.id===b.movieId)||await one(db,'SELECT id FROM movies WHERE id=?',b.movieId);if(!exists)fail(404,'Movie not found in your catalogue.');
 if(path==='rating'){if(b.value!==null&&(!Number.isInteger(b.value)||b.value<1||b.value>5))fail(400,'Choose a rating from 1 to 5.');await mutate(db,a.id,d=>{if(b.movieId.startsWith('custom-')&&!d.customMovies.some(m=>m.id===b.movieId))fail(404,'Custom movie was removed.');if(b.value===null)delete d.ratings[b.movieId];else d.ratings[b.movieId]=b.value;});}
 else{if(typeof b.saved!=='boolean')fail(400,'Saved must be true or false.');await mutate(db,a.id,d=>{if(b.movieId.startsWith('custom-')&&!d.customMovies.some(m=>m.id===b.movieId))fail(404,'Custom movie was removed.');d.watchlist=d.watchlist.filter(id=>id!==b.movieId);if(b.saved)d.watchlist.push(b.movieId)});}}
 else if(path==='friends'){
 if(typeof b.code!=='string'||!(/^[a-f0-9]{16}$/).test(b.code)||b.code===a.code)fail(400,'Enter another person’s valid friend code.');
 const peer=await one(db,'SELECT code FROM accounts WHERE code=?',b.code);if(!peer)fail(404,'Friend code not found. Ask your friend to sign in first.');const [x,y]=[a.code,b.code].sort(),key=x+':'+y;
 if(b.action==='request'){const count=await one(db,'SELECT count(*) AS n FROM connections WHERE a=? OR b=?',a.code,a.code);const peerCount=await one(db,'SELECT count(*) AS n FROM connections WHERE a=? OR b=?',b.code,b.code);if(count.n>=30||peerCount.n>=30)fail(400,'A circle can have at most 30 connections or requests.');await run(db,"INSERT OR IGNORE INTO connections(key,a,b,sender,status) VALUES(?,?,?,?,'pending')",key,x,y,a.code);}
 else if(b.action==='accept'){const result=await run(db,"UPDATE connections SET status='accepted' WHERE key=? AND sender<>? AND status='pending'",key,a.code);if(!result.meta.changes)fail(403,'Only the recipient can accept a pending request.');}
 else if(b.action==='remove')await run(db,'DELETE FROM connections WHERE key=?',key);
 else fail(400,'Invalid friend action.');}
 else fail(404,'Endpoint not found.');
 return json({ok:true});
 }catch(e){if(!e.status)console.error('CineGraph API failure',e.message);return json({error:e.status?e.message:'Could not complete the request. Please try again.'},e.status||500)}
}
