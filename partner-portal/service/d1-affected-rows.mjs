// D1 reports trigger side effects in result metadata. Native optimistic locks
// need SQLite's changes() for the original statement, captured in the same
// transaction. SELECT changes() itself leaves the following SQL guard intact.
const cache=new WeakMap();
const mutation=sql=>/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql||'');
export function exactAffectedRows(DB){
 if(!DB||typeof DB.prepare!=='function')return DB;
 if(DB.__sstExactAffectedRows)return DB;
 if(cache.has(DB))return cache.get(DB);
 const info=new WeakMap();let facade;
 function statement(native,sql){
  const s={bind(...args){return statement(native.bind(...args),sql)},first(...args){return native.first(...args)},raw(...args){return native.raw(...args)},async run(...args){return mutation(sql)?(await batch([s]))[0]:native.run(...args)},async all(...args){return mutation(sql)?(await batch([s]))[0]:native.all(...args)}};
  info.set(s,{native,sql});return s;
 }
 async function batch(statements){
  const flat=[],positions=[];
  for(const source of statements){const meta=info.get(source)||info.get(source.native),native=meta?.native||source.native||source,index=flat.length;flat.push(native);let proof=null;if(meta&&mutation(meta.sql)){proof=flat.length;flat.push(DB.prepare('SELECT changes() AS sst_affected_rows'));}positions.push({index,proof});}
  const result=await DB.batch(flat);
  return positions.map(({index,proof})=>{
   const r=result[index];if(proof===null)return r;
   const changes=result[proof]?.results?.[0]?.sst_affected_rows;if(!Number.isSafeInteger(changes)||changes<0)throw Error('d1_affected_rows_unconfirmed');
   return {...r,meta:{...r.meta,reported_changes:r.meta?.changes,changes}};
  });
 }
 facade=new Proxy(DB,{get(target,key){if(key==='__sstExactAffectedRows')return true;if(key==='__sstrxBaseDB')return facade;if(key==='prepare')return sql=>statement(DB.prepare(sql),sql);if(key==='batch')return batch;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 cache.set(DB,facade);return facade;
}
