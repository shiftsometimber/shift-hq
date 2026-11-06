// Local qualification fixture only; never imported by a deployed entry point.
// Execute the unchanged emitted DO class against private in-memory test storage.
export function localSiteContentNamespace(SiteContentState){
 if(typeof SiteContentState!=='function')throw Error('Actual emitted SiteContentState class required');
 const rows=new Map(),storage={async get(key){return structuredClone(rows.get(key));},async put(key,value){rows.set(key,structuredClone(value));},async delete(key){return rows.delete(key);},async list({prefix}={}){return new Map([...rows].filter(([key])=>!prefix||key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}};
 const object=new SiteContentState({storage}),stub={fetch(input,init){return object.fetch(new Request(input,init));}};
 return {idFromName(name){if(name!=='global')throw Error('Unexpected test object name');return name;},get(id){if(id!=='global')throw Error('Unexpected test object ID');return stub;}};
}
