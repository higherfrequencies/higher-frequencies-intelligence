/** Bounded reader for a fixed publisher-declared RSS 2.0 feed. Metadata only.
 * Never loads linked pages, follows redirects to unrelated domains or executes XML entities.
 */
const decode=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,(_,e)=>{const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(named[e])return named[e];if(e[0]==='#'){const v=Number.parseInt(e[1]?.toLowerCase()==='x'?e.slice(2):e.slice(1),e[1]?.toLowerCase()==='x'?16:10);return v>0&&v<=0x10ffff?String.fromCodePoint(v):''}return ''}).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const field=(xml,name)=>decode(xml.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]||'');
export function parseOfficialRss(xml,{publisher='New Zealand Government · Beehive',maxItems=15}={}){
 if(typeof xml!=='string'||xml.length>900000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss\b/i.test(xml)||!/<channel\b/i.test(xml))throw Error('Unrecognised or unsafe RSS response');
 const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,maxItems);
 if(!items.length)throw Error('RSS feed returned no items');
 return items.map(([,body])=>{
  const title=field(body,'title').slice(0,180),link=field(body,'link'),guid=field(body,'guid'),pubDate=field(body,'pubDate');
  let url;try{url=new URL(link)}catch{return null}
  if(url.protocol!=='https:'||url.hostname!=='www.beehive.govt.nz'||!title||title.length<5)return null;
  const date=new Date(pubDate);return {title,url:url.href,externalKey:(guid||url.href).slice(0,200),location:'New Zealand',region:'New Zealand',type:'government_release',category:'government',publisher,description:'Official Government release headline, for research only; commercial relevance not established.',sourceObservedAt:Number.isFinite(date.getTime())?date.toISOString():'',quality:'attributed',licence:'Metadata and link only; check Beehive terms for further reuse'};
 }).filter(Boolean);
}
