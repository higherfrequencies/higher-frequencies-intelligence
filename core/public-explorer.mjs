/** RC6 read-only local public explorer. No tenant database, identity, or internal
 * assessments are consulted. Only explicitly curated, attributed factual metadata
 * shipped in data/activation is exposed. Not a live business registry. */
export class PublicExplorer {
 constructor({records=[],metadata={}}={}){
  this.metadata=Object.freeze({publisher:metadata.publisher||'ChristchurchNZ',observedAt:metadata.observedAt||null,collectionMethod:'manually_attributed_snapshot',live:false});
  this.records=records.filter(r=>r&&r.type==='event'&&typeof r.url==='string'&&r.url.startsWith('https://www.christchurchnz.com/')).map(r=>Object.freeze({
   id:String(r.externalKey||''),title:String(r.title||''),type:'event',category:String(r.category||''),
   location:String(r.location||''),region:String(r.region||''),startDate:r.startDate||null,endDate:r.endDate||null,
   organiser:r.organiser||null,sourceUrl:r.url,publisher:r.publisher||this.metadata.publisher,
   observedAt:r.sourceObservedAt||this.metadata.observedAt,verification:'attributed_publisher_listing_not_independently_verified',
   commercialInterest:'unknown',dataCollection:'manual_snapshot'
  }));
  // Strictly publisher-attributed organiser names from the curated event snapshot.
  // This does NOT establish registration, ownership, or an independently verified business identity.
  const organisations=new Map();for(const event of this.records){const name=String(event.organiser||'').trim();if(!name)continue;const key=name.toLocaleLowerCase('en-NZ');let profile=organisations.get(key);if(!profile){profile={id:'organiser:'+key,name,title:name,type:'organisation',category:'event organiser (publisher attribution)',region:event.region,location:event.location,registrationStatus:'unknown',nzbn:null,contact:null,operatingHours:null,services:null,customerInterest:'unknown',verification:'publisher_named_organiser_not_registry_verified',dataCollection:'manual_snapshot',observedAt:event.observedAt,sourceUrl:event.sourceUrl,associatedEvents:[]};organisations.set(key,profile)}profile.associatedEvents.push({title:event.title,sourceUrl:event.sourceUrl,startDate:event.startDate,location:event.location});}
  this.organisations=[...organisations.values()].map(x=>Object.freeze({...x,associatedEvents:Object.freeze(x.associatedEvents)}));
 }
 search({q='',type='',region='',limit=20}={}){
  const query=String(q).trim().toLowerCase().slice(0,100),place=String(region).trim().toLowerCase().slice(0,80);
  const typeFilter=String(type).toLowerCase().slice(0,40);
  const candidates=typeFilter==='organisation'?this.organisations:typeFilter==='event'?this.records:this.records;
  const results=candidates.filter(r=>(!query||[r.title,r.name,r.organiser,r.category,r.location,r.region].some(v=>String(v||'').toLowerCase().includes(query)))&&(!typeFilter||r.type===typeFilter)&&(!place||[r.location,r.region].some(v=>v.toLowerCase().includes(place)))).slice(0,Math.max(1,Math.min(50,Number(limit)||20)));
  return {metadata:{...this.metadata,disclaimer:'Publisher-attributed manual event snapshot and explicitly named organisers only; not live NZBN/Companies search, registered business profiles, a complete census or Higher Frequencies private intelligence'},count:results.length,results};
 }
}
