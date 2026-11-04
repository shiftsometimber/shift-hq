import original from './member-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {withSharedOutbox,drainSharedWorkflow} from './shared-workflow.mjs';
export default {async fetch(request,env,ctx){
 if(env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return original.fetch(request,env,ctx);
 await ensureSharedSchema(env.DB);const response=await original.fetch(request,withSharedOutbox(env),ctx);
 if(!response.ok)return response;
 const outcome=await drainSharedWorkflow(env),headers=new Headers(response.headers);headers.set('X-Shift-Shared-Order-Sync',outcome.pending?'pending':'complete');
 return new Response(response.body,{status:response.status,headers});
}};
