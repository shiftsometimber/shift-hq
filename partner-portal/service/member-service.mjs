import original from './member-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {withSharedOutbox,completeSharedResponse} from './shared-workflow.mjs';
export default {async fetch(request,env,ctx){
 if(env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return original.fetch(request,env,ctx);
 await ensureSharedSchema(env.DB);const response=await original.fetch(request,withSharedOutbox(env),ctx);
 return completeSharedResponse(response,request,env);
}};
