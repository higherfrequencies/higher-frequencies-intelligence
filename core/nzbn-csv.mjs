/** Strict bounded RFC4180 parser for user-authorised public NZ company extract rows.
    No remote connection; no directors, shareholders, contact details or private fields. */
export function parseNzbnCsv(csv){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>12000||!csv.trim())throw Error('Invalid NZBN import size');
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<csv.length;i++){const c=csv[i];
  if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}
  else if(c===','&&!quoted){row.push(field);field=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}
  else field+=c;
 }
 if(quoted)throw Error('Unterminated CSV quote');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(x=>x.replace(/^\uFEFF/,'').trim().toUpperCase());if(!headers||new Set(headers).size!==headers.length||!['NZBN','ENTITY_NAME','ENTITY_STATUS'].every(h=>headers.includes(h)))throw Error('CSV requires NZBN, ENTITY_NAME, ENTITY_STATUS');
 if(!rows.length||rows.length>50)throw Error('Import requires 1–50 organisation rows');
 return rows.map((cols,index)=>{
  if(cols.length!==headers.length)throw Error(`Invalid CSV column count on row ${index+2}`);
  const record=Object.fromEntries(headers.map((header,i)=>[header,cols[i].trim()]));
  const nzbn=record.NZBN,name=record.ENTITY_NAME,status=record.ENTITY_STATUS;
  if(!/^\d{13}$/.test(nzbn)||name.length<2||name.length>180||!status||status.length>100)throw Error(`Invalid public entity fields on row ${index+2}`);
  const sector=(record.INDUSTRY_CLASSIFICATION_DESCRIPTION||'').slice(0,100);
  return {nzbn,name,status,sector};
 });
}
